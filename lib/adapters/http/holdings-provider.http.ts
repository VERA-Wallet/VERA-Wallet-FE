import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { holdingsSchema } from "@/lib/http/dto";
import type { HoldingsDTO } from "@/lib/http/dto";
import type { HoldingsProvider } from "@/lib/ports/holdings-provider";

export class HttpHoldingsProvider implements HoldingsProvider {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async getHoldings(input: { wallet?: string } = {}): Promise<HoldingsDTO> {
    const query = input.wallet ? `?wallet=${encodeURIComponent(input.wallet)}` : "";
    const response = await decodeResponse(await this.fetcher(`/api/wallet/holdings${query}`), holdingsSchema);
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }
}
