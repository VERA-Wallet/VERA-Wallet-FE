import { describe, expect, it } from "vitest";

import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { runLedger } from "@/lib/tax/ledger";
import { getRuleSet } from "@/lib/tax/rulesets";
import { gt } from "@/lib/tax/decimal";
import { overrideFiatValue, taxExclusionReason } from "@/lib/review";
import { normalizedEventSchema } from "@/lib/schema/normalized-event";
import type { NormalizedEvent, ValueOverride } from "@/lib/schema/normalized-event";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { TaxEvent } from "@/lib/tax/types";

/** 계산에 무관한 칸은 픽스처 첫 이벤트에서 그대로 가져오고, 문제되는 칸만 바꾼다. */
const base = createNormalizedEventFixtures()[0];

function vo(partial: Partial<ValueOverride>): ValueOverride {
  return {
    acquisition_cost: null,
    disposal_value: null,
    incidental_cost: null,
    gas_fee: null,
    price_source: null,
    evidence_url: null,
    deemed_expense_50: false,
    overridden_at: "2027-01-02T00:00:00.000Z",
    ...partial,
  };
}

function event(overrides: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  const merged = { ...base, user_override: null, value_override: null, ...overrides };
  // 방향을 지정하지 않은 케이스는 분류에 맞춰 준다(SEND는 OUT, 그 외는 IN).
  // base가 취득(IN)이라 SEND로만 바꾸면 방향·분류 정합 게이트가 SEND+IN을 모순으로 제외한다.
  if (overrides.direction === undefined) {
    merged.direction = merged.classification === "SEND" ? "OUT" : "IN";
  }
  return merged;
}

describe("value_override — derive가 cost/proceeds/fee에 반영한다", () => {
  it("취득(RECEIVE)의 acquisition_cost가 ACQUIRE 원가가 된다 (fiat_value보다 우선)", () => {
    const derived = deriveTaxEvents([
      event({ id: "r", classification: "RECEIVE", price_status: "RESOLVED", fiat_value: "400000.00", value_override: vo({ acquisition_cost: "1000000" }) }),
    ]);
    const acquire = derived.events.find((e) => e.id === "r");
    expect(acquire?.kind).toBe("ACQUIRE");
    expect(acquire?.kind === "ACQUIRE" && acquire.cost).toBe("1000000");
  });

  it("처분(SEND)의 disposal_value가 DISPOSE 양도가액이 된다", () => {
    const derived = deriveTaxEvents([
      event({ id: "s", classification: "SEND", price_status: "RESOLVED", fiat_value: "400000.00", value_override: vo({ disposal_value: "9000000" }) }),
    ]);
    const dispose = derived.events.find((e) => e.id === "s");
    expect(dispose?.kind).toBe("DISPOSE");
    expect(dispose?.kind === "DISPOSE" && dispose.proceeds).toBe("9000000");
    // 취득가액·의제를 지정하지 않았으면 원장이 원가를 정한다.
    expect(dispose?.kind === "DISPOSE" && dispose.cost).toBeUndefined();
  });

  it("부대비용 + 가스비(원화)가 합산돼 fee가 된다", () => {
    const derived = deriveTaxEvents([
      event({ id: "f", classification: "RECEIVE", price_status: "RESOLVED", fiat_value: "400000.00", value_override: vo({ acquisition_cost: "1000000", incidental_cost: "5000", gas_fee: "3000" }) }),
    ]);
    const acquire = derived.events.find((e) => e.id === "f");
    expect(acquire?.kind === "ACQUIRE" && acquire.fee).toBe("8000");
    // 가스비를 반영했으므로 "가스비 미반영" 한계가 붙지 않는다.
    expect(derived.assumptions.some((line) => line.includes("가스비"))).toBe(false);
  });

  it("override가 없으면 기존대로 fiat_value/0을 쓰고 가스비 한계가 붙는다", () => {
    const derived = deriveTaxEvents([
      event({ id: "plain", classification: "RECEIVE", price_status: "RESOLVED", fiat_value: "400000.00" }),
    ]);
    const acquire = derived.events.find((e) => e.id === "plain");
    expect(acquire?.kind === "ACQUIRE" && acquire.cost).toBe("400000.00");
    expect(acquire?.kind === "ACQUIRE" && acquire.fee).toBe("0");
    expect(derived.assumptions.some((line) => line.includes("가스비"))).toBe(true);
  });
});

describe("50% 필요경비 의제 — cost = proceeds × 0.5", () => {
  it("deemed_expense_50이 켜지면 처분 원가가 양도가액의 절반이다", () => {
    const derived = deriveTaxEvents([
      event({ id: "d50", classification: "SEND", price_status: "RESOLVED", fiat_value: "50000000.00", value_override: vo({ deemed_expense_50: true }) }),
    ]);
    const dispose = derived.events.find((e) => e.id === "d50");
    expect(dispose?.kind === "DISPOSE" && dispose.cost).toBe("25000000");
  });

  it("50% 의제는 acquisition_cost 직접 입력보다 우선한다", () => {
    const derived = deriveTaxEvents([
      event({ id: "d50b", classification: "SEND", price_status: "RESOLVED", fiat_value: "50000000.00", value_override: vo({ deemed_expense_50: true, acquisition_cost: "999" }) }),
    ]);
    const dispose = derived.events.find((e) => e.id === "d50b");
    expect(dispose?.kind === "DISPOSE" && dispose.cost).toBe("25000000");
  });
});

describe("취득가 0원 없애기 — 가격 미확정 + override는 계산 대상이 된다", () => {
  it("price UNKNOWN·fiat_value null이라도 취득가액 override가 있으면 제외되지 않는다", () => {
    const withOverride = event({ id: "u", classification: "RECEIVE", price_status: "UNKNOWN", fiat_value: null, value_override: vo({ acquisition_cost: "1000000" }) });
    expect(overrideFiatValue(withOverride)).toBe("1000000");
    expect(taxExclusionReason(withOverride)).toBeNull();
    const derived = deriveTaxEvents([withOverride]);
    expect(derived.excludedEventIds).toEqual([]);
    const acquire = derived.events.find((e) => e.id === "u");
    expect(acquire?.kind === "ACQUIRE" && acquire.cost).toBe("1000000");
  });

  it("override가 없으면 price UNKNOWN은 여전히 가격 확인 필요로 제외된다", () => {
    const withoutOverride = event({ id: "u2", classification: "RECEIVE", price_status: "UNKNOWN", fiat_value: null });
    expect(taxExclusionReason(withoutOverride)).toBe("가격 확인 필요");
    expect(deriveTaxEvents([withoutOverride]).excludedEventIds).toEqual(["u2"]);
  });
});

describe("스키마 하위호환", () => {
  it("value_override 키가 없는 옛 이벤트도 파싱되고 null로 채워진다", () => {
    const raw: Record<string, unknown> = { ...createNormalizedEventFixtures()[0] };
    delete raw.value_override;
    const parsed = normalizedEventSchema.parse(raw);
    expect(parsed.value_override).toBeNull();
  });

  it("value_override의 일부 칸만 온 payload는 나머지를 기본값으로 채운다", () => {
    const parsed = normalizedEventSchema.parse({
      ...createNormalizedEventFixtures()[0],
      value_override: { acquisition_cost: "1000000", overridden_at: "2027-01-02T00:00:00.000Z" },
    });
    expect(parsed.value_override).toEqual({
      acquisition_cost: "1000000",
      disposal_value: null,
      incidental_cost: null,
      gas_fee: null,
      price_source: null,
      evidence_url: null,
      deemed_expense_50: false,
      overridden_at: "2027-01-02T00:00:00.000Z",
    });
  });
});

describe("deemedFmv — KR 의제취득가액이 원장 원가에 반영된다", () => {
  const krLedger = getRuleSet("KR")!.ledger;
  // 시행 경계(2027-01-01) 전에 취득해 계속 보유한 분을 시행 후에 처분한다.
  const krEvents: TaxEvent[] = [
    { kind: "ACQUIRE", id: "a", at: "2026-06-01T00:00:00.000Z", wallet: "w", asset: "1:native", symbol: "ETH", quantity: "10", cost: "10000000", fee: "0" },
    { kind: "DISPOSE", id: "d", at: "2027-06-01T00:00:00.000Z", wallet: "w", asset: "1:native", symbol: "ETH", quantity: "10", proceeds: "50000000", fee: "0", trigger: "FIAT" },
  ];

  it("시가 미입력이면 실제 취득단가로, 입력하면 Max(시가, 실제)로 원가가 오른다", () => {
    const without = runLedger(krEvents, krLedger);
    const withFmv = runLedger(krEvents, krLedger, [], (asset) => (asset === "1:native" ? "3000000" : undefined));
    expect(without.gains[0].cost).toBe("10000000");
    expect(without.gains[0].gain).toBe("40000000");
    // 시가 300만/개 > 실제 100만/개 → 의제취득가액 3,000만, 손익 2,000만으로 축소.
    expect(withFmv.gains[0].cost).toBe("30000000");
    expect(withFmv.gains[0].gain).toBe("20000000");
  });

  it("computeTaxEstimate가 deemedFmv를 실어 보내면 KR 예상 부담이 준다", () => {
    const input = { country: "KR", events: krEvents, taxYear: 2027 };
    const without = computeTaxEstimate(input);
    const withFmv = computeTaxEstimate({ ...input, deemedFmv: { "1:native": "3000000" } });
    expect(without.lines.find((line) => line.key === "net_gains")?.amount).toBe("40000000");
    expect(withFmv.lines.find((line) => line.key === "net_gains")?.amount).toBe("20000000");
    expect(gt(without.totals.estimatedCharge, withFmv.totals.estimatedCharge)).toBe(true);
  });
});

describe("처분 원가(50% 의제·직접 입력)가 원장의 취득가 0원을 없앤다", () => {
  const krLedger = getRuleSet("KR")!.ledger;

  it("원장에 없는 수량을 처분해도 cost가 지정되면 취득가 0원 경고가 없다", () => {
    const events: TaxEvent[] = [
      { kind: "DISPOSE", id: "d", at: "2027-06-01T00:00:00.000Z", wallet: "w", asset: "1:native", symbol: "ETH", quantity: "10", proceeds: "50000000", fee: "0", trigger: "FIAT", cost: "25000000" },
    ];
    const result = runLedger(events, krLedger);
    expect(result.gains[0].cost).toBe("25000000");
    expect(result.gains[0].gain).toBe("25000000");
    expect(result.warnings).toEqual([]);
  });

  it("cost가 없으면 같은 처분이 취득가 0원 경고를 낸다", () => {
    const events: TaxEvent[] = [
      { kind: "DISPOSE", id: "d", at: "2027-06-01T00:00:00.000Z", wallet: "w", asset: "1:native", symbol: "ETH", quantity: "10", proceeds: "50000000", fee: "0", trigger: "FIAT" },
    ];
    const result = runLedger(events, krLedger);
    expect(result.gains[0].cost).toBe("0");
    expect(result.warnings.some((line) => line.includes("취득가액 0"))).toBe(true);
  });
});
