import type { DidOffer } from "./client";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, sorted(entry)]));
  return value;
}

/** Official did-demo-server V2.0.0 DemoServiceImpl.vpOfferRefresh:
 * JSON envelope containing SUBMIT_VP + multibase(base64(sorted UTF-8 payload)).
 * A bare VerifyOffer JSON is not the wallet's QR format.
 */
export function serializeOpenDidQr(offer: DidOffer): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(offer.qrPayload)));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replace(/=+$/, "");
  return JSON.stringify({ payloadType: "SUBMIT_VP", payload: `m${encoded}`, validUntil: offer.qrPayload.validUntil });
}
