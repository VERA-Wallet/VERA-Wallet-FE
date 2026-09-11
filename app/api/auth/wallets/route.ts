import { success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import type { RegisteredWalletsDTO } from "@/lib/http/dto";

/**
 * 등록한 지갑 목록 — OFF(mock) 모드 전용. ON 모드에서는 proxy가 BE `GET /api/auth/wallets`로 넘긴다.
 * mock 세션은 지갑을 하나만 기억하므로 목록도 최대 하나다. 등록 시각은 mock 세션이 기록하지 않아 지금으로 둔다.
 */
export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  const data: RegisteredWalletsDTO = {
    wallets: session.walletAddress
      ? [{ walletAddress: session.walletAddress, verificationMethod: session.walletVerification ?? "siwe", boundAt: new Date().toISOString() }]
      : [],
  };
  return Response.json(success(data));
}
