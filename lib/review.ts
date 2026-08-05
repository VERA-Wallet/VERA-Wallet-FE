import { div, isPositive } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * "확인 필요"와 "세금 계산 제외"의 단일 판정 소스.
 *
 * 이 술어가 두 벌로 존재하면 화면이 서로 다른 말을 한다. 실제로 그랬다:
 * 세금 화면은 "계산에서 빠진 이벤트 1건"이라 하는데 대시보드 확인 필요 탭은 비어 있었고,
 * 반대로 대시보드가 "확정해야 계산에 포함됩니다"라고 한 신뢰도 낮은 거래는 이미 계산에 들어가 있었다.
 *
 * 불변식: **계산 제외 ⊆ 확인 필요.** 세금 화면에서 제외 배너를 누른 사용자는
 * 대시보드 확인 필요 탭에서 반드시 그 거래를 찾을 수 있어야 한다.
 */

/** 분류 신뢰도가 이 값 미만이면 사람이 확인해야 한다. */
const CONFIDENCE_FLOOR = 0.5;

/** 사용자 재분류가 있으면 그것이 유효 분류다. */
export function effectiveClassification(event: NormalizedEvent) {
  return event.user_override?.classification ?? event.classification;
}

export function eventQuantity(event: NormalizedEvent): Decimal {
  return div(event.raw_amount, `1${"0".repeat(Math.max(0, event.decimals))}`);
}

export type TaxExclusionReason = "분류 확인 필요" | "가격 확인 필요" | "수량 확인 필요";

/**
 * 세금 계산에 넣을 수 없는 사유. 넣을 수 있으면 null.
 * `deriveTaxEvents`가 이 판정을 그대로 쓴다.
 */
export function taxExclusionReason(event: NormalizedEvent): TaxExclusionReason | null {
  if (effectiveClassification(event) === "UNKNOWN") return "분류 확인 필요";
  if (event.price_status === "UNKNOWN" || event.fiat_value === null) return "가격 확인 필요";
  if (!isPositive(eventQuantity(event))) return "수량 확인 필요";
  return null;
}

/** 신뢰도가 낮아 확인이 필요하지만 계산에는 들어간다. */
export function isLowConfidence(event: NormalizedEvent): boolean {
  return event.confidence < CONFIDENCE_FLOOR;
}

/** 확인 필요 = 계산 제외 사유가 있거나, 신뢰도가 낮거나. */
export function needsReview(event: NormalizedEvent): boolean {
  return taxExclusionReason(event) !== null || isLowConfidence(event);
}

/** 확인 필요 배지에 찍을 사유. */
export function reviewReason(event: NormalizedEvent): string {
  return taxExclusionReason(event) ?? "신뢰도 낮음";
}
