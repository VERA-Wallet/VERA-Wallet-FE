import "server-only";

import { beFetch } from "@/lib/adapters/session/request-cookie.server";
import { decodeResponse } from "@/lib/http/error-codec";
import type { PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";
import { FxRateUnavailableError, type FxRateProvider, type FxRateTable } from "@/lib/ports/fx-rate";
import { HoldingsReadError, type HoldingsProvider } from "@/lib/ports/holdings-provider";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";
import { beHoldingsSchema, parseBeHoldingRows, type BeHoldingsDTO } from "@/lib/schema/be-portfolio-transport";
import { utcDay } from "@/lib/tax/fx-convert";
import { costCurrenciesNeedingFx, toPortfolioHoldings } from "@/lib/wallet/holdings-cost";

/**
 * BE 잔액 API를 서버에서 읽고 취득원가를 USD로 맞추는 어댑터.
 *
 * `/api/portfolio/holdings`를 프록시로 BE에 바로 넘기지 않고 FE Route Handler가 소유하는 이유가 이것이다:
 * BE는 환율을 갖지 않아 원가를 원장 통화(KRW)로만 주는데, 화면은 시세와 같은 USD로 손익을 보여야 한다.
 * 세금 화면이 쓰는 환율 소스(`FxRateProvider`)를 여기서도 쓴다. 단 **날짜 기준은 다르다**: 세금은 이벤트마다 거래일 환율,
 * 여기는 원가 합계를 오늘 환율로 한 번에 환산한다(BE가 취득일별 lot을 주지 않는다). 그래서 두 화면의 원가는 환율 변동만큼
 * 어긋날 수 있고, 화면은 "오늘 환율로 환산"이라고 말한다.
 *
 * 환율 소스 장애는 조회 전체를 실패시키지 않는다 — 잔액·시세는 이미 손에 있으므로 원가만 `fx_unavailable`로
 * 비우고 나머지를 돌려준다. 반대로 BE 조회 실패는 그대로 전한다(빈 목록으로 뭉개면 "자산 없음"이라는 거짓말).
 */
const NEST_ROUTE_MISSING = /^Cannot (GET|POST|PUT|PATCH|DELETE) /;

export class BeHttpHoldingsProvider implements HoldingsProvider {
  constructor(
    private readonly cookieHeader: string | undefined,
    private readonly fx: FxRateProvider,
    private readonly today: () => string = () => new Date().toISOString(),
  ) {}

  async getHoldings(address?: string): Promise<{ data: PortfolioHoldingsDTO; provenance: Provenance }> {
    const path = address === undefined ? "/api/portfolio/holdings" : `/api/portfolio/holdings?${new URLSearchParams({ address })}`;
    let response: Response;
    try {
      // BE는 체인 5개를 병렬로 읽고 자산마다 시세를 조회한다. 이벤트 목록(5초)보다 여유를 둔다.
      response = await beFetch(path, { cookieHeader: this.cookieHeader, timeoutMs: 15_000 });
    } catch (error) {
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SessionInfrastructureError(isTimeout ? "timeout" : "network", "BE 잔액 조회에 실패했다.");
    }

    const decoded = await decodeResponse(response, beHoldingsSchema);
    if (!("data" in decoded && "meta" in decoded)) {
      if (response.ok) throw new SessionInfrastructureError("invalid_contract", `BE 잔액 응답이 성공 상태인데 오류 envelope다: ${decoded.error.code}`, response.status);
      // BE 예외 필터는 라우트 없음(Nest "Cannot GET …")도 지갑 미등록과 같은 `not_found`로 감싼다. 코드만 보면 둘이 같아
      // "지갑을 등록하라"는 엉뚱한 안내가 나간다 — 엔드포인트가 없는 BE(예전 배포)는 따로 말한다.
      if (response.status === 404 && NEST_ROUTE_MISSING.test(decoded.error.message)) {
        throw new HoldingsReadError(502, "backend_endpoint_missing", "BE에 /api/portfolio/holdings 엔드포인트가 없다. BE 배포 버전을 확인하라.");
      }
      throw new HoldingsReadError(response.status, decoded.error.code, decoded.error.message);
    }

    // 행은 개별 검증한다 — 초소액 토큰 한 줄의 형식 오류가 지갑 전체를 502로 만들면 안 된다. 버린 수는 응답에 실린다.
    const { holdings, dropped } = parseBeHoldingRows(decoded.data.holdings);
    const be: BeHoldingsDTO = { ...decoded.data, holdings };
    const rates = await this.ratesFor(be);
    return { data: toPortfolioHoldings(be, rates, dropped), provenance: decoded.meta.provenance };
  }

  /** 원가 통화 → USD 환율(조회 시점의 날). 소스가 응답하지 않으면 null — 호출자가 fx_unavailable로 표시한다. */
  private async ratesFor(be: BeHoldingsDTO): Promise<{ table: FxRateTable; day: string } | null> {
    const currencies = costCurrenciesNeedingFx(be);
    if (currencies.length === 0) return null;
    // 원장 통화는 하나(KRW)다. 둘 이상이면 계약이 바뀐 것이고, 첫 통화만 환산하면 나머지가 조용히 틀리므로 거부한다.
    if (currencies.length > 1) throw new SessionInfrastructureError("invalid_contract", `BE 원가 통화가 둘 이상이다: ${currencies.join(", ")}`);
    const day = utcDay(this.today());
    try {
      return { table: await this.fx.ratesFor({ from: currencies[0], to: "USD", dates: [day] }), day };
    } catch (error) {
      if (error instanceof FxRateUnavailableError) return null;
      throw error;
    }
  }
}
