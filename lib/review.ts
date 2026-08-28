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

/**
 * 더스트·에어드랍 스팸인가.
 *
 * 스팸은 **원장에 들어오기 전에** 걸러낸다(`lib/queries/events.ts`와 세금 입력). 아래
 * `taxExclusionReason`·`needsReview`에 스팸 갈래를 두지 않은 것은 의도적이다 — 이 파일의 불변식은
 * "계산 제외 ⊆ 확인 필요"인데, 스팸을 계산 제외로 만들면서 확인 필요에서 빼면 그 불변식이 깨지고,
 * 반대로 확인 필요에 넣으면 실지갑에서 절반이 넘는 스팸이 큐를 덮어 진짜 확인할 거래가 묻힌다.
 * 원장에서 아예 빼면 사용자가 스팸 행을 볼 일이 없어 두 문제가 다 사라진다 —
 * 대신 몇 건을 숨겼는지는 화면이 반드시 말한다(조용히 지우면 거래가 사라진 것과 같다).
 *
 * 유효 분류를 보므로 사용자가 오탐을 되돌리면(재분류) 그 즉시 원장으로 돌아온다.
 */
export function isSpam(event: NormalizedEvent): boolean {
  return effectiveClassification(event) === "SPAM";
}

export function eventQuantity(event: NormalizedEvent): Decimal {
  return div(event.raw_amount, `1${"0".repeat(Math.max(0, event.decimals))}`);
}

export type TaxExclusionReason = "분류 확인 필요" | "가격 확인 필요" | "수량 확인 필요" | "방향·분류 불일치";

/**
 * 체인에서 유도한 `direction`과 파이프라인이 매긴 `classification`이 서로를 부정하는가.
 *
 * `direction`은 자산이 지갑에 들어왔는지(IN)·나갔는지(OUT)의 체인 사실이고,
 * `classification`은 그 흐름의 의미다. 취득(RECEIVE)은 들어온 것이라 IN이어야 하고,
 * 처분(SEND)은 나간 것이라 OUT이어야 한다. 뒤집히면(RECEIVE+OUT·SEND+IN) 둘 중 하나가 틀렸다 —
 * 그대로 엔진에 넣으면 나간 자산을 취득으로, 들어온 자산을 처분으로 기록해 총평균 단가를 오염시킨다.
 *
 * EXCHANGE·INTERNAL_TRANSFER는 방향을 강제하지 않는다: 교환은 한쪽 자산이 나가고 다른 쪽이 들어오며
 * 어느 다리가 이 이벤트인지에 따라 IN·OUT 둘 다 정상이고, 자기 지갑 간 이체도 보내는 쪽은 OUT,
 * 받는 쪽은 IN으로 양쪽이 다 옳다. UNKNOWN은 방향 제약이 없다(분류 자체가 미확정이라 별도 사유로 걸린다).
 *
 * **유효 분류가 아니라 파이프라인이 원래 매긴 `classification`을 본다.** 이 게이트가 잡으려는 것은
 * 사용자 손이 닿기 전, 자동 분류와 체인 방향이 서로를 부정하며 들어온 **원본 데이터 결함**이다.
 * 사용자가 방향과 일치하는 원본 위에 다른 분류를 덧씌운 것(예: 체인 IN·자동 RECEIVE를 SEND로 재분류)은
 * 정합한 데이터에 대한 의도적 판단이라 결함이 아니고, 유효 분류로 보면 이런 정상 재분류가 오검출된다.
 * 반대로 원본이 이미 어긋난 건(체인 IN·자동 SEND)은 사용자가 같은 분류를 확정해도 원본 모순은 남으므로 잡는다.
 */
export function directionClassificationConflict(event: NormalizedEvent): boolean {
  if (event.classification === "RECEIVE") return event.direction === "OUT";
  if (event.classification === "SEND") return event.direction === "IN";
  return false;
}

/**
 * 사용자가 입력한 금액 override가 이 이벤트의 흐름에 맞는 원화 금액을 제공하는지.
 *
 * 취득(RECEIVE)은 취득가액을, 처분(SEND·EXCHANGE)은 양도가액을 본다. 값이 있으면
 * 지갑 가격이 미확정(price_status=UNKNOWN·fiat_value=null)이어도 계산 대상으로 인정한다 —
 * 이것이 "취득가 0원" 이벤트를 확인 필요 큐에서 빼고 계산에 넣는 통로다.
 */
export function overrideFiatValue(event: NormalizedEvent): Decimal | null {
  const vo = event.value_override;
  if (!vo) return null;
  const flow = assetFlow(event);
  if (flow === "in") return vo.acquisition_cost;
  if (flow === "out") return vo.disposal_value;
  return null;
}

/**
 * 세금 계산에 넣을 수 없는 사유. 넣을 수 있으면 null.
 * `deriveTaxEvents`가 이 판정을 그대로 쓴다.
 */
export function taxExclusionReason(event: NormalizedEvent): TaxExclusionReason | null {
  if (effectiveClassification(event) === "UNKNOWN") return "분류 확인 필요";
  // 지갑 가격이 미확정이어도 사용자가 원화 금액을 입력했으면 계산 대상이다.
  if ((event.price_status === "UNKNOWN" || event.fiat_value === null) && overrideFiatValue(event) === null) {
    return "가격 확인 필요";
  }
  if (!isPositive(eventQuantity(event))) return "수량 확인 필요";
  // 방향·분류 정합은 마지막에 본다. 가격·수량 같은 다른 사유가 있으면 그쪽을 먼저 고쳐야 하고,
  // 그 사유가 없는데도 방향과 의미가 뒤집혀 있으면 여기서 게이트로 잡아 엔진에 넘기지 않는다.
  if (directionClassificationConflict(event)) return "방향·분류 불일치";
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

/** 자산이 지갑으로 들어왔는가(`in`), 나갔는가(`out`), 어느 쪽도 아닌가(`neutral`). */
export type AssetFlow = "in" | "out" | "neutral";

/**
 * 화면이 "쓴 것"과 "얻은 것"을 가르는 기준.
 *
 * `direction`이 아니라 **유효 분류**로 정한다. 둘은 갈릴 수 있고(체인상 IN이지만 사용자가 SEND로 확정),
 * 세무 파생(`deriveTaxEvents`)은 분류를 따른다 — 화면만 direction을 보면 같은 거래를 두고
 * 목록은 "얻음", 원장은 "처분"이라 말하게 된다.
 *
 * 갈래는 파생과 정확히 같다: RECEIVE → 취득 / SEND·EXCHANGE → 처분 /
 * 자기 지갑 간 이체·미확정 → 어느 쪽도 아님(처분이 아니거나 계산에 들어가지 않는다).
 */
export function assetFlow(event: NormalizedEvent): AssetFlow {
  const classification = effectiveClassification(event);
  if (classification === "RECEIVE") return "in";
  if (classification === "SEND" || classification === "EXCHANGE") return "out";
  return "neutral";
}
