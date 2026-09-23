import { afterEach, expect, it, vi } from "vitest";
import { openDidClient } from "@/lib/opendid/client";
const envelope = (data: unknown, status = 200, provenance = "live") => new Response(JSON.stringify({ data, meta: { provenance, generatedAt: new Date().toISOString() } }), { status });
afterEach(() => vi.unstubAllGlobals());
it("keeps 202 pending distinct from a verified session", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ status: "pending", retryAfterMs: 2000 }, 202)));
  expect(await openDidClient.present("KR", "offer", new AbortController().signal)).toEqual({ status: "pending", retryAfterMs: 2000 });
});
it("rejects a success-shaped 202 rather than logging in", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "FIFO", badge_label: "KR" } }, 202)));
  await expect(openDidClient.present("KR", "offer", new AbortController().signal)).rejects.toMatchObject({ code: "invalid_response" });
});
it("preserves retry-after and the consumed error code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "verification_consumed", message: "consumed" } }), { status: 409, headers: { "retry-after": "5" } })));
  await expect(openDidClient.present("KR", "offer", new AbortController().signal)).rejects.toMatchObject({ status: 409, code: "verification_consumed", retryAfterMs: 5000 });
});
it("rejects mismatched offer IDs and mock identity responses", async () => {
  const offer = { offerId: "one", qrPayload: { type: "VerifyOffer", offerId: "two", endpoints: ["https://verifier.test/verifier"], validUntil: new Date(Date.now() + 10000).toISOString() }, expiresAt: new Date(Date.now() + 300000).toISOString(), pollAfterMs: 2000 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(offer, 201)));
  await expect(openDidClient.offer("KR")).rejects.toMatchObject({ code: "invalid_response" });
  offer.qrPayload.offerId = "one";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(offer, 201, "mock")));
  await expect(openDidClient.offer("KR")).rejects.toMatchObject({ code: "invalid_response" });
});
