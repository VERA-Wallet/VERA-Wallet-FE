import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { portfolioHoldingsSchema, type PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";
import type { HoldingsProvider } from "@/lib/ports/holdings-provider";

/** 브라우저에서 FE Route Handler `/api/portfolio/holdings`를 읽는다. 출처(provenance)는 envelope meta에서 잇는다. */
export class HttpHoldingsProvider implements HoldingsProvider {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async getHoldings(): Promise<{ data: PortfolioHoldingsDTO; provenance: Provenance }> {
    const response = await decodeResponse(await this.fetcher("/api/portfolio/holdings"), portfolioHoldingsSchema);
    if ("data" in response && "meta" in response) return { data: response.data, provenance: response.meta.provenance };
    throw new HoldingsFetchError(response.error.code, response.error.message);
  }
}

/** 코드를 보존해 화면이 "지갑 없음"과 "조회 실패"를 다르게 말하게 한다. */
export class HoldingsFetchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HoldingsFetchError";
  }
}
