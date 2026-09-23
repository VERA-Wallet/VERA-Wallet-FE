import { z } from "zod";
import { decodeResponse } from "@/lib/http/error-codec";
import { AuthClientError } from "@/lib/ports/auth-client";

export type DidCountry = "KR" | "US" | "UK" | "DE";
const offerSchema = z.object({
  offerId: z.string().min(1),
  qrPayload: z.object({ type: z.literal("VerifyOffer"), offerId: z.string().min(1), endpoints: z.array(z.string().url()).min(1), validUntil: z.string().datetime({ offset: true }) }).passthrough(),
  expiresAt: z.string().datetime({ offset: true }),
  pollAfterMs: z.number().int().min(1000).max(60000),
}).refine(v => v.offerId === v.qrPayload.offerId, "Offer mismatch");
export type DidOffer = z.infer<typeof offerSchema>;
const pendingSchema = z.object({ status: z.literal("pending"), retryAfterMs: z.number().int().min(1000).max(60000) });
const verifiedSchema = z.object({ countryCode: z.enum(["KR", "US", "UK", "DE"]), ruleset: z.object({ country: z.string(), cost_basis: z.string(), badge_label: z.string() }) });

export class OpenDidError extends AuthClientError {
  constructor(status: number, code: string, message: string, public readonly retryAfterMs = 2000) { super(status, code, message); }
}
async function decode<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const result = await decodeResponse(response, schema);
  if ("error" in result) {
    const seconds = Number(response.headers.get("retry-after"));
    throw new OpenDidError(response.status, result.error.code, result.error.message,
      Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60000) : 2000);
  }
  if (result.meta.provenance !== "live") throw new OpenDidError(502, "invalid_response", "실제 인증 응답을 확인하지 못했습니다.");
  return result.data;
}
function post(path: string, body: unknown, signal?: AbortSignal) {
  return fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
export const openDidClient = {
  async offer(country: DidCountry) {
    // Do not abort issuance: wait for its cookie before allowing another offer in this tab.
    return decode(await post("/api/auth/did/offer", { country }, AbortSignal.timeout(35000)), offerSchema);
  },
  async present(country: DidCountry, offerId: string, signal: AbortSignal) {
    const response = await post("/api/auth/did/present", { country, offerId }, signal);
    if (response.status === 202) return decode(response, pendingSchema);
    const data = await decode(response, verifiedSchema);
    if (data.countryCode !== country) throw new OpenDidError(502, "invalid_response", "인증 응답의 거주 국가가 일치하지 않습니다.");
    return { status: "verified" as const, claim: data };
  },
};
