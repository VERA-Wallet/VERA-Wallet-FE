import { authStore } from "@/lib/composition-root.server";
import { requireDidSession } from "@/lib/dal";
import { blankSession, sessionCookie } from "@/lib/mock/auth-store";
import { compareChallenge, parseSiweMessage, verifySiweSignature } from "@/lib/siwe";
import { error, sessionIdFrom, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";

export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  const id = sessionIdFrom(request)!;
  const body = await request.json().catch(() => null);
  const missing = [];
  if (!body || typeof body.message !== "string") missing.push("message must be a string");
  if (!body || typeof body.signature !== "string") missing.push("signature must be a string");
  if (missing.length > 0) return Response.json(error("invalid_request", missing.join(", ")), { status: 400 });
  const parsed = parseSiweMessage(body.message);
  if (!parsed) return Response.json(error("invalid_request", "Invalid SIWE message."), { status: 400 });
  const record = await authStore.peek(parsed.nonce);
  if (!record) return Response.json(error("challenge_not_found", "Challenge not found."), { status: 400 });
  // 다른 세션의 challenge는 없는 것과 같아야 BE의 cross-user 소비 거부와 일치한다.
  if (record.sessionId !== id) return Response.json(error("challenge_not_found", "Challenge not found."), { status: 400 });
  // 위 소유자 검사는 빠른 거부를 위한 경로이고, 최종 enforcement는 원자적 consume 경계가 담당한다.
  const consumed = await authStore.consume(record.jti, id);
  if (consumed === "expired") return Response.json(error("challenge_expired", "Challenge expired."), { status: 410 });
  // BE ConflictException parity: 이미 소비된 challenge는 409다.
  if (consumed === "already-consumed") return Response.json(error("already-consumed", "Challenge already consumed."), { status: 409 });
  if (consumed === "not-found") return Response.json(error("challenge_not_found", "Challenge not found."), { status: 400 });
  // BE는 consume 후 compare라 mismatch도 챌린지를 소모한다 — 재사용 공격 표면을 줄이는 의도적 순서
  const field = compareChallenge(parsed, record);
  // BE BadRequestException parity: challenge mismatch는 400이며, details.field는 진단용으로 유지한다.
  if (field) return Response.json(error("challenge_mismatch", "Challenge does not match signed message.", { field }), { status: 400 });
  if (!await verifySiweSignature(body.message, body.signature, parsed.address)) return Response.json(error("invalid_signature", "Signature verification failed."), { status: 401 });
  const previous = await authStore.get(id) ?? blankSession();
  const walletExpiresAt = Date.now() + 60 * 60_000;
  await authStore.set(id, { ...previous, walletAddress: parsed.address, chainId: parsed.chainId, walletExpiresAt });
  return new Response(JSON.stringify(success({ walletAddress: parsed.address, chainId: parsed.chainId })), { status: 201, headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) } });
}
