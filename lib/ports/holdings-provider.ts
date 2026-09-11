import type { PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";

/**
 * 지갑 홈이 그리는 보유 자산의 소스.
 *
 * 서버 구현은 모드에 따라 FE mock 저장소(데모 지갑) 또는 BE 잔액 API를 읽고, 취득원가를 USD로 맞춘 뒤 돌려준다.
 * 출처(provenance)를 함께 돌려주는 이유: 화면이 "데모 예시"와 "실시간 조회"를 다르게 말해야 하기 때문이다 —
 * 이벤트 목록처럼 BE의 meta.provenance를 그대로 잇는다(BE가 MOCK_MODE면 mock).
 */
export interface HoldingsProvider {
  /** `address`를 주면 그 지갑 하나(지갑 상세), 없으면 등록한 지갑 전부 합산(지갑 목록의 총액·지갑별 요약). */
  getHoldings(address?: string): Promise<{ data: PortfolioHoldingsDTO; provenance: Provenance }>;
}

/** BE 잔액 조회가 상태 코드로 거절됐다(401·404·503…). status와 code를 보존해 라우트가 그대로 전한다. */
export class HoldingsReadError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "HoldingsReadError";
  }
}
