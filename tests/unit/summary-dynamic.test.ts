import { describe, expect, it } from "vitest";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { MockEventStore } from "@/lib/mock/store";
import { effectiveClassification, needsReview, taxExclusionReason } from "@/lib/review";

describe("dynamic summary", () => {
  it("excludes unknown prices and counts pending review items", () => {
    const fixtures = createNormalizedEventFixtures();
    const store = new MockEventStore(fixtures);
    const summary = store.summary();
    const unknown = fixtures.filter((event) => event.price_status === "UNKNOWN");

    // 오라클이 프로덕션 술어를 그대로 쓰면 그 술어가 틀려도 양쪽이 사이좋게 통과한다.
    // 픽스처를 직접 읽어 **테스트가 소유한** 기대 집합을 만든다.
    const includedIds = fixtures
      .filter((event) => {
        const classification = event.user_override?.classification ?? event.classification;
        if (classification === "UNKNOWN" || classification === "INTERNAL_TRANSFER") return false;
        if (event.price_status === "UNKNOWN" || event.fiat_value === null) return false;
        return Number(event.raw_amount) > 0;
      })
      .map((event) => event.id);
    expect(includedIds.length, "픽스처가 바뀌면 이 기대값을 다시 확인해야 한다").toBeGreaterThan(0);

    const expected = fixtures
      .filter((event) => includedIds.includes(event.id))
      .reduce((total, event) => total + (event.direction === "IN" ? -1 : 1) * Number(event.fiat_value), 0);
    expect(Number(summary.periodPnl)).toBe(expected);

    const reviewIds = fixtures
      .filter((event) => {
        const classification = event.user_override?.classification ?? event.classification;
        return (
          classification === "UNKNOWN" ||
          event.price_status === "UNKNOWN" ||
          event.fiat_value === null ||
          Number(event.raw_amount) <= 0 ||
          event.confidence < 0.5
        );
      })
      .map((event) => event.id);
    expect(summary.pendingReviewCount).toBe(reviewIds.length);
    // 공유 술어와도 어긋나지 않는지 함께 본다(소비자 정합성 계약).
    expect(fixtures.filter(needsReview).map((event) => event.id).sort()).toEqual([...reviewIds].sort());
    expect(
      fixtures.filter((e) => taxExclusionReason(e) === null && effectiveClassification(e) !== "INTERNAL_TRANSFER").map((e) => e.id).sort(),
    ).toEqual([...includedIds].sort());
    expect(unknown.every((event) => event.fiat_value === null)).toBe(true);
  });

  it("recalculates taxable count after reclassification deterministically", () => {
    const store = new MockEventStore();
    const event = store.list({ limit: 15 }).items.find(({ event }) => event.classification === "INTERNAL_TRANSFER" && event.price_status !== "UNKNOWN")!;
    const initial = store.summary();
    store.reclassify(event.event.id, { classification: "SEND", expectedVersion: event.version });
    expect(store.summary().taxableEventCount).toBe(initial.taxableEventCount + 1);
    expect(new MockEventStore().summary()).toEqual(new MockEventStore().summary());
  });
});
