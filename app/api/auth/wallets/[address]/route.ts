import { authStore } from "@/lib/composition-root.server";
import { requireDidSession } from "@/lib/dal";
import { blankSession, sessionCookie } from "@/lib/mock/auth-store";
import { parseWalletAddress } from "@/lib/wallet/address";
import { error, sessionIdFrom, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";

/**
 * 지갑 등록 해제 — OFF(mock) 모드 전용. ON 모드에서는 proxy가 BE `DELETE /api/auth/wallets/:address`로 넘긴다.
 *
 * mock 세션은 지갑을 하나만 기억하므로, 그 주소가 맞으면 세션의 지갑 클레임을 비운다(DID 세션은 그대로).
 * 다른 주소는 "등록되지 않은 지갑"이다 — 세션이 모르는 주소를 지웠다고 답하면 화면이 없는 일을 있었다고 말한다.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const { address } = await params;
  const parsed = parseWalletAddress(address);
  if (!parsed.ok) return Response.json(error("invalid_request", "address must be a 0x-prefixed 20-byte hex string"), { status: 400 });
  if (!session.walletAddress || session.walletAddress.toLowerCase() !== parsed.address.toLowerCase()) {
    return Response.json(error("wallet_not_found", "Wallet is not registered to this account."), { status: 404 });
  }

  const id = sessionIdFrom(request)!;
  const previous = await authStore.get(id) ?? blankSession();
  await authStore.set(id, { ...previous, walletAddress: null, walletVerification: null, walletExpiresAt: null });
  // OFF 모드의 원장은 데모 픽스처라 지갑별로 세지 않는다 — 지운 행 수는 0으로 정직하게 둔다.
  return new Response(JSON.stringify(success({ walletAddress: parsed.address, removedTransactions: 0 })), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) },
  });
}
