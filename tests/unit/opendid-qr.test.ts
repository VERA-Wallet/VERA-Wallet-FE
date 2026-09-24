import { expect, it } from "vitest";
import { serializeOpenDidQr } from "@/lib/opendid/qr";
it("uses the official SUBMIT_VP envelope and UTF-8 multibase base64 payload", () => {
  const payload = { type: "VerifyOffer" as const, offerId: "offer", endpoints: ["https://verifier.test/verifier"], validUntil: "2026-09-24T00:00:00Z", service: "본인 확인" };
  const qr = JSON.parse(serializeOpenDidQr({ offerId: "offer", qrPayload: payload, expiresAt: payload.validUntil, pollAfterMs: 2000 }));
  expect(qr.payloadType).toBe("SUBMIT_VP");
  expect(qr.validUntil).toBe(payload.validUntil);
  expect(qr.payload[0]).toBe("m");
  expect(qr.payload).not.toMatch(/=$/);
  const bytes = Uint8Array.from(atob(qr.payload.slice(1)), c => c.charCodeAt(0));
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(payload);
});
