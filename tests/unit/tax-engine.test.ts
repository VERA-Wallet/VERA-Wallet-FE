import { describe, expect, it } from "vitest";

import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createTaxScenarioEvents } from "@/lib/tax/scenarios";
import { add, div, mul, round, sub, toFixed } from "@/lib/tax/decimal";
import { computeTaxEstimate, compareRuleSets, taxPeriodFor, taxYearFor } from "@/lib/tax/engine";
import { runLedger } from "@/lib/tax/ledger";
import { RULE_SET_ORDER, getRuleSet, listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEvent } from "@/lib/tax/types";

const events = createTaxScenarioEvents(FIXTURE_TAX_YEAR);
const estimate = (country: string, profile = {}, taxYear = FIXTURE_TAX_YEAR) =>
  computeTaxEstimate({ country, events, taxYear, profile });

describe("decimal", () => {
  it("adds without binary floating point drift", () => {
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(sub("0.3", "0.1")).toBe("0.2");
    expect(mul("1.1", "1.1")).toBe("1.21");
    expect(div("1", "3")).toBe("0.333333333333333333");
  });

  it("rounds half-up away from zero and pads fixed output", () => {
    expect(round("2.345", 2)).toBe("2.35");
    expect(round("-2.345", 2)).toBe("-2.35");
    expect(toFixed("1015.4375", 2)).toBe("1015.44");
    expect(toFixed("10", 2)).toBe("10.00");
  });
});

describe("독일 — 1년 초과 면세 + Freigrenze", () => {
  const result = estimate("DE");

  it("1년 초과 보유분을 전액 비과세로 분리한다", () => {
    // 4,965 + 2,967.5 + 2,976 = 10,908.5
    expect(result.totals.exemptGains).toBe("10908.5");
    expect(result.totals.taxableGains).toBe("0");
  });

  it("§23 단기 순손실을 이월한다", () => {
    expect(result.lossCarryforward).toBe("528");
  });

  it("기타소득 면세한계를 넘으면 전액에 세율과 연대부가세를 적용한다", () => {
    expect(result.totals.incomeTotal).toBe("2750");
    // 2,750 × 35% × 1.055
    expect(result.totals.estimatedCharge).toBe("1015.44");
  });

  it("면세한계 미만이면 부담이 0이다", () => {
    const tiny = computeTaxEstimate({
      country: "DE",
      taxYear: 2025,
      events: [
        { kind: "INCOME", id: "i1", at: "2025-02-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "0.1", fmv: "200", incomeKind: "STAKING" },
      ],
    });
    expect(tiny.totals.incomeTotal).toBe("200");
    expect(tiny.totals.estimatedCharge).toBe("0");
  });
});

describe("미국 — 장단기 분리와 손실 상계", () => {
  it("장기 이익이 우대세율 구간을 가로지르면 구간별로 나눠 매긴다", () => {
    // 단일 세율을 전액에 곱하면 구간을 넘는 순간 답이 틀린다.
    // 0% 상한(single $48,350) 바로 아래에 일반소득을 두고 장기 이익을 얹는다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2023-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", cost: "0", fee: "0" },
      { kind: "DISPOSE", id: "d1", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", proceeds: "20000", fee: "0", trigger: "FIAT" },
    ];
    const profile = { otherIncome: "40000", filingStatus: "SINGLE" as const };
    const result = computeTaxEstimate({ country: "US", taxYear: 2025, events, profile });
    const charge = result.lines.find((line) => line.key === "ltcg_charge")!.amount;

    // 전액 0%(=0)도, 전액 15%(=3,000)도 아니어야 한다 — 걸쳐 있기 때문이다.
    expect(charge).not.toBe("0");
    expect(charge).not.toBe(round(mul("20000", "0.15"), 2));
    // 0% 구간에 남은 여유($8,350)를 뺀 나머지에만 15%가 붙는다.
    expect(charge).toBe(round(mul("11650", "0.15"), 2));
  });

  it("단기 순손실을 장기 이익과 상계하고 우대세율을 적용한다", () => {
    const result = estimate("US");
    expect(result.totals.taxableGains).toBe("10380.5");
    // 과세소득이 $48,350 이하 → 장기 우대세율 0% 구간에만 들어간다.
    // 세율 표기 대신 실제 산출 부담으로 확인한다(구간 적분이라 단일세율이 없다).
    expect(result.lines.find((line) => line.key === "ltcg_charge")?.amount).toBe("0");
    expect(result.lines.find((line) => line.key === "ordinary_charge")?.amount).toBe("275");
  });

  it("고소득에서는 20% 구간과 NIIT 3.8%가 함께 붙는다", () => {
    const result = estimate("US", { otherIncome: "600000" });
    // 최상위 구간에 완전히 들어가면 전액 20%다.
    const ltcg = result.lines.find((line) => line.key === "ltcg_charge")!;
    expect(ltcg.amount).toBe(round(mul("10380.5", "0.20"), 2));
    expect(result.lines.find((line) => line.key === "niit_charge")?.amount).toBe(round(mul("10380.5", "0.038"), 2));
  });

  it("순손실은 연 $3,000까지만 일반소득에서 차감하고 잔여를 이월한다", () => {
    const losing = computeTaxEstimate({
      country: "US",
      taxYear: 2025,
      events: [
        { kind: "ACQUIRE", id: "a1", at: "2025-01-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", cost: "20000", fee: "0" },
        { kind: "DISPOSE", id: "d1", at: "2025-06-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", proceeds: "10000", fee: "0", trigger: "FIAT" },
      ],
    });
    expect(losing.lines.find((line) => line.key === "ordinary_offset")?.amount).toBe("3000");
    expect(losing.lossCarryforward).toBe("7000");
  });
});

describe("인도 — 손실 전면 무시 + 실효 31.2%", () => {
  const result = estimate("IN");

  it("손실을 상계하지 않고 이득만 합산한다", () => {
    expect(result.lines.find((line) => line.key === "ignored_losses")?.amount).toBe("800");
    expect(result.totals.taxableGains).toBe("11300");
    expect(result.lossCarryforward).toBe("0");
  });

  it("수수료를 취득원가로 인정하지 않는다", () => {
    // 수수료 인정 국가(독일)의 BTC 원가 10,015 대비 10,000.
    expect(result.lines.find((line) => line.key === "vda_gains")?.amount).toBe("11300");
  });

  it("cess 포함 실효세율이 31.2%다", () => {
    expect(result.totals.effectiveRatePercent).toBe("31.2");
    expect(result.totals.estimatedCharge).toBe("4383.6");
  });

  it("양도가액의 1%를 원천징수 예납으로 계산한다", () => {
    expect(result.lines.find((line) => line.key === "tds")?.amount).toBe("339");
  });
});

describe("포르투갈 — 365일 이분법과 비과세 교환", () => {
  const result = estimate("PT");

  it("365일 이상 보유분을 면세로 분리한다", () => {
    expect(result.totals.exemptGains).toBe("7941");
  });

  it("크립토→크립토는 과세하지 않고 취득원가를 승계한다", () => {
    expect(result.lines.find((line) => line.key === "deferred_swaps")?.amount).toBe("1");
    expect(result.openQuestions.some((question) => question.topic === "CRYPTO_TO_CRYPTO")).toBe(true);
  });

  it("스테이킹은 Cat. E 28% 별도 과세다", () => {
    expect(result.lines.find((line) => line.key === "income_charge")?.amount).toBe("770");
  });
});

describe("영국 — 법정 매칭 순서", () => {
  it("30일 내 재매수를 Section 104 풀보다 먼저 매칭한다", () => {
    const ledger = runLedger(events, getRuleSet("GB")!.ledger);
    const solRow = ledger.gains.find((row) => row.eventId === "dsp-sol-08");
    // 30일 뒤 재매수분(2,110)이 매칭되어 손실이 -816이 아니라 -120이 된다.
    expect(solRow?.cost).toBe("2110");
    expect(solRow?.gain).toBe("-120");
  });

  it("AEA 3,000을 차감형으로 적용한다", () => {
    const result = estimate("GB");
    expect(result.totals.exemptGains).toBe("3000");
    expect(result.lines.find((line) => line.key === "cgt_basic")?.rate).toBe("18%");
  });

  it("영국 과세연도는 4월 6일에 시작한다", () => {
    const result = estimate("GB", {}, 2024);
    // 2024 과세연도(2024-04-06~2025-04-05)에는 2025-04-20 처분이 포함되지 않는다.
    expect(result.lines.find((line) => line.key === "net_gains")?.amount).toBe("0");
  });
});

describe("호주 — 손실 차감이 50% 할인보다 먼저", () => {
  const result = estimate("AU", { otherIncome: "90000" });

  it("손실을 비할인 이익부터 상계한 뒤 남은 적격분만 할인한다", () => {
    // 손실 816은 비할인 이익 288을 먼저 지우고, 남은 528만 할인적격 이익에서 뺀다.
    expect(result.lines.find((line) => line.key === "losses")?.amount).toBe("816");
    expect(result.totals.taxableGains).toBe("5190.25");
    expect(result.lines.find((line) => line.key === "discount")?.amount).toBe("5190.25");
  });

  it("호주 과세연도는 7월 1일에 시작한다", () => {
    // 데모 픽스처는 12개 룰셋의 과세기간이 모두 겹치는 창(7/1~12/31)에만 놓여 경계를 밟지 않는다.
    // 경계 자체는 픽스처에 기대지 않고 여기서 만든 이벤트로 못 박는다.
    const straddling: TaxEvent[] = [
      { kind: "INCOME", id: "jun30", at: "2025-06-30T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "100", incomeKind: "STAKING" },
      { kind: "INCOME", id: "jul01", at: "2025-07-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "250", incomeKind: "STAKING" },
    ];
    expect(computeTaxEstimate({ country: "AU", events: straddling, taxYear: 2024 }).totals.incomeTotal).toBe("100");
    expect(computeTaxEstimate({ country: "AU", events: straddling, taxYear: 2025 }).totals.incomeTotal).toBe("250");
    // 역년 국가는 같은 두 건을 한 해에 담는다 — 이 경계가 호주만의 것임을 함께 못 박는다.
    expect(computeTaxEstimate({ country: "DE", events: straddling, taxYear: 2025 }).totals.incomeTotal).toBe("350");
  });

  it("initial allocation 에어드랍은 소득으로 인식하지 않는다", () => {
    // 같은 기간·같은 이벤트인데 호주만 AIRDROP_INITIAL 450을 소득에서 뺀다.
    expect(result.totals.incomeTotal).toBe("2300");
    expect(estimate("DE").totals.incomeTotal).toBe("2750");
  });
});

describe("프랑스 — 포트폴리오 가중평균과 이연", () => {
  const result = estimate("FR");

  it("크립토→크립토를 과세하지 않는다", () => {
    expect(result.lines.find((line) => line.key === "deferred_swaps")?.amount).toBe("1");
  });

  it("2026년부터 PFU가 31.4%로 오른다", () => {
    expect(result.lines.find((line) => line.key === "gains_charge")?.rate).toBe("30%");
    expect(estimate("FR", {}, 2026).lines.find((line) => line.key === "gains_charge")?.rate).toBe("31.4%");
  });

  it("연간 양도가액이 €305 미만이면 과세하지 않는다", () => {
    const small = computeTaxEstimate({
      country: "FR",
      taxYear: 2025,
      events: [
        { kind: "ACQUIRE", id: "a1", at: "2025-01-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "100", fee: "0" },
        { kind: "DISPOSE", id: "d1", at: "2025-06-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "300", fee: "0", trigger: "FIAT" },
      ],
    });
    expect(small.totals.estimatedCharge).toBe("0");
  });
});

describe("이탈리아 — 연도별 세율 전환", () => {
  it("2025년은 26% + €2,000 면세한계", () => {
    const result = estimate("IT");
    expect(result.lines.find((line) => line.key === "gains_charge")?.rate).toBe("26%");
    expect(result.totals.exemptGains).toBe("2000");
  });

  it("2026년부터 면세한계 없이 33%", () => {
    const result = estimate("IT", {}, 2026);
    expect(result.lines.find((line) => line.key === "gains_charge")?.rate).toBe("33%");
    expect(result.totals.exemptGains).toBe("0");
  });
});

describe("스페인 — 저축소득 누진", () => {
  it("구간별로 나누어 계산한다", () => {
    const result = computeTaxEstimate({
      country: "ES",
      taxYear: 2025,
      events: [
        { kind: "ACQUIRE", id: "a1", at: "2025-01-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "0", fee: "0" },
        { kind: "DISPOSE", id: "d1", at: "2025-06-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "60000", fee: "0", trigger: "FIAT" },
      ],
    });
    // 6,000×19% + 44,000×21% + 10,000×23% = 1,140 + 9,240 + 2,300
    expect(result.totals.estimatedCharge).toBe("12680");
  });
});

describe("캐나다 — ACB와 superficial loss", () => {
  const result = estimate("CA");

  it("전후 30일 재취득 손실을 부인한다", () => {
    expect(result.lines.find((line) => line.key === "denied_losses")?.amount).toBe("816");
  });

  it("포함률 50%만 과세소득에 반영한다", () => {
    const net = result.lines.find((line) => line.key === "net_gains")!.amount;
    expect(result.lines.find((line) => line.key === "inclusion")?.amount).toBe(round(mul(net, "0.5"), 2));
  });

  it("사업자 선언 시 100% 포함으로 바뀐다", () => {
    const business = estimate("CA", { isBusiness: true });
    expect(business.totals.taxableGains).toBe(result.lines.find((line) => line.key === "net_gains")!.amount);
  });
});

describe("일본 — 잡소득 종합과세", () => {
  const result = estimate("JP");

  it("매매와 수령분을 하나의 잡소득으로 합산한다", () => {
    expect(result.totals.taxableBase).toBe(round(add(result.lines[0].amount, result.totals.incomeTotal), 2));
  });

  it("손실을 이월하지 않는다", () => {
    expect(result.lossCarryforward).toBe("0");
  });
});

describe("한국 — 시행일 전 과세기간", () => {
  const result = estimate("KR");

  it("규칙 미확정이 아니라 '아직 과세 대상 아님'으로 답한다", () => {
    // 2027-01-01 이후 양도·대여분부터 과세된다. 규칙을 몰라서 0인 것과 구분해야 한다.
    expect(result.status).toBe("SCHEDULED");
    expect(result.totals.estimatedCharge).toBe("0");
    expect(result.totals.taxableBase).toBe("0");
    // 시행 전이라도 판정은 내려진다 — 손익 행이 판정 보류로 남으면 안 된다.
    const gainGroups = new Set(result.judgments.filter((row) => row.amountKind === "gain").map((row) => row.group));
    expect(gainGroups).toEqual(new Set(["exempt"]));
  });

  it("원장 집계와 확정 필요 항목을 함께 제시한다", () => {
    expect(result.lines.find((line) => line.key === "disposal_count")?.amount).toBe("5");
    expect(result.openQuestions.length).toBeGreaterThanOrEqual(3);
    expect(result.requiredInputs.length).toBeGreaterThan(0);
  });

  it("시행됐다고 가정하면 시행 후와 같은 규칙으로 계산한다", () => {
    const assumed = computeTaxEstimate({ country: "KR", events, taxYear: FIXTURE_TAX_YEAR, assumeEffective: true });
    const after = computeTaxEstimate({ country: "KR", events: createTaxScenarioEvents(2027), taxYear: 2027 });

    // 같은 거래 구조에 같은 규칙을 적용했으므로 줄 구성과 과세표준 산식이 일치한다.
    expect(assumed.status).toBe("PARTIAL");
    expect(assumed.lines.map((line) => line.key)).toEqual(after.lines.map((line) => line.key));
    expect(assumed.totals.taxableBase).toBe(after.totals.taxableBase);
    // 가정이라는 사실이 결과 안에도 있어야 한다 — 화면 배너만 믿으면 API·내보내기에서 사라진다.
    expect(assumed.notes[0]).toContain("아직 시행 전입니다");
    expect(assumed.method).toContain("시행 가정");
  });

  it("가정은 명시적으로 켤 때만 켜진다", () => {
    expect(result.status).toBe("SCHEDULED");
    expect(computeTaxEstimate({ country: "KR", events, taxYear: FIXTURE_TAX_YEAR }).status).toBe("SCHEDULED");
  });
});

describe("한국 — 시행 후 기타소득 분리과세", () => {
  const KR_YEAR = 2027;
  const wallet = "0xkr";
  // 금액은 원 단위다. 통화 중립 시나리오(만 단위)로는 250만원 기본공제에 전부 묻혀 세율이 검증되지 않는다.
  const krEvents: TaxEvent[] = [
    // 시행일 전 취득 — 의제취득가액(2026-12-31 시가) 대상이다.
    { kind: "ACQUIRE", id: "kr-acq-btc", at: "2026-05-10T00:00:00.000Z", wallet, asset: "1:btc", symbol: "BTC", quantity: "1", cost: "40000000", fee: "100000" },
    { kind: "ACQUIRE", id: "kr-acq-eth", at: "2027-02-01T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "10", cost: "30000000", fee: "50000" },
    { kind: "DISPOSE", id: "kr-dsp-btc", at: "2027-07-01T00:00:00.000Z", wallet, asset: "1:btc", symbol: "BTC", quantity: "1", proceeds: "60000000", fee: "120000", trigger: "FIAT" },
    { kind: "DISPOSE", id: "kr-dsp-eth", at: "2027-08-01T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "5", proceeds: "12000000", fee: "20000", trigger: "FIAT" },
    { kind: "INCOME", id: "kr-inc-lend", at: "2027-09-01T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "0.3", fmv: "1000000", incomeKind: "LENDING" },
    { kind: "INCOME", id: "kr-inc-stake", at: "2027-09-05T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "0.2", fmv: "500000", incomeKind: "STAKING" },
  ];
  const result = computeTaxEstimate({ country: "KR", taxYear: KR_YEAR, events: krEvents });
  const groupOf = (eventId: string) => result.judgments.find((row) => row.eventId === eventId && row.amountKind !== "cost")?.group;

  it("양도·교환 손익을 연간 통산하고 대여 대가만 총수입금액에 더한다", () => {
    // BTC 60,000,000 − 40,100,000 − 120,000 = 19,780,000
    // ETH 12,000,000 − 15,025,000 − 20,000 = −3,045,000
    expect(result.lines.find((line) => line.key === "net_gains")?.amount).toBe("16735000");
    expect(result.totals.incomeTotal).toBe("1000000");
    // 스테이킹 수령분은 양도도 대여도 아니라 총수입금액에서 빠진다.
    expect(result.lines.find((line) => line.key === "pending_income")?.amount).toBe("500000");
  });

  it("기본공제 250만원을 빼고 20% + 지방소득세 10%를 적용한다", () => {
    // (16,735,000 + 1,000,000) − 2,500,000 = 15,235,000
    expect(result.totals.taxableBase).toBe("15235000");
    expect(result.lines.find((line) => line.key === "income_tax")?.amount).toBe("3047000");
    expect(result.lines.find((line) => line.key === "local_tax")?.amount).toBe("304700");
    expect(result.totals.estimatedCharge).toBe("3351700");
  });

  it("손실은 통산만 하고 이월하지 않는다", () => {
    expect(result.lossCarryforward).toBe("0");
    expect(groupOf("kr-dsp-eth")).toBe("carry");
  });

  it("대여는 과세 소득, 스테이킹 수령분은 판정 보류로 갈린다", () => {
    expect(groupOf("kr-inc-lend")).toBe("income");
    expect(groupOf("kr-inc-stake")).toBe("pending");
  });

  it("시행일 전 취득분에 의제취득가액을 쓰지 못했다는 한계를 낸다", () => {
    const deemed = result.limitations.filter((row) => row.message.includes("의제취득가액"));
    expect(deemed).toHaveLength(1);
    expect(deemed[0].kind).toBe("approximation");
    expect(result.openQuestions.some((question) => question.reason.includes("2026-12-31 시가"))).toBe(true);
  });

  it("기본공제 안에 들어가면 과세표준이 0이고 비과세 판정을 받는다", () => {
    const small = computeTaxEstimate({
      country: "KR",
      taxYear: KR_YEAR,
      events: [
        { kind: "ACQUIRE", id: "s-acq", at: "2027-01-05T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000000", fee: "0" },
        { kind: "DISPOSE", id: "s-dsp", at: "2027-06-05T00:00:00.000Z", wallet, asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000000", fee: "0", trigger: "FIAT" },
      ],
    });
    expect(small.totals.taxableBase).toBe("0");
    expect(small.totals.estimatedCharge).toBe("0");
    expect(small.totals.exemptGains).toBe("2000000");
    expect(small.judgments.find((row) => row.eventId === "s-dsp")?.group).toBe("exempt");
  });
});

describe("엔진 공통 불변식", () => {
  it("소득 이벤트는 수령 FMV를 취득원가로 삼아 이중과세를 막는다", () => {
    const ledger = runLedger(events, getRuleSet("DE")!.ledger);
    const arb = ledger.gains.find((row) => row.eventId === "dsp-arb-11");
    // 수령 시 600을 소득으로 인식했으므로 처분 시 원가도 600이어야 한다.
    expect(arb?.cost).toBe("600");
    expect(arb?.gain).toBe("288");
  });

  it("모든 룰셋이 mock provenance와 근거를 실어 보낸다", () => {
    for (const estimateResult of compareRuleSets([...RULE_SET_ORDER], { events, taxYear: 2025 })) {
      expect(estimateResult.provenance).toBe("mock");
      expect(estimateResult.notes.length).toBeGreaterThan(0);
      expect(estimateResult.method.length).toBeGreaterThan(0);
    }
  });

  it("카탈로그는 데모 우선순위 순으로 노출되고 UK 별칭을 해석한다", () => {
    expect(RULE_SET_ORDER.slice(0, 4)).toEqual(["DE", "US", "IN", "PT"]);
    expect(getRuleSet("uk")?.code).toBe("GB");
    expect(listRuleSetSummaries()).toHaveLength(12);
    expect(listRuleSetSummaries().every((summary) => summary.topics.length > 0)).toBe(true);
  });

  it("알 수 없는 국가 코드는 거부한다", () => {
    expect(() => computeTaxEstimate({ country: "XX", events, taxYear: 2025 })).toThrow(/Unknown ruleset/);
  });
});

describe("건수 줄은 금액이 아니다", () => {
  it("건수를 담은 줄은 unit: count로 표시된다", () => {
    // "처분 건수 ₩5"처럼 건수에 통화 기호가 붙는 거짓을 막는 계약.
    for (const country of ["KR", "FR", "PT"] as const) {
      const result = computeTaxEstimate({ country, taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
      for (const line of result.lines) {
        if (/건수/.test(line.label)) {
          expect(line.unit, `${country} ${line.key}`).toBe("count");
          // 건수는 정수여야 한다.
          expect(line.amount, `${country} ${line.key}`).toMatch(/^\d+$/);
        }
      }
    }
  });

  it("금액 줄에는 count 단위가 붙지 않는다", () => {
    for (const country of ["DE", "KR", "IN", "PT", "FR"] as const) {
      const result = computeTaxEstimate({ country, taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
      for (const line of result.lines) {
        if (line.unit === "count") expect(line.label, `${country} ${line.key}`).toMatch(/건수/);
      }
    }
  });
});

describe("판정 그룹 안에서 금액을 더해도 되는가", () => {
  it("금액 종류가 섞이는 그룹을 화면이 알 수 있다", () => {
    // 화면은 (group, amountKind)로 줄을 나눈다. 그 전제가 되는 사실을 고정한다.
    // 한국의 시행 전 "과세 대상 아님"은 실제로 손익과 수령 FMV를 함께 담는다.
    const kr = computeTaxEstimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
    const exemptKinds = new Set(kr.judgments.filter((row) => row.group === "exempt").map((row) => row.amountKind));
    expect(exemptKinds.size).toBeGreaterThan(1);
  });

  it("같은 (그룹, 금액 종류)끼리는 더해도 의미가 있다", () => {
    // 같은 종류면 합계가 성립한다 — 취득가액끼리, 손익끼리.
    for (const country of RULE_SET_ORDER) {
      const result = computeTaxEstimate({ country, taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
      const buckets = new Map<string, Set<string>>();
      for (const row of result.judgments) {
        const key = `${row.group}|${row.amountKind}`;
        buckets.set(key, (buckets.get(key) ?? new Set()).add(row.amountKind));
      }
      for (const [key, kinds] of buckets) expect(kinds.size, `${country} ${key}`).toBe(1);
    }
  });
});

describe("비역년 과세기간이 지갑 이벤트를 어떻게 가르는가", () => {
  it("1월 이벤트는 호주·영국의 같은 과세연도 밖이다", () => {
    // 화면이 그때 "계산할 거래 없음"이라 말하는 근거다. 이 사실이 바뀌면 화면 문구도 거짓이 된다.
    const january = "2025-01-15T00:00:00.000Z";
    for (const country of ["AU", "GB"] as const) {
      const period = taxPeriodFor(country, 2025);
      expect(Date.parse(january) < Date.parse(period.from), `${country} ${period.from}`).toBe(true);
      // 직전 과세연도에는 들어간다 — 사라지는 게 아니라 옮겨간다.
      expect(taxYearFor(country, january), country).toBe(2024);
    }
    // 역년 국가는 그대로 2025다.
    expect(taxYearFor("DE", january)).toBe(2025);
  });

  it("경계 하루 앞뒤에서 과세연도가 정확히 갈린다", () => {
    // 하루 어긋나면 거래 하나가 통째로 다른 해로 넘어간다.
    const cases = [
      { country: "AU" as const, before: "2025-06-30T23:59:59.999Z", after: "2025-07-01T00:00:00.000Z" },
      { country: "GB" as const, before: "2025-04-05T23:59:59.999Z", after: "2025-04-06T00:00:00.000Z" },
      { country: "DE" as const, before: "2024-12-31T23:59:59.999Z", after: "2025-01-01T00:00:00.000Z" },
    ];
    for (const { country, before, after } of cases) {
      expect(taxYearFor(country, before), `${country} before`).toBe(2024);
      expect(taxYearFor(country, after), `${country} after`).toBe(2025);
      // 기간 시작은 포함, 끝은 제외다.
      const period = taxPeriodFor(country, 2025);
      expect(Date.parse(after), `${country} from`).toBe(Date.parse(period.from));
      expect(Date.parse(before) < Date.parse(period.from), `${country} before < from`).toBe(true);
    }
  });
});
