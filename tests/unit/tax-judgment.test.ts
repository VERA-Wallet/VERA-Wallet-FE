import { describe, expect, it } from "vitest";

import { computeMarginalContributions, computeTaxEstimate } from "@/lib/tax/engine";
import { runLedger } from "@/lib/tax/ledger";
import { getRuleSet, RULE_SET_ORDER } from "@/lib/tax/rulesets";
import type { JudgmentRow, TaxEvent } from "@/lib/tax/types";
import { defaultIncomeVerdict } from "@/lib/tax/judgment";
import { sub, sum } from "@/lib/tax/decimal";
import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";

const events = createTaxScenarioEvents();

function judgmentsOf(country: string): Map<string, JudgmentRow[]> {
  const estimate = computeTaxEstimate({ country, events, taxYear: 2025 });
  const byEvent = new Map<string, JudgmentRow[]>();
  for (const row of estimate.judgments) {
    byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row]);
  }
  return byEvent;
}

/** 처분 leg의 판정. 교환은 처분(leg="dispose")과 수취(leg="receive") 두 행을 낸다. */
function groupOf(country: string, eventId: string): string {
  const rows = judgmentsOf(country).get(eventId);
  expect(rows, `${country}/${eventId} 판정 행이 없다`).toBeDefined();
  const primary = rows!.filter((row) => row.leg !== "receive");
  expect(primary.length, `${country}/${eventId} 처분/취득 leg는 한 행이어야 한다`).toBe(1);
  return primary[0].group;
}

describe("건별 판정 — 같은 거래가 나라별로 다르게 찍힌다", () => {
  it("독일은 보유 1년 초과 처분을 비과세로, 손실을 이월로 찍는다", () => {
    // 435/664/466일 보유 — §23 (1) Nr.2로 금액과 무관하게 전액 비과세.
    expect(groupOf("DE", "dsp-btc-04")).toBe("exempt");
    expect(groupOf("DE", "dsp-btc-12")).toBe("exempt");
    expect(groupOf("DE", "dsp-eth-09")).toBe("exempt");
    // 199일 — 1년 이내라 과세 범주지만, 이 시나리오는 단기 순액이 -528이라 실제 과세분이 없다.
    // 화면이 "과세 대상"이라 말하면서 부담이 0인 모순을 막기 위해 집계 결과를 따른다.
    expect(computeTaxEstimate({ country: "DE", events, taxYear: 2025 }).totals.taxableGains).toBe("0");
    // 법정 면세(exempt)가 아니라 기간 집계 상계로 과세분이 없는 것이므로 offset이다.
    expect(groupOf("DE", "dsp-arb-11")).toBe("offset");
    // 45일 손실 — §23 (3)으로 §23 이익과만 상계·이월.
    expect(groupOf("DE", "dsp-sol-08")).toBe("carry");
    expect(groupOf("DE", "inc-stake-03")).toBe("income");
    expect(groupOf("DE", "inc-air-05")).toBe("income");
  });

  it("인도는 보유기간을 보지 않고, 손실을 상계 불가로 무시한다", () => {
    for (const id of ["dsp-btc-04", "dsp-btc-12", "dsp-eth-09", "dsp-arb-11"]) {
      expect(groupOf("IN", id), `${id}는 인도에서 과세여야 한다`).toBe("taxable");
    }
    // §115BBH(2) — 손실은 다른 VDA 이익과도 상계할 수 없다.
    expect(groupOf("IN", "dsp-sol-08")).toBe("ignored");
  });

  it("포르투갈은 크립토→크립토 교환을 처분으로 보지 않아 손익 자체를 만들지 않는다", () => {
    expect(groupOf("PT", "dsp-btc-04")).toBe("exempt");
    expect(groupOf("PT", "dsp-sol-08")).toBe("carry");
    // 비과세 교환은 처분이 아니므로 처분 leg 자체가 없고 수취 leg만 이연으로 남는다.
    const swap = judgmentsOf("PT").get("dsp-eth-09")!;
    expect(swap.map((row) => row.group)).toEqual(["deferred"]);
    expect(swap[0].leg).toBe("receive");
    expect(swap[0].quantity).not.toBe("0");
  });

  it("한국은 규칙 미확정이라 판정 보류(pending)다 — 인도의 법적 상계 금지(ignored)와 구분한다", () => {
    expect(groupOf("KR", "dsp-btc-04")).toBe("pending");
    expect(groupOf("KR", "inc-stake-03")).toBe("pending");
    expect(groupOf("IN", "dsp-sol-08")).toBe("ignored");
  });

  it("매수는 세금이 0이어도 취득 판정으로 목록에 남는다", () => {
    expect(groupOf("DE", "acq-btc-01")).toBe("acquire");
    // 인도는 수수료를 원가로 인정하지 않아 도장 문구가 갈린다.
    const de = judgmentsOf("DE").get("acq-btc-01")![0];
    const india = judgmentsOf("IN").get("acq-btc-01")![0];
    expect(de.label).toBe("취득 · 원가 기록");
    expect(india.label).toBe("취득 · 수수료 불인정");
    expect(de.amount).not.toBe(india.amount);
  });

  it("모든 판정 행은 화면에 그대로 쓸 수 있게 라벨과 근거를 갖는다", () => {
    for (const code of RULE_SET_ORDER) {
      for (const row of computeTaxEstimate({ country: code, events, taxYear: 2025 }).judgments) {
        expect(row.label.length, `${code}/${row.eventId} label`).toBeGreaterThan(0);
        expect(row.basis.length, `${code}/${row.eventId} basis`).toBeGreaterThan(0);
      }
    }
  });

  it("판정은 시간 오름차순이고 제외 이벤트는 포함하지 않는다", () => {
    const estimate = computeTaxEstimate({
      country: "DE",
      events,
      taxYear: 2025,
      excludedEventIds: ["ghost-01"],
    });
    const times = estimate.judgments.map((row) => Date.parse(row.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(estimate.judgments.some((row) => row.eventId === "ghost-01")).toBe(false);
    expect(estimate.excludedEventIds).toContain("ghost-01");
  });

  it("원장이 취득 행을 방출하고 이연 행에 시각이 실린다", () => {
    const portugal = getRuleSet("PT")!;
    const ledger = runLedger(events, portugal.ledger);
    expect(ledger.acquisitions.length).toBeGreaterThan(0);
    expect(ledger.acquisitions.every((row) => row.at.length > 0)).toBe(true);
    expect(ledger.deferred.length).toBeGreaterThan(0);
    expect(ledger.deferred.every((row) => row.at.length > 0 && row.symbol.length > 0)).toBe(true);
  });
});

describe("한계 기여도 — 건별 배분 대신 델타", () => {
  const marginal = computeMarginalContributions({ country: "DE", events, taxYear: 2025 });

  it("처분 5건은 총 부담에 전혀 기여하지 않는다", () => {
    // 차익 +4,965인 매도조차 1년 초과 보유로 전액 비과세라 기여가 0이다.
    for (const id of ["dsp-btc-04", "dsp-btc-12", "dsp-eth-09", "dsp-arb-11", "dsp-sol-08"]) {
      expect(marginal[id], `${id} 기여`).toBe("0");
    }
  });

  it("부담을 만든 것은 스테이킹·에어드랍 수령분이다", () => {
    expect(marginal["inc-stake-03"]).toBe("369.25");
    expect(marginal["inc-stake-12"]).toBe("258.48");
    expect(marginal["inc-air-05"]).toBe("221.55");
    expect(marginal["inc-air-06"]).toBe("166.16");
  });

  it("매수는 기여가 음수다 — 지우면 취득원가가 사라져 부담이 늘어난다", () => {
    expect(marginal["acq-btc-01"]).toBe("-7914.5");
    expect(marginal["acq-eth-01"]).toBe("-2749.8");
    expect(marginal["acq-sol-07"]).toBe("-841.15");
  });

  it("나라가 바뀌면 같은 거래의 기여도 바뀐다", () => {
    const india = computeMarginalContributions({ country: "IN", events, taxYear: 2025 });
    expect(marginal["dsp-btc-04"]).toBe("0");
    expect(india["dsp-btc-04"]).toBe("1560");
  });

  it("모든 이벤트가 한 번씩만 계산된다", () => {
    expect(Object.keys(marginal).sort()).toEqual([...new Set(events.map((event) => event.id))].sort());
  });
});

describe("수령 종류가 근거를 고른다", () => {
  it("에어드랍과 스테이킹이 서로 다른 근거를 받는다", () => {
    // 예전에는 incomeKind를 무시하고 항상 STAKING 근거를 붙여,
    // 에어드랍 수령에 스테이킹 조문이 달렸다.
    const ruleset = getRuleSet("DE")!;
    const base = { eventId: "x", at: "2025-03-01T00:00:00.000Z", asset: "a", symbol: "ETH", quantity: "1", amount: "100" };

    const staking = defaultIncomeVerdict({ ...base, incomeKind: "STAKING" }, ruleset);
    const airdrop = defaultIncomeVerdict({ ...base, incomeKind: "AIRDROP" }, ruleset);
    expect(staking.basis).not.toBe(airdrop.basis);
    expect(staking.basis).toBe(ruleset.topics.find((topic) => topic.topic === "STAKING")!.basis);
    expect(airdrop.basis).toBe(ruleset.topics.find((topic) => topic.topic === "AIRDROP")!.basis);
  });

  it("모든 수령 종류가 근거를 갖는다", () => {
    // IncomeRow.incomeKind는 필수다 — "종류 미상"은 타입 수준에서 존재할 수 없다.
    // 대신 모든 종류가 실제로 근거를 받는지 전수 확인한다.
    const ruleset = getRuleSet("DE")!;
    const base = { eventId: "x", at: "2025-03-01T00:00:00.000Z", asset: "a", symbol: "ETH", quantity: "1", amount: "100" };
    for (const kind of ["STAKING", "LENDING", "AIRDROP", "AIRDROP_INITIAL", "MINING", "DEFI_REWARD"] as const) {
      const verdict = defaultIncomeVerdict({ ...base, incomeKind: kind }, ruleset);
      expect(verdict.basis, kind).toBeTruthy();
      expect(verdict.group, kind).toBe("income");
    }
  });

  it("fallback을 쓰는 룰셋도 수령 종류별 근거를 받는다", () => {
    // 미국·호주는 judgeIncome을 선언하지만, 선언하지 않는 룰셋은 이 기본값을 쓴다.
    // 12개 전부에서 에어드랍과 스테이킹 근거가 갈리는지 확인한다.
    const base = { eventId: "x", at: "2025-03-01T00:00:00.000Z", asset: "a", symbol: "ETH", quantity: "1", amount: "100" };
    for (const code of RULE_SET_ORDER) {
      const ruleset = getRuleSet(code)!;
      const airdropTopic = ruleset.topics.find((topic) => topic.topic === "AIRDROP");
      if (!airdropTopic) continue;
      expect(defaultIncomeVerdict({ ...base, incomeKind: "AIRDROP" }, ruleset).basis, code).toBe(airdropTopic.basis);
    }
  });
});

describe("여러 취득분을 소비한 처분", () => {
  it("판정이 같은 lot들은 한 행으로 합치고 섞인 보유일을 단정하지 않는다", () => {
    // 두 번 나눠 샀지만 둘 다 1년 초과 보유라 판정이 같다 — 도장이 하나면 행도 하나여야 한다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "buy-1", at: "2023-01-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "ACQUIRE", id: "buy-2", at: "2024-01-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "1", cost: "2000", fee: "0" },
      { kind: "DISPOSE", id: "sell-1", at: "2025-09-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "2", proceeds: "5000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const sell = result.judgments.filter((row) => row.eventId === "sell-1");

    expect(sell.length).toBe(1);
    expect(sell[0].lots).toBe(2);
    // 보유일이 lot마다 다르므로 하나를 골라 단정하지 않는다.
    expect(sell[0].holdingDays).toBeNull();
    expect(sell[0].acquiredAt).toBeNull();
    // 수량은 합쳐진다 — 첫 lot만 남기면 2 매도가 1로 보인다.
    expect(sell[0].quantity).toBe("2");
    // 금액도 합쳐진다.
    expect(sell[0].amount).toBe("2000");
  });

  it("판정이 갈리는 lot은 억지로 한 도장에 밀어넣지 않는다", () => {
    // 한 lot은 1년 초과(비과세), 다른 lot은 1년 이내(과세)다.
    // 한 행으로 합치면 둘 중 하나의 도장을 거짓으로 골라야 한다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "buy-1", at: "2024-01-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "ACQUIRE", id: "buy-2", at: "2025-06-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "1", cost: "2000", fee: "0" },
      { kind: "DISPOSE", id: "sell-1", at: "2025-09-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "2", proceeds: "5000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const sell = result.judgments.filter((row) => row.eventId === "sell-1");

    expect(sell.length).toBe(2);
    expect(new Set(sell.map((row) => row.group))).toEqual(new Set(["exempt", "taxable"]));
    // 갈린 행은 각자의 보유일을 그대로 말한다.
    for (const row of sell) expect(row.holdingDays, row.group).not.toBeNull();
    // 합계는 여전히 이벤트 전체 손익과 같다.
    expect(sum(sell.map((row) => row.amount))).toBe("2000");
    // 집계와도 어긋나지 않는다.
    expect(result.totals.exemptGains).toBe(sell.find((row) => row.group === "exempt")!.amount);
  });

  it("한 취득분만 소비하면 보유일과 취득일을 그대로 말한다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "buy-1", at: "2024-01-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "5", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "sell-1", at: "2025-09-01T00:00:00.000Z", wallet: "0x1", asset: "eip155:1/native", symbol: "ETH", quantity: "2", proceeds: "5000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const sell = result.judgments.filter((row) => row.eventId === "sell-1");

    expect(sell.length).toBe(1);
    expect(sell[0].lots).toBe(1);
    expect(sell[0].holdingDays).not.toBeNull();
    expect(sell[0].acquiredAt).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("손익이 어떻게 나왔는지를 숨기지 않는다", () => {
  it("손익 행은 양도가액 − 취득가액 − 수수료 = 손익을 들고 있다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "10" },
      { kind: "DISPOSE", id: "d", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000", fee: "20", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "d" && item.amountKind === "gain")!;

    expect(row.breakdown, "근거 없이 금액만 보이면 검증할 수 없다").toBeDefined();
    // 산술식만 검사하면 breakdown과 amount가 함께 틀려도 통과한다 — 원천 값 리터럴로 못 박는다.
    // 독일은 취득 수수료를 원가에 산입한다(1,000 + 10).
    expect(row.breakdown).toEqual({ proceeds: "3000", cost: "1010", fee: "20" });
    expect(row.amount).toBe("1970");
  });

  it("여러 취득분을 합칠 때 근거도 함께 더한다", () => {
    // 첫 lot의 근거만 남기면 금액과 근거가 어긋난다.
    // 수수료를 0으로 두면 수수료 병합 결함을 못 잡는다 — 취득·처분 모두 비영으로 둔다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2023-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "5" },
      { kind: "ACQUIRE", id: "a2", at: "2023-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "2000", fee: "15" },
      { kind: "DISPOSE", id: "d", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", proceeds: "5000", fee: "20", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "d" && item.amountKind === "gain")!;

    expect(row.lots).toBe(2);
    // 처분 수수료 20이 lot들에 비례 배분됐다가 병합에서 정확히 되돌아와야 한다.
    expect(row.breakdown).toEqual({ proceeds: "5000", cost: "3020", fee: "20" });
    expect(sub(sub(row.breakdown!.proceeds, row.breakdown!.cost), row.breakdown!.fee)).toBe(row.amount);
  });

  it("룰셋이 금액을 재정의하면 어긋나는 근거를 보이지 않는다", () => {
    // 프랑스는 포트폴리오 공식으로 행 금액을 재정의한다.
    // 원장 4줄(400−100−0=300)과 다른 금액 옆에 그 4줄을 보이면 화면이 자기모순이다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "700", fee: "0" },
      { kind: "DISPOSE", id: "d", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "400", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "FR", taxYear: 2025, events });
    for (const row of result.judgments.filter((item) => item.amountKind === "gain")) {
      if (!row.breakdown) continue;
      // 근거가 남아 있다면 반드시 금액과 맞아떨어져야 한다.
      expect(sub(sub(row.breakdown.proceeds, row.breakdown.cost), row.breakdown.fee), row.eventId).toBe(row.amount);
    }
  });

  it("소득·취득 행에는 손익 근거를 붙이지 않는다", () => {
    // 손익이 아닌 행에 "양도가액 − 취득가액"을 보이면 없는 계산을 지어내는 것이다.
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events: createTaxScenarioEvents() });
    for (const row of result.judgments) {
      if (row.amountKind === "gain") continue;
      expect(row.breakdown, `${row.eventId} ${row.amountKind}`).toBeUndefined();
    }
  });
});
