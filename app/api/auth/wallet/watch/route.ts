import { authStore } from "@/lib/composition-root.server";
import { requireDidSession } from "@/lib/dal";
import { blankSession, sessionCookie } from "@/lib/mock/auth-store";
import { parseWalletAddress } from "@/lib/wallet/address";
import { error, sessionIdFrom, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";

/**
 * 서명 없이 주소만으로 지갑을 등록한다(보기 전용).
 *
 * 거래 조회는 주소만 있으면 되므로 하드웨어·컨트랙트·모바일·과거 지갑이 전부 이 경로로 들어온다.
 * 대신 소유 증명이 없으니 `walletVerification: "watch_only"`로 남겨 화면이 검증된 것처럼 말하지 못하게 한다.
 *
 * nonce와 마찬가지로 DID 세션을 먼저 요구한다 — 지갑→DID 역순 우회를 이 경로로 열어주면 순서 강제가 무의미해진다.
 * 주소 검증은 클라이언트와 같은 `parseWalletAddress`를 쓴다. 클라이언트 검증만 믿으면 정규화되지 않은 주소가 저장된다.
 */
export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const body = await request.json().catch(() => null);
  if (!body || typeof body.address !== "string") return Response.json(error("invalid_request", "address must be a string"), { status: 400 });

  const parsed = parseWalletAddress(body.address);
  if (!parsed.ok) {
    const message = parsed.reason === "checksum"
      ? "Address checksum does not match."
      : "address must be a 0x-prefixed 20-byte hex string";
    return Response.json(error("invalid_request", message), { status: 400 });
  }

  const id = sessionIdFrom(request)!;
  const previous = await authStore.get(id) ?? blankSession();
  // 보기 전용 주소에는 서명된 체인이 없고, BE 응답도 chainId 없이 주소만 돌려준다.
  const walletExpiresAt = Date.now() + 60 * 60_000;
  await authStore.set(id, { ...previous, walletAddress: parsed.address, walletVerification: "watch_only", walletExpiresAt });

  return new Response(JSON.stringify(success({ walletAddress: parsed.address })), {
    status: 201,
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) },
  });
}
