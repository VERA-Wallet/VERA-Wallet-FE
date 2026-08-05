import { describe, expect, it } from "vitest";

import { MARGINAL_EVENT_LIMIT, MarginalBudgetError, computeMarginalContributions, computeTaxEstimate } from "@/lib/tax/engine";
import { RULE_SETS, RULE_SET_ORDER, getRuleSet } from "@/lib/tax/rulesets";
import { runLedger } from "@/lib/tax/ledger";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import type { IncomeKind, JudgmentRow, LedgerPolicy, TaxEvent } from "@/lib/tax/types";
import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";
import { lt, sum } from "@/lib/tax/decimal";
import { resolveAdjustment } from "@/lib/tax/judgment";

const WALLET = "0xW";
const asset = (symbol: string) => `1:${symbol.toLowerCase()}`;

function acquire(id: string, at: string, symbol: string, quantity: string, cost: string): TaxEvent {
  return { kind: "ACQUIRE", id, at, wallet: WALLET, asset: asset(symbol), symbol, quantity, cost, fee: "0" };
}
function dispose(id: string, at: string, symbol: string, quantity: string, proceeds: string): TaxEvent {
  return { kind: "DISPOSE", id, at, wallet: WALLET, asset: asset(symbol), symbol, quantity, proceeds, fee: "0", trigger: "FIAT" };
}
function income(id: string, at: string, symbol: string, quantity: string, fmv: string, incomeKind: IncomeKind): TaxEvent {
  return { kind: "INCOME", id, at, wallet: WALLET, asset: asset(symbol), symbol, quantity, fmv, incomeKind };
}

function rowsFor(country: string, events: TaxEvent[], eventId: string, taxYear = 2025): JudgmentRow[] {
  return computeTaxEstimate({ country, events, taxYear }).judgments.filter((row) => row.eventId === eventId);
}

/** 취득 t0, 처분 t0+days. 보유일 경계를 정확히 겨냥한다. */
function heldFor(days: number, proceeds: string) {
  const acquiredAt = "2024-06-01T00:00:00.000Z";
  const disposedAt = new Date(Date.parse(acquiredAt) + days * 86_400_000).toISOString();
  return {
    events: [acquire("acq", acquiredAt, "BTC", "1", "1000"), dispose("dsp", disposedAt, "BTC", "1", proceeds)],
    taxYear: new Date(disposedAt).getUTCFullYear(),
  };
}

describe("보유기간 경계 — 판정과 계산이 같은 편에 서는가", () => {
  it("독일은 정확히 365일이면 아직 과세, 366일이면 비과세다", () => {
    const at365 = heldFor(365, "2000");
    const at366 = heldFor(366, "2000");
    expect(rowsFor("DE", at365.events, "dsp", at365.taxYear)[0].group).toBe("taxable");
    expect(rowsFor("DE", at366.events, "dsp", at366.taxYear)[0].group).toBe("exempt");
  });

  it("포르투갈은 365일부터 비과세다 — 독일과 경계 연산자가 다르다", () => {
    const at364 = heldFor(364, "2000");
    const at365 = heldFor(365, "2000");
    expect(rowsFor("PT", at364.events, "dsp", at364.taxYear)[0].group).toBe("taxable");
    expect(rowsFor("PT", at365.events, "dsp", at365.taxYear)[0].group).toBe("exempt");
  });

  it("1년 초과 보유 손실은 이월이 아니라 비과세다 — compute가 exemptGains로 보내기 때문", () => {
    for (const country of ["DE", "PT"]) {
      const held = heldFor(400, "400"); // 원가 1000 → 손실 -600
      const estimate = computeTaxEstimate({ country, events: held.events, taxYear: held.taxYear });
      const row = estimate.judgments.find((item) => item.eventId === "dsp")!;
      expect(row.group, `${country} 장기 손실 판정`).toBe("exempt");
      // 계산도 같은 편이어야 한다: 이월 결손이 잡히면 판정과 어긋난다.
      expect(estimate.lossCarryforward, `${country} 이월 결손`).toBe("0");
      expect(estimate.totals.exemptGains, `${country} 비과세 분리`).toBe("-600");
    }
  });

  it("취득 기록이 없어 보유일수를 특정 못하면 보수적으로 과세로 본다", () => {
    const events = [dispose("dsp", "2025-05-01T00:00:00.000Z", "BTC", "1", "500")];
    const row = rowsFor("DE", events, "dsp")[0];
    expect(row.holdingDays).toBeNull();
    expect(row.group).toBe("taxable");
  });
});

describe("lot 분할 — 한 처분이 과세분과 비과세분으로 갈릴 때", () => {
  const events = [
    acquire("acq-old", "2024-01-01T00:00:00.000Z", "BTC", "1", "100"),
    acquire("acq-new", "2025-06-01T00:00:00.000Z", "BTC", "1", "100"),
    dispose("dsp-split", "2025-09-01T00:00:00.000Z", "BTC", "2", "400"),
  ];

  it("독일에서 같은 매도가 판정 그룹별로 나뉘어 두 행이 된다", () => {
    const rows = rowsFor("DE", events, "dsp-split");
    expect(rows.map((row) => row.group).sort()).toEqual(["exempt", "taxable"]);
    // 두 행의 손익 합이 원장 총 손익과 같아야 정보 손실이 없다.
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(total).toBe(200);
  });

  it("보유기간을 안 따지는 인도에서는 같은 매도가 한 행으로 합쳐지고 lot 수가 기록된다", () => {
    const rows = rowsFor("IN", events, "dsp-split");
    expect(rows).toHaveLength(1);
    expect(rows[0].lots).toBe(2);
    // 소비된 lot의 취득일이 달라 단일 보유일수로 말할 수 없다.
    expect(rows[0].holdingDays).toBeNull();
  });
});

describe("판정 그룹이 서로 다른 사유를 뭉개지 않는가", () => {
  const loss = [
    acquire("acq", "2025-02-01T00:00:00.000Z", "SOL", "10", "1000"),
    dispose("dsp", "2025-03-01T00:00:00.000Z", "SOL", "10", "400"),
  ];

  it("인도의 손실은 법으로 상계가 금지된 ignored다", () => {
    expect(rowsFor("IN", loss, "dsp")[0].group).toBe("ignored");
  });

  it("한국은 규칙이 없어 판정 자체를 못 하는 pending이다", () => {
    const rows = rowsFor("KR", loss, "dsp");
    expect(rows[0].group).toBe("pending");
    expect(rows[0].group).not.toBe("ignored");
  });

  it("캐나다의 30일 내 재매수 손실은 부인되어 denied다", () => {
    const superficial = [
      ...loss,
      acquire("acq-back", "2025-03-10T00:00:00.000Z", "SOL", "10", "420"),
    ];
    const estimate = computeTaxEstimate({ country: "CA", events: superficial, taxYear: 2025 });
    const row = estimate.judgments.find((item) => item.eventId === "dsp")!;
    expect(row.group).toBe("denied");
    // 부인된 손실은 이월 결손으로도 잡히지 않는다.
    expect(estimate.lossCarryforward).toBe("0");
  });
});

describe("수령 소득 — 원가만 만들고 사라지지 않는가", () => {
  const airdrop = [
    income("inc-initial", "2025-08-01T00:00:00.000Z", "OP", "300", "450", "AIRDROP_INITIAL"),
    income("inc-normal", "2025-08-02T00:00:00.000Z", "ARB", "500", "600", "AIRDROP"),
  ];

  it("호주의 최초 배분 에어드랍은 소득 행이 없어도 판정이 남는다", () => {
    const rows = rowsFor("AU", airdrop, "inc-initial");
    expect(rows).toHaveLength(1);
    expect(rows[0].group).toBe("acquire");
    expect(rows[0].amount).toBe("0");
    expect(rows[0].label).toContain("원가 0");
  });

  it("에어드랍 소득의 근거는 스테이킹 조문이 아니라 에어드랍 topic에서 온다", () => {
    for (const country of ["AU", "US"] as const) {
      const topics = RULE_SETS[country].topics;
      const airdropBasis = topics.find((topic) => topic.topic === "AIRDROP")!.basis;
      expect(rowsFor(country, airdrop, "inc-normal")[0].basis, `${country} 에어드랍 근거`).toBe(airdropBasis);
    }
    // 미국은 두 조문이 실제로 달라 분기가 눈에 보인다(호주는 같은 가이드 문서를 쓴다).
    const usAirdrop = rowsFor("US", airdrop, "inc-normal")[0].basis;
    const usStaking = rowsFor("US", [income("s", "2025-08-03T00:00:00.000Z", "ETH", "1", "100", "STAKING")], "s")[0].basis;
    expect(usAirdrop).not.toBe(usStaking);
  });
});

describe("과세기간 스코프", () => {
  const events = [
    acquire("acq-2024", "2024-03-01T00:00:00.000Z", "BTC", "1", "100"),
    acquire("acq-2025", "2025-03-01T00:00:00.000Z", "BTC", "1", "100"),
  ];

  it("원가 추적용으로 실린 기간 밖 취득은 inPeriod=false로 구분된다", () => {
    const judgments = computeTaxEstimate({ country: "DE", events, taxYear: 2025 }).judgments;
    expect(judgments.find((row) => row.eventId === "acq-2024")!.inPeriod).toBe(false);
    expect(judgments.find((row) => row.eventId === "acq-2025")!.inPeriod).toBe(true);
  });
});

describe("한계 기여도 예산", () => {
  it("이벤트 상한을 넘으면 계산하지 않고 거절한다", () => {
    const many = Array.from({ length: MARGINAL_EVENT_LIMIT + 1 }, (_, index) =>
      acquire(`acq-${index}`, "2025-01-01T00:00:00.000Z", "BTC", "1", "1"),
    );
    expect(() => computeMarginalContributions({ country: "DE", events: many, taxYear: 2025 })).toThrow(
      MarginalBudgetError,
    );
  });

  it("상한 이내면 정상 계산한다", () => {
    const few = [acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "10")];
    expect(Object.keys(computeMarginalContributions({ country: "DE", events: few, taxYear: 2025 }))).toEqual(["a"]);
  });
});

describe("집계 한도·상계로 부담이 0이 되는 행을 과세로 찍지 않는가", () => {
  const gain = (proceeds: string) => [
    acquire("acq", "2024-01-01T00:00:00.000Z", "BTC", "1", "1000"),
    dispose("dsp", "2025-06-01T00:00:00.000Z", "BTC", "1", proceeds),
  ];

  it("영국 연간 면세 한도(£3,000) 안의 이익은 과세로 찍히지 않는다", () => {
    // GB 과세연도는 4/6~ 이므로 2025-06-01은 taxYear 2025에 속한다.
    const rows = rowsFor("GB", gain("2000"), "dsp");
    expect(rows[0].group).not.toBe("taxable");
    expect(computeTaxEstimate({ country: "GB", events: gain("2000"), taxYear: 2025 }).totals.taxableGains).toBe("0");
  });

  it("이탈리아 2025년 면세한계 안의 이익도 과세로 찍히지 않는다", () => {
    const rows = rowsFor("IT", gain("2000"), "dsp");
    expect(rows[0].group).not.toBe("taxable");
  });

  it("스페인은 손익 상계로 0이 되면 양수 행도 과세가 아니다", () => {
    const events = [
      acquire("acq-a", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("dsp-a", "2025-03-01T00:00:00.000Z", "BTC", "1", "1100"),
      acquire("acq-b", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
      dispose("dsp-b", "2025-03-02T00:00:00.000Z", "SOL", "1", "800"),
    ];
    expect(rowsFor("ES", events, "dsp-a")[0].group).not.toBe("taxable");
    expect(computeTaxEstimate({ country: "ES", events, taxYear: 2025 }).totals.taxableGains).toBe("0");
  });
});

describe("교환은 처분 leg과 수취 leg을 모두 남긴다", () => {
  const swap: TaxEvent[] = [
    acquire("acq-eth", "2024-01-01T00:00:00.000Z", "ETH", "10", "10000"),
    {
      kind: "DISPOSE",
      id: "swp",
      at: "2025-05-01T00:00:00.000Z",
      wallet: WALLET,
      asset: asset("ETH"),
      symbol: "ETH",
      quantity: "3",
      proceeds: "9000",
      fee: "0",
      trigger: "CRYPTO",
      receives: { asset: asset("SOL"), symbol: "SOL", quantity: "25" },
    },
  ];

  it("과세 교환(독일)은 처분 leg과 수취 leg이 함께 나온다", () => {
    const rows = rowsFor("DE", swap, "swp");
    expect(rows.map((row) => row.leg).sort()).toEqual(["dispose", "receive"]);
    const receive = rows.find((row) => row.leg === "receive")!;
    expect(receive.symbol).toBe("SOL");
    expect(receive.quantity).toBe("25");
    expect(receive.group).toBe("acquire");
  });

  it("비과세 교환(포르투갈)은 처분 leg 없이 수취 leg만 이연으로 남고 수량이 보존된다", () => {
    const rows = rowsFor("PT", swap, "swp");
    expect(rows.map((row) => row.group)).toEqual(["deferred"]);
    expect(rows[0].leg).toBe("receive");
    expect(rows[0].quantity).toBe("25");
  });
});

describe("lot 합산에서 수량이 사라지지 않는가", () => {
  it("두 취득분을 소비한 매도의 수량은 합계여야 한다", () => {
    const events = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "100"),
      acquire("a2", "2025-02-01T00:00:00.000Z", "BTC", "1", "100"),
      dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "2", "400"),
    ];
    // 인도는 보유기간을 보지 않아 두 lot이 한 행으로 합쳐진다.
    const row = rowsFor("IN", events, "d")[0];
    expect(row.lots).toBe(2);
    expect(row.quantity).toBe("2");
  });
});

describe("과세기간이 응답에 실린다", () => {
  it("영국은 4/6~, 호주는 7/1~ 기간을 그대로 반환한다", () => {
    const events = [acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "10")];
    expect(computeTaxEstimate({ country: "GB", events, taxYear: 2025 }).period).toEqual({
      from: "2025-04-06T00:00:00.000Z",
      to: "2026-04-06T00:00:00.000Z",
    });
    expect(computeTaxEstimate({ country: "AU", events, taxYear: 2025 }).period).toEqual({
      from: "2025-07-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });
    expect(computeTaxEstimate({ country: "DE", events, taxYear: 2025 }).period.from).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("호주 장기 보유 손실", () => {
  it("1년 초과 보유 손실은 할인 적격이 아니라 상계 손실이다", () => {
    const held = heldFor(400, "400");
    const row = rowsFor("AU", held.events, "dsp", held.taxYear)[0];
    expect(row.group).toBe("carry");
    expect(row.label).not.toContain("할인 적격");
  });
});

describe("과세분이 0인데 과세 도장이 남는 모순이 없는가", () => {
  it("모든 룰셋에서 taxableGains가 0이면 taxable 행이 존재하지 않는다", () => {
    const scenarios: { name: string; events: TaxEvent[] }[] = [
      {
        // 단기 순액이 음수 — 양수 처분이 있어도 과세분은 0이다.
        name: "손익 상계로 소멸",
        events: [
          acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
          dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "1100"),
          acquire("a2", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
          dispose("d2", "2025-03-02T00:00:00.000Z", "SOL", "1", "700"),
        ],
      },
      {
        // 연간 면세 한도 미만 — GB/IT가 여기서 갈린다.
        name: "면세 한도 내",
        events: [
          acquire("a", "2024-01-01T00:00:00.000Z", "BTC", "1", "1000"),
          dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "1", "1500"),
        ],
      },
    ];

    for (const { name, events } of scenarios) {
      for (const country of RULE_SET_ORDER) {
        const estimate = computeTaxEstimate({ country, events, taxYear: 2025 });
        if (estimate.totals.taxableGains !== "0") continue;
        const taxable = estimate.judgments.filter((row) => row.group === "taxable");
        expect(taxable.map((row) => row.eventId), `${country}/${name}`).toEqual([]);
      }
    }
  });
});

describe("부분 적용 — 집계가 일부만 흡수할 때 행이 단정하지 않는가", () => {
  const bigGain = [
    acquire("a", "2024-01-01T00:00:00.000Z", "BTC", "1", "1000"),
    dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "1", "6000"),
  ];

  it("영국은 연간 면세 한도를 넘겨도 행이 한도 적용 전임을 밝힌다", () => {
    const estimate = computeTaxEstimate({ country: "GB", events: bigGain, taxYear: 2025 });
    expect(estimate.totals.taxableGains).not.toBe("0");
    const row = estimate.judgments.find((item) => item.eventId === "d")!;
    expect(row.group).toBe("taxable");
    expect(row.label).toContain("적용 전");
  });

  it("이탈리아도 면세한계 초과 시 적용 전임을 밝힌다", () => {
    const row = rowsFor("IT", bigGain, "d")[0];
    expect(row.group).toBe("taxable");
    expect(row.label).toContain("적용 전");
  });

  it("스페인은 일부만 상계될 때 상계 적용 전임을 밝힌다", () => {
    const partial = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "2000"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
      dispose("d2", "2025-03-02T00:00:00.000Z", "SOL", "1", "700"),
    ];
    const estimate = computeTaxEstimate({ country: "ES", events: partial, taxYear: 2025 });
    expect(estimate.totals.taxableGains).toBe("700");
    const row = estimate.judgments.find((item) => item.eventId === "d1")!;
    expect(row.group).toBe("taxable");
    expect(row.label).toContain("적용 전");
  });
});

describe("식별자 충돌과 예산 우회", () => {
  it("이벤트 id에 :in 접미사가 있어도 교환 수취분과 섞이지 않는다", () => {
    const events: TaxEvent[] = [
      acquire("swp:in", "2024-01-01T00:00:00.000Z", "SOL", "5", "500"),
      acquire("acq-eth", "2024-01-01T00:00:00.000Z", "ETH", "10", "10000"),
      {
        kind: "DISPOSE",
        id: "swp",
        at: "2025-05-01T00:00:00.000Z",
        wallet: WALLET,
        asset: asset("ETH"),
        symbol: "ETH",
        quantity: "3",
        proceeds: "9000",
        fee: "0",
        trigger: "CRYPTO",
        receives: { asset: asset("SOL"), symbol: "SOL", quantity: "25" },
      },
    ];
    const judgments = computeTaxEstimate({ country: "DE", events, taxYear: 2025 }).judgments;
    // 진짜 매수 `swp:in`은 자기 이벤트로, 교환 수취분은 `swp`로 귀속돼야 한다.
    const realBuy = judgments.filter((row) => row.eventId === "swp:in");
    expect(realBuy).toHaveLength(1);
    expect(realBuy[0].leg).toBe("single");
    expect(judgments.filter((row) => row.eventId === "swp" && row.leg === "receive")).toHaveLength(1);
  });

  it("중복 id로 원시 이벤트 수 상한을 우회할 수 없다", () => {
    const dupes = Array.from({ length: MARGINAL_EVENT_LIMIT + 5 }, () =>
      acquire("same-id", "2025-01-01T00:00:00.000Z", "BTC", "1", "1"),
    );
    expect(new Set(dupes.map((event) => event.id)).size).toBe(1);
    expect(() => computeMarginalContributions({ country: "DE", events: dupes, taxYear: 2025 })).toThrow(
      MarginalBudgetError,
    );
  });
});

describe("프랑스는 원장 부호가 아니라 포트폴리오 공식으로 판정한다", () => {
  it("연간 양도가액 한계 미만이면 비과세로 찍고 계산과 일치한다", () => {
    const events = [
      acquire("a", "2024-01-01T00:00:00.000Z", "BTC", "1", "100"),
      dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "1", "200"),
    ];
    const estimate = computeTaxEstimate({ country: "FR", events, taxYear: 2025 });
    expect(estimate.totals.taxableGains).toBe("0");
    const row = estimate.judgments.find((item) => item.eventId === "d")!;
    expect(row.group).toBe("exempt");
    expect(row.label).toContain("한계 미만");
  });

  it("비과세 교환은 처분 판정을 만들지 않는다", () => {
    const events: TaxEvent[] = [
      acquire("a", "2024-01-01T00:00:00.000Z", "ETH", "10", "10000"),
      {
        kind: "DISPOSE",
        id: "swp",
        at: "2025-05-01T00:00:00.000Z",
        wallet: WALLET,
        asset: asset("ETH"),
        symbol: "ETH",
        quantity: "3",
        proceeds: "9000",
        fee: "0",
        trigger: "CRYPTO",
        receives: { asset: asset("SOL"), symbol: "SOL", quantity: "25" },
      },
    ];
    const rows = rowsFor("FR", events, "swp");
    expect(rows.every((row) => row.group !== "taxable")).toBe(true);
  });
});

describe("내부 lot 키가 사용자 이벤트 id와 충돌하지 않는가", () => {
  // 영국 Section 104 풀은 취득을 id로 찾는다. 합성 키가 사용자 id 네임스페이스를 쓰면
  // 실제 매수 `swp:in`이 교환 수취분으로 오인돼 풀 원가가 틀어진다.
  const events: TaxEvent[] = [
    acquire("swp:in", "2024-01-01T00:00:00.000Z", "SOL", "1", "100"),
    acquire("acq-eth", "2024-01-01T00:00:00.000Z", "ETH", "1", "100"),
    {
      kind: "DISPOSE",
      id: "swp",
      at: "2025-05-01T00:00:00.000Z",
      wallet: WALLET,
      asset: asset("ETH"),
      symbol: "ETH",
      quantity: "1",
      proceeds: "500",
      fee: "0",
      trigger: "CRYPTO",
      receives: { asset: asset("SOL"), symbol: "SOL", quantity: "1" },
    },
    dispose("sell-sol", "2025-06-01T00:00:00.000Z", "SOL", "1", "600"),
  ];

  it("SOL 풀은 매수 100과 교환 수취 500을 모두 담는다", () => {
    const estimate = computeTaxEstimate({ country: "GB", events, taxYear: 2025 });
    const sell = estimate.judgments.find((row) => row.eventId === "sell-sol")!;
    // 풀 평균단가 (100 + 500) / 2 = 300 → 600에 1개 처분 시 손익 +300.
    // 충돌이 있으면 원가가 100으로 잡혀 +500이 된다.
    expect(sell.amount).toBe("300");
  });
});

describe("법정 면세와 집계 상계를 구분하는가", () => {
  it("상계로 과세분이 사라진 행은 exempt가 아니라 offset이다", () => {
    const events = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "1100"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
      dispose("d2", "2025-03-02T00:00:00.000Z", "SOL", "1", "700"),
    ];
    const estimate = computeTaxEstimate({ country: "DE", events, taxYear: 2025 });
    expect(estimate.totals.taxableGains).toBe("0");
    const row = estimate.judgments.find((item) => item.eventId === "d1")!;
    expect(row.group).toBe("offset");
    expect(row.group).not.toBe("exempt");
  });

  it("1년 초과 보유는 상계와 무관하게 법정 면세(exempt)를 유지한다", () => {
    const held = heldFor(400, "2000");
    expect(rowsFor("DE", held.events, "dsp", held.taxYear)[0].group).toBe("exempt");
  });
});

describe("프랑스 판정 금액은 포트폴리오 공식에서 온다", () => {
  it("행 금액이 원장 lot 손익이 아니라 안분 손익이다", () => {
    const events = [
      acquire("a-btc", "2024-01-01T00:00:00.000Z", "BTC", "1", "100"),
      acquire("a-eth", "2024-01-02T00:00:00.000Z", "ETH", "1", "1000"),
      dispose("d-btc", "2025-06-01T00:00:00.000Z", "BTC", "1", "400"),
    ];
    const estimate = computeTaxEstimate({ country: "FR", events, taxYear: 2025 });
    const row = estimate.judgments.find((item) => item.eventId === "d-btc")!;
    // 원장(이동평균) 기준이면 400-100=+300이지만, 프랑스 공식은 포트폴리오 전체를 안분한다.
    expect(row.amount).not.toBe("300");
    // 판정 부호와 금액 부호가 일치해야 화면이 모순되지 않는다.
    const negative = row.amount.startsWith("-");
    expect(negative ? row.group : "carry").not.toBe(negative ? "taxable" : "");
  });
});

describe("이벤트 단위 금액 재정의가 lot 행마다 중복 합산되지 않는가", () => {
  it("프랑스는 원장에 없는 수량이 섞여 행이 갈려도 판정 금액 합계가 계산과 같다", () => {
    // 취득 1개인데 2개를 처분 — 원장이 보유분과 부족분 두 행으로 쪼갠다.
    const events = [
      acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "100"),
      dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "2", "400"),
    ];
    const estimate = computeTaxEstimate({ country: "FR", events, taxYear: 2025 });
    const rows = estimate.judgments.filter((row) => row.eventId === "d");
    // 원장이 두 행으로 쪼갰음을 먼저 확인한다 — 안 쪼개지면 이 회귀가 의미를 잃는다.
    expect(rows.reduce((count, row) => count + row.lots, 0)).toBeGreaterThan(1);
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    // 포트폴리오 공식 손익이 한 번만 반영돼야 한다. 행마다 복사되면 2배가 된다.
    expect(total).toBe(Number(estimate.totals.taxableGains));
    expect(total).toBe(200);
  });
});

describe("스페인 상계 소멸은 이월이 아니라 당해 상계다", () => {
  it("연간 순손익이 0이면 양수 행이 carry가 아니라 offset이다", () => {
    const events = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "1100"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
      dispose("d2", "2025-03-02T00:00:00.000Z", "SOL", "1", "800"),
    ];
    const estimate = computeTaxEstimate({ country: "ES", events, taxYear: 2025 });
    expect(estimate.totals.taxableGains).toBe("0");
    expect(estimate.judgments.find((row) => row.eventId === "d1")!.group).toBe("offset");
  });
});

describe("기간 밖 수령분이 비과세로 오인되지 않는가", () => {
  it("전년도 일반 수령은 원가 기록이며 원가 0 도장을 받지 않는다", () => {
    const events: TaxEvent[] = [
      income("inc-2024", "2024-05-01T00:00:00.000Z", "ETH", "1", "100", "STAKING"),
      dispose("d", "2025-06-01T00:00:00.000Z", "ETH", "1", "300"),
    ];
    const row = computeTaxEstimate({ country: "DE", events, taxYear: 2025 }).judgments.find(
      (item) => item.eventId === "inc-2024",
    )!;
    expect(row.group).toBe("acquire");
    expect(row.inPeriod).toBe(false);
    expect(row.amount).toBe("100");
    expect(row.label).not.toContain("원가 0");
    // 근거는 취득 조문이 아니라 수령 소득 조문이어야 한다.
    expect(row.basis).toBe(RULE_SETS.DE.topics.find((topic) => topic.topic === "STAKING")!.basis);
  });

  it("호주 최초 배분 에어드랍만 원가 0 도장을 받는다", () => {
    const events: TaxEvent[] = [
      income("initial", "2025-08-01T00:00:00.000Z", "OP", "300", "450", "AIRDROP_INITIAL"),
    ];
    const row = computeTaxEstimate({ country: "AU", events, taxYear: 2025 }).judgments.find(
      (item) => item.eventId === "initial",
    )!;
    expect(row.label).toContain("원가 0");
    expect(row.amount).toBe("0");
  });
});

describe("lot 배분이 임계 비교를 뒤집지 않는가", () => {
  it("양도가액을 여러 lot에 나눠도 손익 합계가 절사되지 않는다", () => {
    // 아키텍트 재현 입력: 1300을 1:2로 나누면 독립 곱셈에서 999.999999999999999999가 된다.
    const events = [
      // 단기 보유여야 면세한계(€1,000) strict 비교 경로를 탄다.
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "100"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "BTC", "2", "200"),
      dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "3", "1300"),
    ];
    const estimate = computeTaxEstimate({ country: "DE", events, taxYear: 2025 });
    const rows = estimate.judgments.filter((row) => row.eventId === "d");
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
    expect(total).toBe(1000);
    // 독일 면세한계(€1,000) strict 비교가 절사값에 뒤집히면 부담이 0이 된다.
    expect(estimate.totals.taxableGains).toBe("1000");
    expect(estimate.totals.estimatedCharge).not.toBe("0");
  });
});

describe("손실 라벨이 이월인지 당해 상계인지 단정하지 않는가", () => {
  it("이월 결손이 0인 손실을 이월이라 말하지 않는다", () => {
    // 이익이 손실보다 커서 손실이 전부 당해 상계된다.
    const events = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "3000"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "SOL", "1", "1000"),
      dispose("d2", "2025-03-02T00:00:00.000Z", "SOL", "1", "800"),
    ];
    const estimate = computeTaxEstimate({ country: "DE", events, taxYear: 2025 });
    expect(estimate.lossCarryforward).toBe("0");
    const loss = estimate.judgments.find((row) => row.eventId === "d2")!;
    expect(loss.group).toBe("carry");
    expect(loss.label).not.toContain("이월");
  });
});

describe("연간 면세 한도와 당해 상계를 구분하는가", () => {
  const mixed = [
    acquire("a1", "2024-01-01T00:00:00.000Z", "BTC", "1", "1000"),
    dispose("d1", "2025-06-01T00:00:00.000Z", "BTC", "1", "1100"),
    acquire("a2", "2024-01-02T00:00:00.000Z", "SOL", "1", "1000"),
    dispose("d2", "2025-06-02T00:00:00.000Z", "SOL", "1", "700"),
  ];

  it("순손실로 사라진 양수 행은 면세가 아니라 offset이다", () => {
    for (const country of ["GB", "IT"] as const) {
      const estimate = computeTaxEstimate({ country, events: mixed, taxYear: 2025 });
      expect(estimate.totals.taxableGains, country).toBe("0");
      expect(estimate.totals.exemptGains, country).toBe("0");
      const row = estimate.judgments.find((item) => item.eventId === "d1")!;
      expect(row.group, `${country} 순손실 상계`).toBe("offset");
    }
  });

  it("실제로 면세 한도가 쓰인 경우에만 exempt다", () => {
    const underAllowance = [
      acquire("a", "2024-01-01T00:00:00.000Z", "BTC", "1", "1000"),
      dispose("d", "2025-06-01T00:00:00.000Z", "BTC", "1", "2000"),
    ];
    for (const country of ["GB", "IT"] as const) {
      const estimate = computeTaxEstimate({ country, events: underAllowance, taxYear: 2025 });
      expect(estimate.totals.exemptGains, country).not.toBe("0");
      expect(estimate.judgments.find((item) => item.eventId === "d")!.group, country).toBe("exempt");
    }
  });
});

describe("고정소수 잔차가 합계를 갉아먹지 않는가", () => {
  it("한 취득분을 나눠 처분해도 취득원가 합계가 정확히 보존된다", () => {
    // 100을 3으로 나누면 33.333… 이 되어 독립 곱셈에서는 99.999999999999999999가 된다.
    const events = [
      acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "3", "100"),
      dispose("d1", "2025-03-01T00:00:00.000Z", "BTC", "1", "50"),
      dispose("d2", "2025-04-01T00:00:00.000Z", "BTC", "2", "100"),
    ];
    const ledger = runLedger(events, getRuleSet("DE")!.ledger);
    const totalCost = ledger.gains.reduce((sum, row) => sum + Number(row.cost), 0);
    expect(totalCost).toBe(100);
  });

  it("비과세 교환의 수취 수량 합계가 정확히 보존된다", () => {
    const events: TaxEvent[] = [
      acquire("a1", "2025-01-01T00:00:00.000Z", "BTC", "1", "100"),
      acquire("a2", "2025-01-02T00:00:00.000Z", "BTC", "2", "200"),
      {
        kind: "DISPOSE",
        id: "swp",
        at: "2025-05-01T00:00:00.000Z",
        wallet: WALLET,
        asset: asset("BTC"),
        symbol: "BTC",
        quantity: "3",
        proceeds: "900",
        fee: "0",
        trigger: "CRYPTO",
        receives: { asset: asset("SOL"), symbol: "SOL", quantity: "1" },
      },
    ];
    const ledger = runLedger(events, getRuleSet("PT")!.ledger);
    const received = ledger.deferred.reduce((sum, row) => sum + Number(row.quantity), 0);
    expect(ledger.deferred.length).toBeGreaterThan(1);
    expect(received).toBe(1);
  });
});

describe("입력 경계가 조용히 사라지지 않는가", () => {
  const base = createNormalizedEventFixtures()[0];

  it("수량이 0 이하인 이벤트는 제외되고 사유가 남는다", () => {
    const derived = deriveTaxEvents([{ ...base, id: "zero-qty", raw_amount: "0" }]);
    expect(derived.events).toHaveLength(0);
    expect(derived.excludedEventIds).toContain("zero-qty");
    expect(derived.assumptions.join(" ")).toContain("수량");
  });

  it("중복 id는 첫 건만 계산에 넘기고 나머지를 제외한다", () => {
    const derived = deriveTaxEvents([
      { ...base, id: "dup" },
      { ...base, id: "dup" },
    ]);
    expect(derived.events.filter((event) => event.id === "dup")).toHaveLength(1);
    // 첫 건이 계산에 들어갔으므로 제외가 아니다 — 같은 id가 양쪽에 있으면 계약 위반이다.
    expect(derived.excludedEventIds).not.toContain("dup");
    expect(derived.assumptions.join(" ")).toContain("중복된 이벤트 id");
  });
});

describe("원장 방식별 부분 소비에서 원가가 보존되는가", () => {
  // 100을 3으로 나누면 33.333…이라 독립 곱셈에서는 합계가 100에 못 미친다.
  const splits: { name: string; disposals: string[] }[] = [
    { name: "1+1+1", disposals: ["1", "1", "1"] },
    { name: "1+2", disposals: ["1", "2"] },
    { name: "2+1", disposals: ["2", "1"] },
  ];

  // 라벨이 아니라 실제 원장 정책을 고정한다. 매핑이 바뀌면 이 단언이 먼저 깨진다.
  const methods: { country: string; method: LedgerPolicy["method"] }[] = [
    { country: "DE", method: "FIFO" },
    { country: "JP", method: "PERIOD_AVERAGE" },
    { country: "CA", method: "MOVING_AVERAGE" },
    { country: "GB", method: "SECTION_104" },
    { country: "IT", method: "FIFO" },
  ];

  it("첫 처분의 취득원가가 방식마다 실제로 갈린다", () => {
    // a=1@10, b=2@90 취득 후 q=1 처분.
    // FIFO는 첫 취득분 10, 평균법·Section 104는 풀 평균 100/3.
    const events = [
      acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "10"),
      acquire("b", "2025-01-02T00:00:00.000Z", "BTC", "2", "90"),
      dispose("d", "2025-03-01T00:00:00.000Z", "BTC", "1", "50"),
    ];
    const costOf = (country: string) =>
      runLedger(events, getRuleSet(country)!.ledger).gains[0].cost;
    expect(costOf("DE")).toBe("10");
    expect(costOf("IT")).toBe("10");
    const averaged = "33.333333333333333333";
    expect(costOf("JP")).toBe(averaged);
    expect(costOf("CA")).toBe(averaged);
    expect(costOf("GB")).toBe(averaged);
    // 방식이 다르면 결과가 달라야 한다 — 같으면 매트릭스가 헛바퀴다.
    expect(costOf("DE")).not.toBe(costOf("JP"));
  });

  it("활성 룰셋 중 LIFO를 쓰는 국가는 없다 — 매트릭스가 덮지 못하는 분기를 명시한다", () => {
    const used = new Set(RULE_SET_ORDER.map((code) => getRuleSet(code)!.ledger.method));
    expect(used.has("LIFO")).toBe(false);
    expect([...used].sort()).toEqual(["FIFO", "MOVING_AVERAGE", "PERIOD_AVERAGE", "SECTION_104"]);
  });

  for (const { country, method } of methods) {
    for (const { name, disposals } of splits) {
      it(`${country}(${method})에서 ${name} 분할 처분의 취득원가 합계가 100이다`, () => {
        expect(getRuleSet(country)!.ledger.method, `${country} 원장 방식`).toBe(method);
        // 단가가 다른 두 취득으로 평균법·선입선출 분기를 실제로 가른다.
        const events: TaxEvent[] = [
          acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "10"),
          acquire("b", "2025-01-02T00:00:00.000Z", "BTC", "2", "90"),
        ];
        let day = 3;
        for (const [index, quantity] of disposals.entries()) {
          events.push(
            dispose(`d${index}`, `2025-0${day}-01T00:00:00.000Z`, "BTC", quantity, "50"),
          );
          day += 1;
        }
        const ledger = runLedger(events, getRuleSet(country)!.ledger);
        const totalCost = ledger.gains.reduce((sum, row) => sum + Number(row.cost), 0);
        expect(totalCost, `${country}/${name}`).toBe(100);
        const totalQuantity = ledger.gains.reduce((sum, row) => sum + Number(row.quantity), 0);
        expect(totalQuantity, `${country}/${name} 수량`).toBe(3);
      });
    }
  }

  for (const { country, method } of methods) {
    it(`${country}(${method})에서 일부만 처분하면 남은 원가가 보유분에 남는다`, () => {
      const events = [
        acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "3", "100"),
        dispose("d", "2025-03-01T00:00:00.000Z", "BTC", "1", "50"),
      ];
      const ledger = runLedger(events, getRuleSet(country)!.ledger);
      // q=3/cost=100에서 q=1을 처분하면 어떤 방식이든 정확히 1/3이다(단일 취득이라 평균=선입선출).
      expect(ledger.gains.map((row) => row.cost), `${country} 소비 원가`).toEqual([
        "33.333333333333333333",
      ]);
      // 잔여 보유분이 보존됐는지는 나머지를 마저 처분해 확인한다(원장 내부 상태에 의존하지 않는다).
      const rest = runLedger(
        [...events, dispose("d2", "2025-05-01T00:00:00.000Z", "BTC", "2", "80")],
        getRuleSet(country)!.ledger,
      );
      const totalCost = rest.gains.reduce((sum, row) => sum + Number(row.cost), 0);
      const totalQuantity = rest.gains.reduce((sum, row) => sum + Number(row.quantity), 0);
      expect(totalCost, `${country} 전량 소비 원가`).toBe(100);
      expect(totalQuantity, `${country} 전량 소비 수량`).toBe(3);
    });
  }
});

describe("제외 목록이 이벤트 집합인가", () => {
  it("같은 id가 세 번 들어와도 제외 목록에는 한 번만 남는다", () => {
    const base = createNormalizedEventFixtures()[0];
    const derived = deriveTaxEvents([
      { ...base, id: "dup" },
      { ...base, id: "dup" },
      { ...base, id: "dup" },
    ]);
    expect(derived.events.filter((event) => event.id === "dup")).toHaveLength(1);
    // 계산된 id는 제외 목록에 나타나지 않는다.
    expect(derived.excludedEventIds).toEqual([]);
  });
});

describe("캐나다 superficial loss는 처분 전후 양쪽을 본다", () => {
  const asset = "1:eth";
  const buy = (id: string, at: string, cost: string) =>
    ({ kind: "ACQUIRE", id, at, wallet: "w", asset, symbol: "ETH", quantity: "1", cost, fee: "0" }) as const;
  const sell = (id: string, at: string, proceeds: string) =>
    ({ kind: "DISPOSE", id, at, wallet: "w", asset, symbol: "ETH", quantity: "1", proceeds, fee: "0", trigger: "FIAT" }) as const;

  it("손실 처분 직전 30일 안에 사둔 물량도 부인한다", () => {
    // 뒤쪽만 보면 이 손실이 인정돼 인식 손실이 과대해진다.
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      buy("pre", "2025-05-20T00:00:00.000Z", "3000"),
      sell("loss", "2025-06-01T00:00:00.000Z", "1000"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "loss")!;
    expect(row.group).toBe("denied");
    expect(result.lines.find((line) => line.key === "denied_losses")!.amount).not.toBe("0");
  });

  it("창 밖(31일 전)에 산 물량은 부인하지 않는다", () => {
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      buy("far", "2025-05-01T00:00:00.000Z", "3000"),
      sell("loss", "2025-06-05T00:00:00.000Z", "1000"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "loss")!;
    expect(row.group).not.toBe("denied");
  });

  it("부인된 손실의 원가 미반영을 침묵하지 않고 한계로 내보인다", () => {
    // 조용히 근사하면 이후 처분 손익이 과대한데도 화면이 확정처럼 말한다.
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      sell("loss", "2025-06-01T00:00:00.000Z", "1000"),
      buy("replace", "2025-06-10T00:00:00.000Z", "1200"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    const limitation = result.limitations.find((row) => row.message.includes("대체 취득분 원가"));

    expect(limitation, "부인 손실 한계가 없다").toBeDefined();
    expect(limitation!.kind).not.toBe("other");
    expect(limitation!.eventIds).toContain("loss");
  });
});

describe("독일 면세한계는 판정에도 드러난다", () => {
  it("면세한계 미만이면 '과세 대상'이라고만 찍지 않는다", () => {
    // €1,000 미만이면 부담이 0인데 도장이 "과세 대상"이면 화면이 계산과 다른 말을 한다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "d1", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1500", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "d1")!;

    expect(result.totals.taxableGains).toBe("500");
    expect(result.totals.estimatedCharge).toBe("0");
    expect(row.label).toMatch(/면세한계/);
    expect(row.label).toMatch(/부담 없음/);
  });

  it("면세한계를 넘으면 그냥 과세 대상이다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "d1", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "5000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "d1")!;

    expect(row.label).toBe("과세 대상");
    expect(result.totals.estimatedCharge).not.toBe("0");
  });

  it("수령 종류에 맞는 조문이 실제 계산 결과에 붙는다", () => {
    // 예전에는 custom judgeIncome이 종류를 무시하고 항상 스테이킹 조문을 달았다.
    const events: TaxEvent[] = [
      { kind: "INCOME", id: "stk", at: "2025-03-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "5000", incomeKind: "STAKING" },
      { kind: "INCOME", id: "air", at: "2025-04-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "5000", incomeKind: "AIRDROP" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const staking = result.judgments.find((item) => item.eventId === "stk")!;
    const airdrop = result.judgments.find((item) => item.eventId === "air")!;
    const ruleset = getRuleSet("DE")!;

    expect(staking.basis).toBe(ruleset.topics.find((topic) => topic.topic === "STAKING")!.basis);
    expect(airdrop.basis).toBe(ruleset.topics.find((topic) => topic.topic === "AIRDROP")!.basis);
    expect(staking.basis).not.toBe(airdrop.basis);
  });
});

describe("부분 상계와 판정 건수", () => {
  it("포르투갈에서 손실과 부분 상계되면 그 사실을 라벨이 말한다", () => {
    // +1000 이익과 -400 손실이면 과세분은 600이다.
    // 이익 행을 그냥 "과세"라고만 하면 1000 전액이 과세된 것처럼 읽힌다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "ACQUIRE", id: "a2", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "win", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
      { kind: "DISPOSE", id: "lose", at: "2025-06-02T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC", quantity: "1", proceeds: "600", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "PT", taxYear: 2025, events });
    const win = result.judgments.find((item) => item.eventId === "win")!;

    expect(result.totals.taxableGains).toBe("600");
    expect(win.amount).toBe("1000");
    expect(win.label).toMatch(/일부 상계됨/);
  });

  it("집계에서 과세분이 줄면 그 이유를 룰셋이 선언한 대로 말한다", () => {
    // 룰셋별로 흩어 놓으면 하나만 빠져도 그 나라 화면이 거짓을 말한다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "ACQUIRE", id: "a2", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "win", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000", fee: "0", trigger: "FIAT" },
      { kind: "DISPOSE", id: "lose", at: "2025-06-02T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC", quantity: "1", proceeds: "400", fee: "0", trigger: "FIAT" },
    ];
    // 조건에 맞는 나라가 하나도 없으면 단언 0개로 통과한다 — 실제 검사 횟수를 센다.
    let checked = 0;
    for (const country of RULE_SET_ORDER) {
      const result = computeTaxEstimate({ country, taxYear: 2025, events });
      const taxable = result.judgments.filter((row) => row.group === "taxable");
      if (taxable.length === 0) continue;
      const shown = sum(taxable.map((row) => row.amount));
      // 행 합계가 집계 과세분보다 크면 그 사실이 라벨에 있어야 한다.
      if (lt(result.totals.taxableGains, shown)) {
        // 손실이 없는데 "상계"라 하면 거짓이다 — 원인은 룰셋이 선언한 조정 방식이어야 한다.
        // resolver를 오라클로 쓰면 resolver와 표가 함께 틀려도 통과하므로 테스트가 소유한 표를 쓴다.
        const EXPECTED_ADJUSTMENT: Record<string, RegExp> = {
          DE: /상계/, US: /상계/, PT: /상계/, ES: /상계/, JP: /상계/,
          FR: /면세/, IT: /공제/, GB: /공제/, CA: /포함률/, AU: /할인/,
          IN: /무시/, KR: /조정 없음/,
        };
        const expected = EXPECTED_ADJUSTMENT[country];
        expect(expected, `${country}에 기대 조정 방식이 없다`).toBeDefined();
        checked += 1;
        for (const row of taxable) {
          expect(row.label, `${country} ${row.eventId}`).toMatch(expected);
        }
      }
    }
    expect(checked, "집계 축소 분기를 한 번도 검사하지 않았다").toBeGreaterThan(0);
  });

  it("상계할 손실이 없으면 그런 말을 붙이지 않는다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "win", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "PT", taxYear: 2025, events });
    expect(result.judgments.find((item) => item.eventId === "win")!.label).toBe("과세 · 365일 미만");
  });

  it("어느 룰셋에서도 기간 안 이벤트가 무판정으로 사라지지 않는다", () => {
    // 예전에 호주 AIRDROP_INITIAL이 income도 acquire도 아니어서 이벤트가 통째로 사라졌다(AU 9 vs 타국 13).
    // 나라마다 과세기간이 다르므로 "같은 건수"가 아니라 "각 나라의 기간 안 이벤트가 전부 판정된다"를 본다.
    const events = createTaxScenarioEvents();
    for (const country of RULE_SET_ORDER) {
      for (const taxYear of [2024, 2025]) {
        const result = computeTaxEstimate({ country, taxYear, events });
        const judged = new Set(result.judgments.map((row) => row.eventId));
        const excluded = new Set(result.excludedEventIds);
        // 기간 **안**의 이벤트가 대상이다.
        // 기간 시작 전 처분은 이번 기간 계산에 없는 게 맞고, 화면도 "기간 밖"이라고 밝힌다.
        const inScope = events.filter(
          (event) =>
            Date.parse(event.at) >= Date.parse(result.period.from) &&
            Date.parse(event.at) < Date.parse(result.period.to),
        );
        for (const event of inScope) {
          expect(
            judged.has(event.id) || excluded.has(event.id),
            `${country} ${taxYear}: ${event.id}(${event.kind}) 무판정 누락`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("기간 경계를 넘는 규칙", () => {
  it("연말 처분 뒤 다음 달 재취득도 캐나다 superficial loss로 부인한다", () => {
    // 표시 기간으로 계산 입력까지 자르면 이 재취득이 보이지 않아 손실이 잘못 인정된다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "next-year", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "loss")!.group).toBe("denied");
  });

  it("기간을 넘겨 본 이벤트가 이번 기간 판정 행으로 올라오지는 않는다", () => {
    // 계산 입력을 넓힌 것이지 인식 기간을 넓힌 게 아니다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "in", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "4000", fee: "0", trigger: "FIAT" },
      { kind: "DISPOSE", id: "after", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "4000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const ids = result.judgments.filter((row) => row.amountKind === "gain").map((row) => row.eventId);
    expect(ids).toContain("in");
    expect(ids).not.toContain("after");
  });
});

describe("호주 CGT 할인은 달력 12개월 기준이다", () => {
  const sell = (at: string) =>
    ({ kind: "DISPOSE", id: "d", at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "5000", fee: "0", trigger: "FIAT" }) as const;
  const buy = ({ kind: "ACQUIRE", id: "a", at: "2024-08-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" }) as const;

  it("정확히 1년(365일)은 아직 비적격이다", () => {
    // 호주 FY2025 = 2025-07-01 ~ 2026-06-30.
    const result = computeTaxEstimate({ country: "AU", taxYear: 2025, events: [buy, sell("2025-08-01T00:00:00.000Z")] });
    expect(result.judgments.find((row) => row.eventId === "d")!.label).toMatch(/비적격/);
  });

  it("1년 하고 하루면 적격이다", () => {
    const result = computeTaxEstimate({ country: "AU", taxYear: 2025, events: [buy, sell("2025-08-02T00:00:00.000Z")] });
    expect(result.judgments.find((row) => row.eventId === "d")!.label).toMatch(/50% 할인 적격/);
  });

  it("사업자로 선언하면 할인이 없다", () => {
    const result = computeTaxEstimate({
      country: "AU", taxYear: 2025,
      events: [buy, sell("2026-01-01T00:00:00.000Z")],
      profile: { isBusiness: true },
    });
    const row = result.judgments.find((item) => item.eventId === "d")!;
    expect(row.label).toMatch(/사업소득/);
    expect(row.label).not.toMatch(/할인 적격/);
  });
});

describe("스페인은 선언한 25% 상계를 실제로 계산한다", () => {
  it("순 자본손실이 저축소득의 25%까지 상계된다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "INCOME", id: "stk", at: "2025-03-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "4000", incomeKind: "STAKING" },
    ];
    const result = computeTaxEstimate({ country: "ES", taxYear: 2025, events });
    const applied = result.lines.find((line) => line.key === "loss_offset_applied")!.amount;

    // 손실 4,000 중 저축소득 4,000의 25% = 1,000까지만 상계된다.
    expect(applied).toBe("1000");
    // 상계를 안 하면 4,000 전액에 세금이 붙는다 — 그보다 작아야 한다.
    const noOffset = computeTaxEstimate({
      country: "ES", taxYear: 2025,
      events: events.filter((event) => event.id !== "loss" && event.id !== "a"),
    });
    expect(Number(result.totals.estimatedCharge)).toBeLessThan(Number(noOffset.totals.estimatedCharge));
  });
});

describe("계산 창을 넓힌 것이 이번 기간 답을 바꾸지 않는다", () => {
  it("기간 뒤 30일 안의 추가 취득이 이번 기간 총액을 흔들지 않는다", () => {
    // look-ahead는 영국 재매수·캐나다 부인 판정에만 쓰여야 한다.
    // 원장이 그 취득분을 이번 기간 손익에 끌어다 쓰면 답이 조용히 달라진다.
    const base: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "d1", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000", fee: "0", trigger: "FIAT" },
    ];
    const withLater: TaxEvent[] = [
      ...base,
      { kind: "ACQUIRE", id: "later", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "5", cost: "9999", fee: "0" },
    ];

    for (const country of RULE_SET_ORDER) {
      const before = computeTaxEstimate({ country, taxYear: 2025, events: base }).totals;
      const after = computeTaxEstimate({ country, taxYear: 2025, events: withLater }).totals;
      expect(after, country).toEqual(before);
    }
  });
});

describe("캐나다는 창이 끝날 때 대체자산을 들고 있는지 본다", () => {
  const buy = (id: string, at: string, cost: string, qty = "1") =>
    ({ kind: "ACQUIRE", id, at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: qty, cost, fee: "0" }) as const;
  const sell = (id: string, at: string, proceeds: string, qty = "1") =>
    ({ kind: "DISPOSE", id, at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: qty, proceeds, fee: "0", trigger: "FIAT" }) as const;

  it("재취득분을 창 안에 다시 팔았으면 부인하지 않는다", () => {
    // 창이 끝날 때 보유하고 있지 않으면 ITA 54의 부인 요건을 못 채운다.
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      sell("loss", "2025-06-01T00:00:00.000Z", "1000"),
      buy("replace", "2025-06-05T00:00:00.000Z", "1100"),
      sell("flip", "2025-06-15T00:00:00.000Z", "1200"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "loss")!.group).not.toBe("denied");
  });

  it("재취득분을 계속 들고 있으면 부인한다", () => {
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      sell("loss", "2025-06-01T00:00:00.000Z", "1000"),
      buy("replace", "2025-06-05T00:00:00.000Z", "1100"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "loss")!.group).toBe("denied");
  });
});

describe("lookahead는 필요한 규칙에만 간다", () => {
  it("기간 뒤 처분·소득·부분처분 취득이 어느 나라 총액도 바꾸지 않는다", () => {
    // 전역으로 넓혔더니 일본 기간평균 원가와 프랑스 자체 집계가 조용히 달라졌다.
    // 부분 처분(총평균법이 평균단가를 쓰는 경로)과 미래 처분·소득을 함께 넣어 확인한다.
    const base: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "part", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "3", proceeds: "6000", fee: "0", trigger: "FIAT" },
    ];
    // 나라마다 기간 끝이 다르다(영국 4/6·호주 7/1). 각자의 기간 직후로 만든다.
    const dayAfter = (iso: string, days: number) =>
      new Date(Date.parse(iso) + days * 86_400_000).toISOString();

    for (const country of RULE_SET_ORDER) {
      const reference = computeTaxEstimate({ country, taxYear: 2025, events: base });
      const polluted: TaxEvent[] = [
        ...base,
        { kind: "ACQUIRE", id: "later-buy", at: dayAfter(reference.period.to, 1), wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", cost: "1", fee: "0" },
        { kind: "DISPOSE", id: "later-sell", at: dayAfter(reference.period.to, 5), wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "9999", fee: "0", trigger: "FIAT" },
        { kind: "INCOME", id: "later-income", at: dayAfter(reference.period.to, 10), wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "9999", incomeKind: "STAKING" },
      ];
      const after = computeTaxEstimate({ country, taxYear: 2025, events: polluted }).totals;
      expect(after, `${country} 기간 밖 이벤트가 총액을 바꿨다`).toEqual(reference.totals);
    }
  });
});

describe("호주 12개월 판정은 윤년에서도 맞다", () => {
  it("2/29 취득의 기념일은 다음 해 2/28이다", () => {
    const buy = { kind: "ACQUIRE", id: "a", at: "2024-02-29T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" } as const;
    const sellOn = (at: string) =>
      computeTaxEstimate({
        country: "AU", taxYear: 2024,
        events: [buy, { kind: "DISPOSE", id: "d", at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "5000", fee: "0", trigger: "FIAT" }],
      }).judgments.find((row) => row.eventId === "d")!.label;

    // 2/28은 아직 12개월이 안 찼고, 3/1은 지났다.
    expect(sellOn("2025-02-28T00:00:00.000Z")).toMatch(/비적격/);
    expect(sellOn("2025-03-01T00:00:00.000Z")).toMatch(/50% 할인 적격/);
  });
});

describe("스페인은 쓴 손실을 다시 이월하지 않는다", () => {
  it("소득 상계로 사용한 몫만큼 이월이 줄어든다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "INCOME", id: "stk", at: "2025-03-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", fmv: "4000", incomeKind: "STAKING" },
    ];
    const result = computeTaxEstimate({ country: "ES", taxYear: 2025, events });

    // 손실 4,000 중 1,000을 썼으니 이월은 3,000이다. 4,000을 넘기면 다음 해에 이중 공제가 된다.
    expect(result.lines.find((line) => line.key === "loss_offset_applied")!.amount).toBe("1000");
    expect(result.lossCarryforward).toBe("3000");
  });
});

describe("영국 재매수 창은 필요한 매칭에만 쓰인다", () => {
  it("30일 창 안 취득이라도 재매수 매칭에 안 걸리면 다른 처분 원가를 바꾸지 않는다", () => {
    // lookahead 취득을 Section104 풀에 그냥 넣으면 이전 처분의 평균원가가 조용히 달라진다.
    const base: TaxEvent[] = [
      { kind: "ACQUIRE", id: "a1", at: "2025-05-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "10", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "d1", at: "2025-08-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "3", proceeds: "60000", fee: "0", trigger: "FIAT" },
    ];
    // 영국 2025 과세기간은 2025-04-06 ~ 2026-04-06. 그 직후(창 안) 대량 취득.
    const withLookahead: TaxEvent[] = [
      ...base,
      { kind: "ACQUIRE", id: "a2", at: "2026-04-08T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "100", cost: "100000", fee: "0" },
    ];

    const before = computeTaxEstimate({ country: "GB", taxYear: 2025, events: base });
    const after = computeTaxEstimate({ country: "GB", taxYear: 2025, events: withLookahead });

    expect(after.totals).toEqual(before.totals);
    expect(after.judgments.filter((row) => row.eventId === "d1").map((row) => row.amount)).toEqual(
      before.judgments.filter((row) => row.eventId === "d1").map((row) => row.amount),
    );
  });

  it("기간 말 처분 직후 30일 안의 재매수는 원가로 매칭한다", () => {
    // 이게 lookahead가 필요한 유일한 이유다. 매칭이 사라지면 원가가 틀린다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1000", fee: "0" },
      { kind: "DISPOSE", id: "sell", at: "2026-04-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "5000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "rebuy", at: "2026-04-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "4900", fee: "0" },
    ];
    const result = computeTaxEstimate({ country: "GB", taxYear: 2025, events });
    const gain = result.judgments.find((row) => row.eventId === "sell" && row.amountKind === "gain")!;

    // 재매수 원가 4,900과 매칭하므로 손익은 100이다. 매칭이 없으면 옛 원가 1,000으로 4,000이 된다.
    expect(gain.amount).toBe("100");
  });
});

describe("캐나다 부인 손실은 다음 기간 원가에 살아 있다", () => {
  it("전년도에 부인된 손실만큼 이번 기간 이익이 줄어든다", () => {
    // 2025: 원가 5,000을 1,000에 팔아 -4,000 손실 → 재취득으로 부인.
    // 2026: 그 대체분(1,100)을 2,000에 판다.
    // 부인 손실이 원가에 더해지므로 실제 원가는 5,100 → 3,100 손실이지 900 이익이 아니다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "DISPOSE", id: "later", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });

    // 전년도 부인 손실 4,000이 원가 가산으로 드러난다.
    expect(result.lines.find((line) => line.key === "prior_denied_acb")!.amount).toBe("4000");
    // 그 결과 이번 기간은 이익이 아니라 손실이다 — 과세분이 없어야 한다.
    expect(result.totals.taxableGains).toBe("0");
    expect(result.totals.estimatedCharge).toBe("0");
  });

  it("전년도 부인이 없으면 원가를 임의로 올리지 않는다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "buy", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "DISPOSE", id: "later", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });

    expect(result.lines.find((line) => line.key === "prior_denied_acb")).toBeUndefined();
    // 900 이익의 포함률 50% = 450.
    expect(result.totals.taxableGains).toBe("450");
  });
});

describe("캐나다 부분 대체 판정", () => {
  it("손실 전부터 들고 있던 물량을 창 안에 팔아도 대체분이 남으면 부인한다", () => {
    // 창 안 처분을 전부 "대체분을 판 것"으로 보면 대체분이 남았는데도 부인하지 않는다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "3", cost: "15000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2025-06-05T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      // 손실 전부터 들고 있던 2개 중 1개를 창 안에 판다 — 대체분은 그대로 남는다.
      { kind: "DISPOSE", id: "other", at: "2025-06-15T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "4000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "loss")!.group).toBe("denied");
  });
});

describe("조정 방식은 연도·프로필로 갈릴 수 있다", () => {
  const profile = {
    marginalRatePercent: "35", otherIncome: "0", filingStatus: "SINGLE" as const,
    isBusiness: false, defiOwnershipTransferred: false, carriedLosses: "0",
  };

  it("인도는 상계가 아니라 무시, 한국은 조정 자체가 없다", () => {
    // 정적으로 offset이라 하면 §115BBH의 상계 금지와 한국의 계산 없음을 거짓 설명한다.
    expect(resolveAdjustment(getRuleSet("IN")!, { taxYear: 2025, profile })).toBe("ignored");
    expect(resolveAdjustment(getRuleSet("KR")!, { taxYear: 2025, profile })).toBe("none");
  });

  it("이탈리아 연간 면세한계는 2026년에 사라진다", () => {
    expect(resolveAdjustment(getRuleSet("IT")!, { taxYear: 2025, profile })).toBe("allowance");
    expect(resolveAdjustment(getRuleSet("IT")!, { taxYear: 2026, profile })).toBe("offset");
  });

  it("캐나다는 사업자면 포함률이 아니다", () => {
    expect(resolveAdjustment(getRuleSet("CA")!, { taxYear: 2025, profile })).toBe("inclusion");
    expect(resolveAdjustment(getRuleSet("CA")!, { taxYear: 2025, profile: { ...profile, isBusiness: true } })).toBe("offset");
  });
});

describe("부인 손실은 한 번만 원가에 반영된다", () => {
  it("대체분을 판 다음 해에는 다시 빼지 않는다", () => {
    // 매년 같은 부인 손실을 빼면 그 자산을 판 뒤에도 영원히 세금이 0이 된다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "DISPOSE", id: "sell26", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "buy27", at: "2027-02-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "500", fee: "0" },
      { kind: "DISPOSE", id: "sell27", at: "2027-08-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000", fee: "0", trigger: "FIAT" },
    ];
    const priorOf = (taxYear: number) =>
      computeTaxEstimate({ country: "CA", taxYear, events }).lines.find((line) => line.key === "prior_denied_acb")?.amount ?? "0";

    // 대체분을 처음 판 2026년에만 반영된다.
    expect(priorOf(2026)).toBe("4000");
    expect(priorOf(2027)).toBe("0");
    // 그래서 2027년은 정상 과세된다(2,500 이익 × 포함률 50%).
    expect(computeTaxEstimate({ country: "CA", taxYear: 2027, events }).totals.taxableGains).toBe("1250");
  });
});

describe("캐나다 부인 판정은 lot 잔량을 본다", () => {
  const buy = (id: string, at: string, cost: string, qty = "1") =>
    ({ kind: "ACQUIRE", id, at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: qty, cost, fee: "0" }) as const;
  const sell = (id: string, at: string, proceeds: string, qty = "1") =>
    ({ kind: "DISPOSE", id, at, wallet: "w", asset: "1:eth", symbol: "ETH", quantity: qty, proceeds, fee: "0", trigger: "FIAT" }) as const;

  it("손실 전에 사서 손실 전에 이미 판 물량은 대체분이 아니다", () => {
    // 수량 합계만 보면 창 안 취득 1건이 있으니 부인해버린다 — 그 물량은 이미 없다.
    const events: TaxEvent[] = [
      buy("old", "2024-01-01T00:00:00.000Z", "5000"),
      buy("pre", "2025-05-20T00:00:00.000Z", "3000"),
      sell("flip", "2025-05-25T00:00:00.000Z", "3100"),
      sell("loss", "2025-06-01T00:00:00.000Z", "1000"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "loss")!.group).not.toBe("denied");
  });

  it("대체분을 절반만 팔면 이연 원가도 절반만 실현된다", () => {
    // 전액을 첫 처분에 붙이면 남은 절반의 원가가 사라진다.
    const events: TaxEvent[] = [
      buy("old", "2024-06-01T00:00:00.000Z", "10000", "2"),
      sell("loss", "2025-12-28T00:00:00.000Z", "2000", "2"),
      buy("replace", "2026-01-10T00:00:00.000Z", "2200", "2"),
      sell("half", "2026-06-01T00:00:00.000Z", "2000", "1"),
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });
    // 부인 손실 8,000 중 절반만 이번 기간에 실현된다.
    expect(result.lines.find((line) => line.key === "prior_denied_acb")!.amount).toBe("4000");
  });

  it("대체분을 다 판 다음 해에는 더 빼지 않는다", () => {
    const events: TaxEvent[] = [
      buy("old", "2024-06-01T00:00:00.000Z", "10000", "2"),
      sell("loss", "2025-12-28T00:00:00.000Z", "2000", "2"),
      buy("replace", "2026-01-10T00:00:00.000Z", "2200", "2"),
      sell("all", "2026-06-01T00:00:00.000Z", "4000", "2"),
      buy("fresh", "2027-02-01T00:00:00.000Z", "1000"),
      sell("later", "2027-08-01T00:00:00.000Z", "3000"),
    ];
    const y2026 = computeTaxEstimate({ country: "CA", taxYear: 2026, events });
    const y2027 = computeTaxEstimate({ country: "CA", taxYear: 2027, events });

    expect(y2026.lines.find((line) => line.key === "prior_denied_acb")!.amount).toBe("8000");
    expect(y2027.lines.find((line) => line.key === "prior_denied_acb")).toBeUndefined();
    expect(y2027.totals.taxableGains).toBe("1000");
  });
});

describe("대체 취득이 여러 건이면 수량 비율로 나눠 얹는다", () => {
  it("두 대체분 중 하나만 팔면 절반만 실현된다", () => {
    // 첫 취득분에만 전액을 붙이면 둘째만 팔았을 때 실현이 0이거나 전액이 튄다.
    const base: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", proceeds: "2000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "r1", at: "2026-01-05T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "ACQUIRE", id: "r2", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
    ];
    const priorFor = (quantity: string) => {
      const events: TaxEvent[] = [
        ...base,
        { kind: "DISPOSE", id: "s", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity, proceeds: "2000", fee: "0", trigger: "FIAT" },
      ];
      return computeTaxEstimate({ country: "CA", taxYear: 2026, events }).lines.find(
        (line) => line.key === "prior_denied_acb",
      )!.amount;
    };

    // 부인 손실 8,000이 두 대체분에 4,000씩 얹힌다.
    expect(priorFor("1")).toBe("4000");
    expect(priorFor("2")).toBe("8000");
  });
});

describe("이미 팔린 창 안 취득분에는 이연 원가를 얹지 않는다", () => {
  it("창 안에 샀다 창 안에 판 lot에 배분하면 그 원가가 어디에도 실현되지 않는다", () => {
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", proceeds: "2000", fee: "0", trigger: "FIAT" },
      // 창 안 취득 둘 중 하나는 창 안에 다시 팔린다.
      { kind: "ACQUIRE", id: "gone", at: "2026-01-02T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "DISPOSE", id: "flip", at: "2026-01-05T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1150", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "kept", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      { kind: "DISPOSE", id: "sell-kept", at: "2026-09-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "2000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });

    // 손실 2개 중 대체분으로 살아남은 것은 1개뿐이다 — ITA 54는 수량 비례로 부인하므로
    // 부인은 절반(4,000)이고, 그 전액이 살아남은 lot에 얹힌다.
    // 이미 팔린 lot에 나눠 얹으면 일부가 어디에도 실현되지 않고 증발한다.
    expect(result.lines.find((line) => line.key === "prior_denied_acb")!.amount).toBe("4000");
    // 나머지 절반은 2025년에 정상 인정된다.
    const y2025 = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(y2025.lines.find((line) => line.key === "denied_losses")!.amount).toBe("4000");
  });
});

describe("이연 원가 배분이 원장 원가법과 같은 모델을 쓴다", () => {
  it("기존 보유분과 대체분이 섞여 있어도 처분 수량 비율로 실현된다", () => {
    // 원장은 이동평균(ACB)인데 여기서만 FIFO로 소진하면
    // "어느 처분이 대체분을 팔았나"가 원장과 갈려 연도별 금액이 달라진다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
      // 남은 2개(기존 1 + 대체 1) 중 1개를 판다.
      { kind: "DISPOSE", id: "half", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "3000", fee: "0", trigger: "FIAT" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });
    const prior = result.lines.find((line) => line.key === "prior_denied_acb")!.amount;

    // 풀 2개 중 1개를 팔았으므로 부인 손실 4,000의 절반만 실현된다.
    // FIFO로 기존분을 먼저 팔았다고 보면 0이 되어 원장과 갈린다.
    expect(prior).toBe("2000");
  });
});

describe("아직 안 팔린 이연 원가도 숨기지 않는다", () => {
  it("대체분을 계속 보유하면 실현은 0이지만 그 사실을 밝힌다", () => {
    // 실현이 0이라고 침묵하면, 사용자는 부인된 손실이 사라진 줄 안다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-12-28T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2026-01-10T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2026, events });

    expect(result.lines.find((line) => line.key === "prior_denied_acb")).toBeUndefined();
    const pending = result.limitations.find((row) => row.message.includes("아직 보유 중인 대체 취득분"));
    expect(pending, "미실현 이연 원가를 밝히지 않았다").toBeDefined();
    expect(pending!.message).toContain("4000");
    expect(pending!.kind).not.toBe("other");
  });
});

describe("교환으로 받은 자산도 superficial 대체분이다", () => {
  it("창 안에서 다른 자산을 팔아 같은 자산을 받아도 손실이 부인된다", () => {
    // 원장은 과세 교환의 수취를 실제 취득 lot으로 넣는다(SWAP_IN).
    // 판정만 매수·수령을 보면 교환 재취득이 부인을 빠져나간다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "eth-old", at: "2024-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "5000", fee: "0" },
      { kind: "DISPOSE", id: "eth-loss", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", proceeds: "1000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "btc", at: "2025-01-01T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC", quantity: "1", cost: "3000", fee: "0" },
      {
        kind: "DISPOSE", id: "swap", at: "2025-06-10T00:00:00.000Z", wallet: "w", asset: "1:btc", symbol: "BTC",
        quantity: "1", proceeds: "3100", fee: "0", trigger: "CRYPTO",
        receives: { asset: "1:eth", symbol: "ETH", quantity: "1" },
      },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    expect(result.judgments.find((row) => row.eventId === "eth-loss")!.group).toBe("denied");
  });
});

describe("부인이 일부면 일부라고 말한다", () => {
  it("손실 2개에 대체 1개면 절반만 부인하고 라벨도 그렇게 말한다", () => {
    // 행 전체를 부인하면 대체 없는 절반의 손실이 사라진다 — 틀린 답이다.
    const events: TaxEvent[] = [
      { kind: "ACQUIRE", id: "old", at: "2024-01-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", cost: "10000", fee: "0" },
      { kind: "DISPOSE", id: "loss", at: "2025-06-01T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "2", proceeds: "2000", fee: "0", trigger: "FIAT" },
      { kind: "ACQUIRE", id: "replace", at: "2025-06-05T00:00:00.000Z", wallet: "w", asset: "1:eth", symbol: "ETH", quantity: "1", cost: "1100", fee: "0" },
    ];
    const result = computeTaxEstimate({ country: "CA", taxYear: 2025, events });
    const row = result.judgments.find((item) => item.eventId === "loss")!;

    expect(row.group).toBe("denied");
    expect(row.label).toMatch(/일부 부인/);
    // 부인 4,000 / 인정 손실 4,000.
    expect(result.lines.find((line) => line.key === "denied_losses")!.amount).toBe("4000");
  });
});
