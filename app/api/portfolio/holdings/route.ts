import { error, success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { holdingsProviderFor } from "@/lib/composition-root.server";
import { HoldingsReadError } from "@/lib/ports/holdings-provider";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

/**
 * 보유 자산 조회. 양 모드에서 FE가 소유한다(프록시하지 않는다).
 *
 * ON 모드에서 BE 응답을 그대로 넘기지 않는 이유: BE는 취득원가를 원장 통화(KRW)로만 주고 환율을 모른다.
 * 화면은 시세와 같은 USD로 손익을 보여야 하므로 서버에서 환산해 계약을 하나로 만든다(`/api/tax/*`와 같은 배치).
 */
const FORWARDED_BE_STATUSES: ReadonlySet<number> = new Set([401, 404, 429, 503]);

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) return walletNotBoundResponse();

  try {
    const provider = await holdingsProviderFor(request, session.walletAddress);
    const { data, provenance } = await provider.getHoldings();
    return Response.json(success(data, provenance));
  } catch (cause) {
    // BE가 상태 코드로 거절한 조회(401 세션·404 미바인딩·429 한도·503 전 체인 조회 실패)는 코드와 상태를 그대로 전한다.
    // 그 밖의 상태(게이트웨이의 3xx 등)는 뜻을 모르므로 502로 접는다 — Location 없는 302를 브라우저에 흘리지 않는다.
    if (cause instanceof HoldingsReadError) {
      const status = FORWARDED_BE_STATUSES.has(cause.status) ? cause.status : 502;
      return Response.json(error(cause.code, cause.message), { status });
    }
    // 타임아웃·네트워크·계약 위반은 세션 경계와 같은 502 계약으로 맞춘다 — 500 HTML로 흘리면 화면이 원인을 모른다.
    if (cause instanceof SessionInfrastructureError) return Response.json(error("upstream_unavailable", "잔액 서버에서 정상적인 응답을 받지 못했습니다."), { status: 502 });
    throw cause;
  }
}
