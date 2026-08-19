import "server-only";

import { randomUUID } from "node:crypto";

import { siweEnv } from "@/lib/env";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";
import type { ErrorEnvelope, SuccessEnvelope } from "@/lib/http/envelope";

export function success<T>(data: T): SuccessEnvelope<T> { return { data, meta: { provenance: "mock", generatedAt: new Date().toISOString() } }; }
export function error(code: string, message: string, details?: unknown): ErrorEnvelope { return { error: { code, message, ...(details === undefined ? {} : { details }) } }; }
// BE JwtAuthGuard 401 계약(passport 기본 메시지).
export function unauthorizedResponse(): Response {
  return Response.json(error("unauthorized", "Unauthorized"), { status: 401 });
}
// BE listOrSync 지갑 미바인딩 404 계약.
export function walletNotBoundResponse(): Response {
  return Response.json(error("not_found", "A bound wallet is required before sync."), { status: 404 });
}
// Route Handler에는 error boundary가 없어 그대로 던지면 500 HTML이 되므로 JSON 오류로 변환한다.
export async function withSessionInfrastructureError<T>(read: () => Promise<T>): Promise<T | Response> {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof SessionInfrastructureError) {
      return Response.json(error("upstream_unavailable", "인증 서버에서 정상적인 세션 응답을 받지 못했습니다."), { status: 502 });
    }
    throw cause;
  }
}
export function sessionIdFrom(request: Request) { return request.headers.get("cookie")?.match(/(?:^|;\s*)vw_session=([^;]+)/)?.[1] ?? null; }
export function trustedOrigin(request: Request): { domain: string; uri: string } {
  // scheme+authority는 서버가 본 요청 URL에서 파생한다(dev http, 배포 https) — Host 헤더 단독 신뢰·https 하드코딩 금지.
  const url = new URL(request.url);
  const configured = siweEnv.trustedOrigin;
  if (configured && configured.host !== url.host) throw new Error(`Request host ${url.host} does not match SIWE_TRUSTED_ORIGIN.`);
  const origin = configured ? configured.origin : url.origin;
  return { domain: new URL(origin).host, uri: `${origin}${siweEnv.allowedUriPaths[0]}` };
}
export const challengeId = () => randomUUID().replace(/-/g, "");
