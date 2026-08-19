import { authStore } from "@/lib/composition-root.server";
import { requireDidSession } from "@/lib/dal";
import { challengeId, error, sessionIdFrom, success, trustedOrigin, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";

export async function POST(request: Request) {
  // 순서 강제(DID→지갑)가 BE처럼 nonce 발급 시점에 일어난다.
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => null);
  const chainIdMessage = typeof body?.chainId !== "number"
    ? "chainId must not be less than 1, chainId must be an integer number"
    : body.chainId < 1
      ? "chainId must not be less than 1"
      : !Number.isInteger(body.chainId)
        ? "chainId must be an integer number"
        : null;
  if (chainIdMessage) return Response.json(error("invalid_request", chainIdMessage), { status: 400 });
  const { domain, uri } = trustedOrigin(request);
  const issuedAt = new Date().toISOString();
  const record = { jti: challengeId(), sessionId: sessionIdFrom(request)!, domain, uri, chainId: body.chainId, issuedAt, expiresAtMs: Date.now() + 5 * 60_000, consumedAt: null };
  await authStore.issue(record);
  return Response.json(success({ nonce: record.jti, domain, uri, chainId: record.chainId, issuedAt, expiresAtMs: record.expiresAtMs }), { status: 201 });
}
