import { authStore } from "@/lib/composition-root.server";
import { newSessionId, sessionCookie } from "@/lib/mock/auth-store";

// Development-only e2e helper; never issue completed sessions in production.
export async function POST() {
  // ON 모드(VERAWALLET_BACKEND_ORIGIN 설정)에서도 막는다: 이 라우트는 vw_session만 발급하는데
  // ON 세션 리더는 BE의 vw_access_token만 보므로, 열려 있으면 조용히 무의미한 가짜 세션을 만드는 함정이 된다.
  if (process.env.NODE_ENV === "production" || process.env.VERAWALLET_BACKEND_ORIGIN) return new Response(null, { status: 404 });
  const id = newSessionId();
  const expiresAt = Date.now() + 30 * 60_000;
  await authStore.set(id, { didVerified: true, countryCode: "KR", walletAddress: "0x0000000000000000000000000000000000000001", chainId: 1, didExpiresAt: expiresAt, walletExpiresAt: expiresAt });
  return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie(id) } });
}
