import { authStore } from "@/lib/composition-root.server";
import { blankSession } from "@/lib/mock/auth-store";
import { sessionIdFrom, success } from "@/lib/auth-route";

export async function GET(request: Request) {
  const session = await authStore.get(sessionIdFrom(request) ?? "") ?? blankSession();
  // BE와 동일하게 chainId는 내리지 않는다 — 활동 체인은 이벤트 데이터에서 파생한다.
  return Response.json(success({ didVerified: session.didVerified, countryCode: session.countryCode, walletAddress: session.walletAddress }));
}
