import { describe, expect, it } from "vitest";

import { deriveTaxEvents } from "@/lib/tax/derive";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { MockEventStore } from "@/lib/mock/store";
import { MockTaxEngine } from "@/lib/mock/tax-engine";
import { assetFlow, isLowConfidence, needsReview, reviewReason, taxExclusionReason } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const base = createNormalizedEventFixtures()[0];
const healthy: NormalizedEvent = {
  ...base,
  classification: "RECEIVE",
  price_status: "RESOLVED",
  fiat_value: "1000.00",
  confidence: 0.9,
  raw_amount: "100000000000000000",
  decimals: 18,
  user_override: null,
};

describe("확인 필요와 계산 제외는 하나의 술어를 쓴다", () => {
  it("계산에서 제외된 이벤트는 반드시 확인 필요 목록에도 있다", () => {
    const excluded: NormalizedEvent[] = [
      { ...healthy, id: "no-class", classification: "UNKNOWN" },
      { ...healthy, id: "no-price", price_status: "UNKNOWN", fiat_value: null },
      { ...healthy, id: "zero-qty", raw_amount: "0" },
    ];
    const derived = deriveTaxEvents(excluded);
    expect(derived.excludedEventIds.sort()).toEqual(["no-class", "no-price", "zero-qty"]);
    // pass10 재현 ①: 세금 화면이 "계산에서 빠짐"이라 하는데 대시보드 확인 필요 탭이 비면 모순이다.
    for (const event of excluded) {
      expect(needsReview(event), `${event.id} 확인 필요`).toBe(true);
    }
  });

  it("신뢰도만 낮은 거래는 확인 필요지만 계산에는 들어간다", () => {
    // pass10 재현 ②: 대시보드가 "확정해야 계산에 포함됩니다"라고 하면 거짓이 된다.
    const lowConfidence: NormalizedEvent = { ...healthy, id: "low-conf", confidence: 0.3 };
    expect(isLowConfidence(lowConfidence)).toBe(true);
    expect(needsReview(lowConfidence)).toBe(true);
    expect(taxExclusionReason(lowConfidence)).toBeNull();
    const derived = deriveTaxEvents([lowConfidence]);
    expect(derived.excludedEventIds).toEqual([]);
    expect(derived.events).toHaveLength(1);
  });

  it("사용자 재분류가 원본 UNKNOWN을 덮으면 계산에 들어간다", () => {
    const overridden: NormalizedEvent = {
      ...healthy,
      id: "fixed",
      classification: "UNKNOWN",
      user_override: { classification: "RECEIVE", reason: "확정", overridden_at: "2025-02-01T00:00:00.000Z" },
    };
    expect(taxExclusionReason(overridden)).toBeNull();
    expect(needsReview(overridden)).toBe(false);
    expect(deriveTaxEvents([overridden]).events).toHaveLength(1);
  });

  it("확인 필요 사유가 제외 사유와 같은 문구를 쓴다", () => {
    expect(reviewReason({ ...healthy, price_status: "UNKNOWN", fiat_value: null })).toBe("가격 확인 필요");
    expect(reviewReason({ ...healthy, classification: "UNKNOWN" })).toBe("분류 확인 필요");
    expect(reviewReason({ ...healthy, raw_amount: "0" })).toBe("수량 확인 필요");
    expect(reviewReason({ ...healthy, confidence: 0.1 })).toBe("신뢰도 낮음");
  });

  it("기본 목 픽스처에서도 제외 집합이 확인 필요 집합의 부분집합이다", () => {
    const events = createNormalizedEventFixtures();
    const derived = deriveTaxEvents(events);
    const review = new Set(events.filter(needsReview).map((event) => event.id));
    for (const id of derived.excludedEventIds) {
      expect(review.has(id), `${id}는 확인 필요에 있어야 한다`).toBe(true);
    }
    // 신뢰도 낮은 건이 있으므로 확인 필요가 제외보다 넓어야 한다.
    expect(review.size).toBeGreaterThan(derived.excludedEventIds.length);
  });
});

describe("서버 요약도 같은 술어를 쓴다", () => {
  it("수량 0 이벤트는 과세 대상이 아니고 확인 필요로 잡힌다", () => {
    // pass11 재현 ①: 요약이 "과세 대상 1건 · 확인 필요 0건"이면 세금 화면과 모순된다.
    const store = new MockEventStore([{ ...healthy, id: "zero-qty", raw_amount: "0" }]);
    const summary = store.summary();
    expect(summary.taxableEventCount).toBe(0);
    expect(summary.pendingReviewCount).toBe(1);
    expect(deriveTaxEvents([{ ...healthy, id: "zero-qty", raw_amount: "0" }]).excludedEventIds).toEqual(["zero-qty"]);
  });

  it("사용자가 확정한 재분류가 요약에 반영된다", () => {
    // pass11 재현 ②: 요약이 원본 UNKNOWN을 세면 "확인 필요 1건"인데 계산엔 들어가 모순된다.
    const overridden: NormalizedEvent = {
      ...healthy,
      id: "fixed",
      classification: "UNKNOWN",
      user_override: { classification: "RECEIVE", reason: "확정", overridden_at: "2025-02-01T00:00:00.000Z" },
    };
    const summary = new MockEventStore([overridden]).summary();
    expect(summary.taxableEventCount).toBe(1);
    expect(summary.pendingReviewCount).toBe(0);
    expect(deriveTaxEvents([overridden]).events).toHaveLength(1);
  });

  it("요약의 확인 필요 수가 확인 필요 술어와 정확히 일치한다", () => {
    // 프로덕션 술어를 그대로 오라클로 쓰면 술어가 틀려도 함께 틀려 통과한다.
    // 테스트가 소유한 조건으로 기대 집합을 따로 만들어 대조한다.
    const events = createNormalizedEventFixtures();
    const summary = new MockEventStore(events).summary();
    // 확인 필요 = 계산 제외 사유(분류 미상 / 가격 미확정 / 수량 0) 또는 낮은 신뢰도.
    const expected = events.filter((event) => {
      const classification = event.user_override?.classification ?? event.classification;
      if (classification === "UNKNOWN") return true;
      if (event.price_status === "UNKNOWN" || event.fiat_value === null) return true;
      // Number()는 극소수 raw에서 Decimal 정규화와 갈릴 수 있다 — 문자열로 0 여부를 본다.
      if (/^0+(\.0+)?$/.test(event.raw_amount)) return true;
      // 신뢰도 하한 0.5 — 이 숫자가 바뀌면 이 테스트가 먼저 깨져야 한다.
      return event.confidence < 0.5;
    });

    expect(expected.length, "확인 필요 이벤트가 하나도 없는 픽스처로는 검증되지 않는다").toBeGreaterThan(0);
    expect(summary.pendingReviewCount).toBe(expected.length);
    // 프로덕션 술어와도 같아야 한다 — 두 정의가 갈리면 화면과 계산이 어긋난다.
    expect(events.filter(needsReview).map((event) => event.id)).toEqual(expected.map((event) => event.id));
  });
});

describe("세금 어댑터가 과세기간 밖 이벤트를 확인 필요로 세지 않는가", () => {
  const walletEvents: NormalizedEvent[] = [
    { ...healthy, id: "e-2025-ok", block_timestamp: "2025-06-01T00:00:00.000Z" },
    { ...healthy, id: "e-2025-bad", block_timestamp: "2025-06-02T00:00:00.000Z", price_status: "UNKNOWN", fiat_value: null },
  ];
  const engine = new MockTaxEngine(() => walletEvents);

  it("2024년 계산에는 2025년 제외 건이 잡히지 않는다", async () => {
    // pass12 재현: 기간 밖 이벤트가 "확인이 필요해 계산에서 빠짐"으로 표시되던 결함.
    const estimate = await engine.estimate({ country: "DE", taxYear: 2024, source: "wallet" });
    expect(estimate.excludedEventIds).toEqual([]);
  });

  it("해당 기간 안의 제외 건은 그대로 잡힌다", async () => {
    const estimate = await engine.estimate({ country: "DE", taxYear: 2025, source: "wallet" });
    expect(estimate.excludedEventIds).toEqual(["e-2025-bad"]);
  });
});

describe("분류 배지와 판정 도장이 어긋나지 않는가", () => {
  it("사용자가 송금으로 확정하면 방향이 IN이어도 취득으로 찍지 않는다", () => {
    // 재현: 화면이 배지에 "송금", 도장에 "취득 · 원가 기록"을 동시에 보여주던 결함.
    const sendButIn: NormalizedEvent = {
      ...healthy,
      id: "send-in",
      direction: "IN",
      classification: "UNKNOWN",
      user_override: { classification: "SEND", reason: "확정", overridden_at: "2025-02-01T00:00:00.000Z" },
    };
    const derived = deriveTaxEvents([sendButIn]);
    expect(derived.events).toHaveLength(1);
    expect(derived.events[0].kind).toBe("DISPOSE");
  });

  it("수신으로 확정하면 방향이 OUT이어도 취득이다", () => {
    const receiveButOut: NormalizedEvent = {
      ...healthy,
      id: "recv-out",
      direction: "OUT",
      classification: "RECEIVE",
      user_override: null,
    };
    expect(deriveTaxEvents([receiveButOut]).events[0].kind).toBe("ACQUIRE");
  });

  it("파생된 모든 이벤트의 종류가 유효 분류와 일치한다", () => {
    const all = createNormalizedEventFixtures();
    const derived = deriveTaxEvents(all);
    const byId = new Map(all.map((event) => [event.id, event]));
    for (const tax of derived.events) {
      const source = byId.get(tax.id)!;
      const classification = source.user_override?.classification ?? source.classification;
      // RECEIVE → ACQUIRE, SEND/EXCHANGE → DISPOSE. 그 외 분류는 파생되지 않는다.
      expect(tax.kind, `${tax.id}(${classification})`).toBe(classification === "RECEIVE" ? "ACQUIRE" : "DISPOSE");
      expect(["RECEIVE", "SEND", "EXCHANGE"]).toContain(classification);
    }
  });

  it("쓴 것·얻은 것의 갈래가 세무 파생과 정확히 같다", () => {
    // 화면이 direction으로 색을 칠하면 같은 거래를 두고 목록은 "얻음", 원장은 "처분"이라 말한다.
    const sendButIn: NormalizedEvent = {
      ...healthy,
      id: "send-in",
      direction: "IN",
      classification: "UNKNOWN",
      user_override: { classification: "SEND", reason: "확정", overridden_at: "2025-02-01T00:00:00.000Z" },
    };
    expect(assetFlow(sendButIn)).toBe("out");
    expect(assetFlow({ ...healthy, direction: "OUT", classification: "RECEIVE" })).toBe("in");
    expect(assetFlow({ ...healthy, classification: "EXCHANGE" })).toBe("out");
    // 처분이 아니거나 계산에 들어가지 않는 건은 어느 쪽도 아니다.
    expect(assetFlow({ ...healthy, classification: "INTERNAL_TRANSFER" })).toBe("neutral");
    expect(assetFlow({ ...healthy, classification: "UNKNOWN", user_override: null })).toBe("neutral");
  });

  it("픽스처 전 건에서 흐름과 파생 종류가 일치한다", () => {
    const all = createNormalizedEventFixtures();
    const derived = deriveTaxEvents(all);
    const kinds = new Map(derived.events.map((tax) => [tax.id, tax.kind]));
    for (const event of all) {
      const flow = assetFlow(event);
      // 계산에서 빠진 건은 원장에 없다. 그래도 자산이 오간 방향은 사실이라 부호는 붙는다.
      if (taxExclusionReason(event) !== null) continue;
      if (flow === "neutral") {
        // 부호 없는 건은 원장에도 없다.
        expect(kinds.has(event.id), event.id).toBe(false);
        continue;
      }
      expect(kinds.get(event.id), `${event.id}(${flow})`).toBe(flow === "in" ? "ACQUIRE" : "DISPOSE");
    }
  });
});
