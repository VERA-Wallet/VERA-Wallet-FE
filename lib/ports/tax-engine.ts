import type { Decimal } from "@/lib/tax/decimal";
import type { TaxEstimate, RuleSetSummary, TaxpayerProfile } from "@/lib/tax/types";

/** 계산 대상 이벤트 출처. scenario = 룰셋 비교용 데모 시나리오, wallet = 연결된 지갑의 정규화 이벤트. */
export type TaxEventSource = "scenario" | "wallet";

export type TaxEstimateRequest = {
  country: string;
  taxYear: number;
  source: TaxEventSource;
  profile?: Partial<TaxpayerProfile>;
  includeMarginal?: boolean;
  /**
   * 시행일이 아직 오지 않은 룰셋(한국 2027-01-01)을 "시행됐다고 가정하고" 계산한다.
   * 켠 화면이 그 사실을 계속 말해야 한다 — 결과의 notes도 함께 그렇게 말한다.
   */
  assumeEffective?: boolean;
  /**
   * 자산별 2026-12-31 간주취득가액(시가). 자산 키(`${chainId}:${contract|native}`)를 원화 시가에 매핑한다.
   * KR 거주자별 총평균 seed가 소비해 경계 전 보유분의 취득가액을 Max(시가, 실제)로 올린다 —
   * 의제취득가액이 반영돼 처분 손익·zeroBasis 한계가 줄어든다.
   */
  deemedFmv?: Record<string, Decimal>;
};

export interface TaxEnginePort {
  listRuleSets(): Promise<RuleSetSummary[]>;
  estimate(input: TaxEstimateRequest): Promise<TaxEstimate>;
}
