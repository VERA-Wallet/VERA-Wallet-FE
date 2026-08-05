import "server-only";

import { randomUUID } from "node:crypto";

import { siweEnv } from "@/lib/env";
import type { ErrorEnvelope, SuccessEnvelope } from "@/lib/http/envelope";

export function success<T>(data: T): SuccessEnvelope<T> { return { data, meta: { provenance: "mock", generatedAt: new Date().toISOString() } }; }
export function error(code: string, message: string, details?: unknown): ErrorEnvelope { return { error: { code, message, ...(details === undefined ? {} : { details }) } }; }
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
