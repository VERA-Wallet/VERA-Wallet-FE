import type { Decimal } from "@/lib/tax/decimal";

/**
 * 날짜(YYYY-MM-DD, UTC) → `from` 1단위당 `to` 금액.
 * 소스에 그 날의 환율이 없으면 키가 없다 — 0이나 직전 값을 지어내지 않는다(그건 어댑터가 명시적으로 한다).
 */
export type FxRateTable = ReadonlyMap<string, Decimal>;

/**
 * 과거 환율 소스.
 *
 * 세금 룰셋은 자기 통화(USD·EUR·JPY…)로 계산하는데 지갑 이벤트의 `fiat_value`는 인덱서 통화(BE는 KRW)다.
 * 숫자를 그대로 쓰면 원화 금액에 달러 라벨이 붙는다. 환산은 **거래일 환율**로 해야 취득가액·양도가액이
 * 각자의 시점에 맞는다.
 */
export interface FxRateProvider {
  ratesFor(input: { from: string; to: string; dates: readonly string[] }): Promise<FxRateTable>;
}

export type FxRateFailure = "network" | "timeout" | "http_status" | "invalid_response";

/** 환율 소스 자체가 응답하지 못했다. 빈 표로 뭉개면 모든 이벤트가 조용히 제외돼 "계산할 거래 없음"이 된다. */
export class FxRateUnavailableError extends Error {
  constructor(public readonly reason: FxRateFailure, message: string, public readonly status?: number) {
    super(message);
    this.name = "FxRateUnavailableError";
  }
}
