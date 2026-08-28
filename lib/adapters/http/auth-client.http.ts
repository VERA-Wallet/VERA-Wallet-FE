import "client-only";

import { z } from "zod";
import { decodeResponse } from "@/lib/http/error-codec";
import { AuthClientError, type AuthClient, type AuthNonce, type AuthSession, type DidPresentation } from "@/lib/ports/auth-client";

const nonceSchema: z.ZodType<AuthNonce> = z.object({ nonce: z.string(), domain: z.string(), uri: z.string(), chainId: z.number().int(), issuedAt: z.string().datetime({ offset: true }), expiresAtMs: z.number() });
const sessionSchema: z.ZodType<AuthSession> = z.object({ didVerified: z.boolean(), countryCode: z.string().nullable(), walletAddress: z.string().nullable() });
const didSchema: z.ZodType<DidPresentation> = z.object({ countryCode: z.enum(["KR", "US", "UK", "DE"]), ruleset: z.object({ country: z.string(), cost_basis: z.string(), badge_label: z.string() }) });
const verifiedSchema = z.object({ walletAddress: z.string(), chainId: z.number().int() });
// 워치온리 응답에는 chainId가 없다 — 서명된 체인이 없으므로 BE가 값을 만들어 내려주지 않는다.
const watchRegisteredSchema = z.object({ walletAddress: z.string() });

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const decoded = await decodeResponse(response, schema);
  if ("error" in decoded) throw new AuthClientError(response.status, decoded.error.code, decoded.error.message);
  return decoded.data;
}
export class HttpAuthClient implements AuthClient {
  requestNonce(input: { chainId: number }) { return request("/api/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, nonceSchema); }
  verify(input: { message: string; signature: string }) { return request("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, verifiedSchema); }
  // 응답 형태는 verify와 같다 — 화면 입장에서 "어떤 지갑이 붙었나"는 등록 방법과 무관하기 때문이다.
  registerWatchWallet(input: { address: string }) { return request("/api/auth/wallet/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, watchRegisteredSchema); }
  presentDid(input: { country: "KR" | "US" | "UK" | "DE"; cxToken?: string }) { return request("/api/auth/did/present", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, didSchema); }
  async logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new AuthClientError(response.status, "logout_failed", "Failed to end the session.");
  }
  getSession() { return request("/api/auth/session", { credentials: "same-origin" }, sessionSchema); }
}
