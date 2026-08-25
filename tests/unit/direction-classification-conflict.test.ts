import { describe, expect, it } from "vitest";

import {
  directionClassificationConflict,
  needsReview,
  reviewReason,
  taxExclusionReason,
} from "@/lib/review";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { EXCLUSION_SUFFIX } from "@/lib/tax/limitations";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 방향·분류 정합 게이트.
 *
 * RECEIVE(취득)는 자산이 들어온 것이라 IN, SEND(처분)는 나간 것이라 OUT이어야 한다.
 * 뒤집힌 데이터(RECEIVE+OUT·SEND+IN)를 그대로 엔진에 넣으면 나간 자산을 취득으로,
 * 들어온 자산을 처분으로 기록해 총평균 단가를 오염시키므로 진입 전에 잡는다.
 */

/** 데이터 정합만 검증하므로 계산에 무관한 칸은 첫 픽스처에서 그대로 가져온다. */
const base = createNormalizedEventFixtures(2025, new Date("2026-08-23T00:00:00.000Z"))[0];

function event(overrides: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  return {
    ...base,
    price_status: "RESOLVED",
    fiat_value: "1000000.00",
    confidence: 0.9,
    raw_amount: "1000000000000000000",
    decimals: 18,
    user_override: null,
    value_override: null,
    ...overrides,
  };
}

describe("방향·분류 정합 술어", () => {
  it("RECEIVE는 IN이어야 하고, SEND는 OUT이어야 한다", () => {
    expect(directionClassificationConflict(event({ id: "r-out", classification: "RECEIVE", direction: "OUT" }))).toBe(true);
    expect(directionClassificationConflict(event({ id: "s-in", classification: "SEND", direction: "IN" }))).toBe(true);
  });

  it("정합한 취득·처분은 통과한다(오검출 없음)", () => {
    expect(directionClassificationConflict(event({ id: "r-in", classification: "RECEIVE", direction: "IN" }))).toBe(false);
    expect(directionClassificationConflict(event({ id: "s-out", classification: "SEND", direction: "OUT" }))).toBe(false);
  });

  it("EXCHANGE·INTERNAL_TRANSFER는 IN·OUT 어느 쪽도 정상이라 잡지 않는다", () => {
    for (const classification of ["EXCHANGE", "INTERNAL_TRANSFER"] as Classification[]) {
      for (const direction of ["IN", "OUT"] as const) {
        expect(
          directionClassificationConflict(event({ id: `${classification}-${direction}`, classification, direction })),
          `${classification}+${direction}`,
        ).toBe(false);
      }
    }
  });

  it("UNKNOWN은 방향 제약이 없다(분류 미확정은 별도 사유로 걸린다)", () => {
    expect(directionClassificationConflict(event({ id: "u-in", classification: "UNKNOWN", direction: "IN" }))).toBe(false);
    expect(directionClassificationConflict(event({ id: "u-out", classification: "UNKNOWN", direction: "OUT" }))).toBe(false);
  });

  it("사용자가 정합한 원본을 재분류한 것은 오검출하지 않는다", () => {
    // 체인 IN·자동 RECEIVE(정합)를 사용자가 흐름 목적상 SEND로 덮어썼다.
    // 원본이 어긋난 게 아니므로 이 게이트가 잡을 대상이 아니다(원본 classification으로 판정).
    const reclassifiedOnCleanRaw = event({
      id: "reclassified",
      classification: "RECEIVE",
      direction: "IN",
      user_override: { classification: "SEND", reason: null, overridden_at: "2025-07-02T00:00:00.000Z" },
    });
    expect(directionClassificationConflict(reclassifiedOnCleanRaw)).toBe(false);
  });
});

describe("모순은 확인 필요 게이트로 표면화된다", () => {
  const conflict = event({ id: "recv-out", classification: "RECEIVE", direction: "OUT" });

  it("모순 건은 계산 제외 사유가 '방향·분류 불일치'다", () => {
    expect(taxExclusionReason(conflict)).toBe("방향·분류 불일치");
    expect(needsReview(conflict)).toBe(true);
    expect(reviewReason(conflict)).toBe("방향·분류 불일치");
  });

  it("파생은 모순 건을 제외하고 그 사유·event id를 한계로 남긴다", () => {
    const derived = deriveTaxEvents([conflict]);
    expect(derived.excludedEventIds).toEqual(["recv-out"]);
    expect(derived.events).toHaveLength(0);
    const limitation = derived.limitations.find((row) => row.message.startsWith("방향·분류 불일치"));
    expect(limitation?.kind).toBe("excluded");
    expect(limitation?.message).toBe(`방향·분류 불일치${EXCLUSION_SUFFIX}`);
    expect(limitation?.eventIds).toEqual(["recv-out"]);
  });
});

describe("기본 픽스처의 알려진 모순", () => {
  const events = createNormalizedEventFixtures(2025, new Date("2026-08-23T00:00:00.000Z"));

  it("정확히 6건(event-06·07·16·17·30·31)만 모순으로 잡고 나머지는 오검출 0", () => {
    const flagged = events.filter(directionClassificationConflict).map((e) => e.id);
    expect(flagged).toEqual(["event-06", "event-07", "event-16", "event-17", "event-30", "event-31"]);
  });

  it("알려진 예시가 그대로 잡힌다: event-06=OUT인데 RECEIVE, event-07=IN인데 SEND", () => {
    const byId = new Map(events.map((e) => [e.id, e]));
    const six = byId.get("event-06")!;
    const seven = byId.get("event-07")!;
    expect([six.direction, six.classification]).toEqual(["OUT", "RECEIVE"]);
    expect([seven.direction, seven.classification]).toEqual(["IN", "SEND"]);
    expect(directionClassificationConflict(six)).toBe(true);
    expect(directionClassificationConflict(seven)).toBe(true);
    expect(needsReview(six)).toBe(true);
    expect(needsReview(seven)).toBe(true);
  });

  it("모순 건은 파생 계산에서 빠지고 확인 필요 집합에 포함된다(계산 제외 ⊆ 확인 필요)", () => {
    const derived = deriveTaxEvents(events);
    const review = new Set(events.filter(needsReview).map((e) => e.id));
    for (const id of ["event-06", "event-07", "event-16", "event-17", "event-31"]) {
      expect(derived.excludedEventIds, id).toContain(id);
      expect(review.has(id), id).toBe(true);
    }
  });
});

describe("fiat_value 공란은 조용한 제외가 아니라 확인 필요로 표면화된다", () => {
  it("가격 미확정(price UNKNOWN·fiat_value null)은 '가격 확인 필요'로 잡힌다", () => {
    const blank = event({ id: "blank", classification: "RECEIVE", direction: "IN", price_status: "UNKNOWN", fiat_value: null });
    expect(taxExclusionReason(blank)).toBe("가격 확인 필요");
    expect(needsReview(blank)).toBe(true);
    expect(deriveTaxEvents([blank]).excludedEventIds).toEqual(["blank"]);
  });

  it("금액 override로 원화 금액을 채우면 큐에서 빠진다(P0-4 입력과 연결)", () => {
    const filled = event({
      id: "filled",
      classification: "RECEIVE",
      direction: "IN",
      price_status: "UNKNOWN",
      fiat_value: null,
      value_override: {
        acquisition_cost: "1000000",
        disposal_value: null,
        incidental_cost: null,
        gas_fee: null,
        price_source: "업비트 종가",
        evidence_url: null,
        deemed_expense_50: false,
        overridden_at: "2027-01-02T00:00:00.000Z",
      },
    });
    expect(taxExclusionReason(filled)).toBeNull();
    expect(needsReview(filled)).toBe(false);
  });
});
