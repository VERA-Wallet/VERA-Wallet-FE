import { describe, expect, it } from "vitest";

import { convertEventsToCurrency, fxDatesNeeded, utcDay } from "@/lib/tax/fx-convert";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { FIXTURE_TAX_YEAR } from "../fixtures/tax-year";

const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR);
const priced = events.find((event) => event.fiat_value !== null)!;

function withOverride(event: NormalizedEvent): NormalizedEvent {
  return {
    ...event,
    value_override: {
      acquisition_cost: "1000",
      disposal_value: "2000",
      incidental_cost: "10",
      gas_fee: "5",
      price_source: "test",
      evidence_url: null,
      deemed_expense_50: false,
      overridden_at: "2025-01-01T00:00:00.000Z",
    },
  };
}

describe("fxDatesNeeded", () => {
  it("룰셋 통화와 같은 이벤트는 환율을 요구하지 않는다", () => {
    expect(fxDatesNeeded(events, "KRW")).toEqual([]);
  });

  it("다른 통화 이벤트는 원통화별로 거래일(UTC)을 모은다", () => {
    const needs = fxDatesNeeded(events, "USD");
    expect(needs).toHaveLength(1);
    expect(needs[0].from).toBe("KRW");
    expect(needs[0].dates).toEqual([...new Set(events.filter((e) => e.fiat_value !== null).map((e) => utcDay(e.block_timestamp)))].sort());
  });

  it("금액이 하나도 없는 이벤트는 환율을 요구하지 않는다 — 어차피 가격 확인 필요로 빠진다", () => {
    const moneyless: NormalizedEvent = { ...priced, fiat_value: null, price_status: "UNKNOWN", value_override: null };
    expect(fxDatesNeeded([moneyless], "USD")).toEqual([]);
  });
});

describe("convertEventsToCurrency", () => {
  const day = utcDay(priced.block_timestamp);
  const tables = new Map([["KRW", new Map([[day, "0.001"]])]]);

  it("fiat_value와 사용자 입력 금액을 같은 환율로 바꾸고 통화 라벨을 바꾼다", () => {
    const { events: out, unconvertibleIds } = convertEventsToCurrency([withOverride(priced)], "USD", tables);
    expect(unconvertibleIds).toEqual([]);
    const [converted] = out;
    expect(converted.fiat_currency).toBe("USD");
    expect(Number(converted.fiat_value)).toBeCloseTo(Number(priced.fiat_value) * 0.001, 6);
    expect(converted.value_override).toMatchObject({ acquisition_cost: "1", disposal_value: "2", incidental_cost: "0.01", gas_fee: "0.005" });
    // 수량·시각·분류는 손대지 않는다.
    expect(converted.raw_amount).toBe(priced.raw_amount);
    expect(converted.block_timestamp).toBe(priced.block_timestamp);
    expect(converted.classification).toBe(priced.classification);
  });

  it("거래일 환율이 없으면 이벤트를 빼고 id를 알린다 — 0이나 다른 날 환율을 지어내지 않는다", () => {
    const { events: out, unconvertibleIds } = convertEventsToCurrency([priced], "USD", new Map([["KRW", new Map()]]));
    expect(out).toEqual([]);
    expect(unconvertibleIds).toEqual([priced.id]);
  });

  it("같은 통화 이벤트는 그대로 통과한다", () => {
    const { events: out } = convertEventsToCurrency([priced], "KRW", new Map());
    expect(out[0]).toBe(priced);
  });
});
