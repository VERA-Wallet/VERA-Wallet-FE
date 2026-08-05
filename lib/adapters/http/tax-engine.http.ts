import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { ruleSetListSchema, taxEstimateSchema } from "@/lib/http/tax-dto";
import type { TaxEnginePort, TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { RuleSetSummary, TaxEstimate } from "@/lib/tax/types";

export class HttpTaxEngine implements TaxEnginePort {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async listRuleSets(): Promise<RuleSetSummary[]> {
    const response = await decodeResponse(await this.fetcher("/api/tax/rulesets"), ruleSetListSchema);
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }

  async estimate(input: TaxEstimateRequest): Promise<TaxEstimate> {
    const response = await decodeResponse(
      await this.fetcher("/api/tax/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      taxEstimateSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }
}
