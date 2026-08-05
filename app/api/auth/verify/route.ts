import { authStore } from "@/lib/composition-root.server";
import { blankSession, newSessionId, sessionCookie } from "@/lib/mock/auth-store";
import { compareChallenge, parseSiweMessage, verifySiweSignature } from "@/lib/siwe";
import { error, sessionIdFrom, success } from "@/lib/auth-route";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.message !== "string" || typeof body.signature !== "string") return Response.json(error("invalid_request", "message and signature are required."), { status: 400 });
  const parsed = parseSiweMessage(body.message);
  if (!parsed) return Response.json(error("invalid_request", "Invalid SIWE message."), { status: 400 });
  const record = await authStore.peek(parsed.nonce);
  if (!record) return Response.json(error("challenge_not_found", "Challenge not found."), { status: 400 });
  if (record.expiresAtMs <= Date.now()) return Response.json(error("challenge_expired", "Challenge expired."), { status: 410 });
  const field = compareChallenge(parsed, record);
  if (field) return Response.json(error("challenge_mismatch", "Challenge does not match signed message.", { field }), { status: 422 });
  const consumed = await authStore.consume(record.jti);
  if (consumed === "expired") return Response.json(error("challenge_expired", "Challenge expired."), { status: 410 });
  if (consumed === "already-consumed") return Response.json(error("already-consumed", "Challenge already consumed."), { status: 422 });
  if (consumed === "not-found") return Response.json(error("challenge_not_found", "Challenge not found."), { status: 400 });
  if (!await verifySiweSignature(body.message, body.signature, parsed.address)) return Response.json(error("invalid_signature", "Signature verification failed."), { status: 401 });
  const id = sessionIdFrom(request) ?? newSessionId();
  const previous = await authStore.get(id) ?? blankSession();
  const walletExpiresAt = Date.now() + 30 * 60_000;
  await authStore.set(id, { ...previous, walletAddress: parsed.address, chainId: parsed.chainId, walletExpiresAt });
  return new Response(JSON.stringify(success({ walletAddress: parsed.address, chainId: parsed.chainId })), { status: 200, headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) } });
}
