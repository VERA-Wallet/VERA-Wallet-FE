import { authStore } from "@/lib/composition-root.server";
import { newSessionId, sessionCookie } from "@/lib/mock/auth-store";
import { isMockApiMode } from "@/lib/api-mode";

// FE 전용 dev 헬퍼 — BE 계약 표면이 아니다. 운영에서 완료 세션을 발급하지 않는다.
export async function POST() {
  // 실효 모드가 mock이 아니면 막는다(VERAWALLET_MOCK_MODE=true면 URL이 있어도 열림).
  // ON 세션 리더는 BE의 vw_access_token만 보므로, 열려 있으면 조용히 무의미한 가짜 세션을 만드는 함정이 된다.
  if (process.env.NODE_ENV === "production" || !isMockApiMode()) return new Response(null, { status: 404 });
  const id = newSessionId();
  const expiresAt = Date.now() + 60 * 60_000;
  await authStore.set(id, { didVerified: true, countryCode: "KR", walletAddress: "0x0000000000000000000000000000000000000001", chainId: 1, didExpiresAt: expiresAt, walletExpiresAt: expiresAt });
  return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie(id) } });
}
