import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/summary/route";
import { POST as present } from "@/app/api/auth/did/present/route";
import { authStore } from "@/lib/composition-root.server";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { MockEventStore } from "@/tests/support/doubles/mock-event-store";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

function eventAt(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return { ...createNormalizedEventFixtures()[0], ...overrides };
}

async function didSessionCookie() {
  const response = await present(new Request("http://localhost/api/auth/did/present", {
    method: "POST",
    body: JSON.stringify({ country: "KR" }),
  }));
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";")[0];
}

async function completedSessionCookie() {
  const cookie = await didSessionCookie();
  const sessionId = cookie.split("=")[1];
  await authStore.set(sessionId, {
    didVerified: true,
    countryCode: "KR",
    walletAddress: "0x0000000000000000000000000000000000000001",
    walletVerification: "siwe",
    didExpiresAt: Date.now() + 30 * 60_000,
    walletExpiresAt: Date.now() + 30 * 60_000,
  });
  return cookie;
}

describe("summary period boundary [from, to)", () => {
  it("excludes events at the exclusive upper bound and keeps default all-events range", () => {
    const boundary = "2025-02-01T00:00:00.000Z";
    const store = new MockEventStore([
      eventAt({ id: "a", block_timestamp: "2025-01-15T00:00:00.000Z", direction: "OUT", fiat_value: "100.00", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null }),
      eventAt({ id: "b", block_timestamp: boundary, direction: "OUT", fiat_value: "50.00", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null }),
    ]);
    const bounded = store.summary({ from: "2025-01-01T00:00:00.000Z", to: boundary });
    expect(bounded.taxableEventCount).toBe(1);
    expect(bounded.periodPnl).toBe("100.00");
    const unbounded = store.summary();
    expect(unbounded.taxableEventCount).toBe(2);
    expect(unbounded.periodPnl).toBe("150.00");
  });

  it("preserves decimal-string scale verbatim across mixed scales", () => {
    const store = new MockEventStore([
      eventAt({ id: "a", block_timestamp: "2025-01-01T00:00:00.000Z", direction: "OUT", fiat_value: "3.7000", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null }),
      eventAt({ id: "b", block_timestamp: "2025-01-02T00:00:00.000Z", direction: "IN", fiat_value: "1.50", price_status: "RESOLVED", classification: "RECEIVE", confidence: 0.9, user_override: null }),
    ]);
    expect(store.summary().periodPnl).toBe("2.2000");
  });

  it("compares offsets by instant, not lexicographically", () => {
    const store = new MockEventStore([
      eventAt({ id: "a", block_timestamp: "2025-01-01T00:30:00.000Z", direction: "OUT", fiat_value: "10.00", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null }),
    ]);
    // [00:00Z, 01:00Z)를 +09:00 오프셋으로 표현 — 사전식 비교라면 이벤트가 제외된다.
    const summary = store.summary({ from: "2025-01-01T09:00:00+09:00", to: "2025-01-01T10:00:00+09:00" });
    expect(summary.taxableEventCount).toBe(1);
    expect(summary.periodPnl).toBe("10.00");
  });
  it("treats empty from/to as absent like BE validation", async () => {
    const cookie = await completedSessionCookie();
    // BE validatePeriod는 falsy를 건너뛰므로 빈 값은 400이 아니라 전체 기간을 뜻한다.
    const response = await GET(new Request(
      "http://localhost/api/events/summary?from=&to=",
      { headers: { cookie } },
    ));
    expect(response.status).toBe(200);
  });

  it("rejects ranges inverted by instant even when lexicographically ordered", async () => {
    // "05:00Z" < "09:00+09:00" 사전식이지만 실제로는 05:00Z > 00:00Z.
    const cookie = await didSessionCookie();
    const response = await GET(
      new Request(
        "http://localhost/api/events/summary?from=2025-01-01T05:00:00Z&to=2025-01-01T09:00:00%2B09:00",
        { headers: { cookie } },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects malformed and inverted period queries with a 400 ErrorEnvelope", async () => {
    const cookie = await didSessionCookie();
    const malformed = await GET(new Request("http://localhost/api/events/summary?from=x", { headers: { cookie } }));
    expect(malformed.status).toBe(400);
    const inverted = await GET(
      new Request(
        "http://localhost/api/events/summary?from=2025-02-01T00:00:00.000Z&to=2025-01-01T00:00:00.000Z",
        { headers: { cookie } },
      ),
    );
    expect(inverted.status).toBe(400);
    const invertedBody = (await inverted.json()) as { error?: { code?: string } };
    expect(invertedBody.error?.code).toBe("invalid_request");

    // BE validatePeriod parity: Date.parse 가능한 offset 없는 RFC3339도 기간 검증을 통과한다.
    const offsetless = await GET(new Request(
      "http://localhost/api/events/summary?from=2025-01-01T00:00:00&to=2025-01-02T00:00:00",
      { headers: { cookie } },
    ));
    expect(offsetless.status).toBe(404);
  });
});

describe("summary currency invariant", () => {
  it("fails fast when an UNKNOWN-priced event carries a different currency", () => {
    const store = new MockEventStore([
      eventAt({ id: "a", block_timestamp: "2025-01-01T00:00:00.000Z", direction: "OUT", fiat_value: "10.00", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null, fiat_currency: "KRW" }),
      eventAt({ id: "b", block_timestamp: "2025-01-02T00:00:00.000Z", direction: "IN", fiat_value: null, price_status: "UNKNOWN", classification: "RECEIVE", confidence: 0.9, user_override: null, fiat_currency: "USD" }),
    ]);
    expect(() => store.summary()).toThrow(/single fiat currency/);
  });

  it("falls back to a documented currency for an empty filtered period", () => {
    const store = new MockEventStore([
      eventAt({ id: "a", block_timestamp: "2025-01-01T00:00:00.000Z", direction: "OUT", fiat_value: "10.00", price_status: "RESOLVED", classification: "SEND", confidence: 0.9, user_override: null }),
    ]);
    const empty = store.summary({ from: "2030-01-01T00:00:00.000Z", to: "2030-02-01T00:00:00.000Z" });
    expect(empty.taxableEventCount).toBe(0);
    expect(empty.currency).toBe("KRW");
  });
});
