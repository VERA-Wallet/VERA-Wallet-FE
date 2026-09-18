import type { HoldingsDTO } from "@/lib/http/dto";

/**
 * 지갑 홈의 현재 보유 자산. 세금 화면과 다른 질문에 답한다 —
 * 저쪽은 "거래 시점에 얼마였나"(이력)고 이쪽은 "지금 얼마나 들고 있나"(상태)다.
 */
export interface HoldingsProvider {
  getHoldings(input?: { wallet?: string }): Promise<HoldingsDTO>;
}
