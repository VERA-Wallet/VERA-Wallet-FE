import "client-only";

import { z } from "zod";
import { decodeResponse } from "@/lib/http/error-codec";
import { AuthClientError, type AuthClient, type AuthNonce, type AuthSession, type DidPresentation } from "@/lib/ports/auth-client";

const nonceSchema: z.ZodType<AuthNonce> = z.object({ nonce: z.string(), domain: z.string(), uri: z.string(), chainId: z.number().int(), issuedAt: z.string().datetime({ offset: true }), expiresAtMs: z.number() });
const sessionSchema: z.ZodType<AuthSession> = z.object({ didVerified: z.boolean(), countryCode: z.string().nullable(), walletAddress: z.string().nullable(), chainId: z.number().int().nullable() });
const didSchema: z.ZodType<DidPresentation> = z.object({ countryCode: z.enum(["KR", "US", "UK", "DE"]), ruleset: z.object({ country: z.string(), cost_basis: z.string(), badge_label: z.string() }) });
const verifiedSchema = z.object({ walletAddress: z.string(), chainId: z.number().int() });

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const decoded = await decodeResponse(response, schema);
  if ("error" in decoded) throw new AuthClientError(response.status, decoded.error.code, decoded.error.message);
  return decoded.data;
}
export class HttpAuthClient implements AuthClient {
  requestNonce(input: { chainId: number }) { return request("/api/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, nonceSchema); }
  verify(input: { message: string; signature: string }) { return request("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, verifiedSchema); }
  presentDid(input: { country: "KR" | "US" | "UK" | "DE"; cxToken?: string }) { return request("/api/auth/did/present", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, didSchema); }
  async logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new AuthClientError(response.status, "logout_failed", "Failed to end the session.");
  }
  getSession() { return request("/api/auth/session", { credentials: "same-origin" }, sessionSchema); }
}
