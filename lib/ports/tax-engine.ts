import type { TaxEstimate, RuleSetSummary, TaxpayerProfile } from "@/lib/tax/types";

/** 계산 대상 이벤트 출처. scenario = 룰셋 비교용 데모 시나리오, wallet = 연결된 지갑의 정규화 이벤트. */
export type TaxEventSource = "scenario" | "wallet";

export type TaxEstimateRequest = {
  country: string;
  taxYear: number;
  source: TaxEventSource;
  profile?: Partial<TaxpayerProfile>;
  includeMarginal?: boolean;
};

export interface TaxEnginePort {
  listRuleSets(): Promise<RuleSetSummary[]>;
  estimate(input: TaxEstimateRequest): Promise<TaxEstimate>;
}
