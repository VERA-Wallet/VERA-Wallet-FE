import { authStore } from "@/lib/composition-root.server";
import { challengeId, error, success, trustedOrigin } from "@/lib/auth-route";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.chainId !== "number" || !Number.isInteger(body.chainId)) return Response.json(error("invalid_request", "chainId is required."), { status: 400 });
  const { domain, uri } = trustedOrigin(request);
  const issuedAt = new Date().toISOString();
  const record = { jti: challengeId(), domain, uri, chainId: body.chainId, issuedAt, expiresAtMs: Date.now() + 5 * 60_000, consumedAt: null };
  await authStore.issue(record);
  return Response.json(success({ nonce: record.jti, domain, uri, chainId: record.chainId, issuedAt, expiresAtMs: record.expiresAtMs }));
}
