import { CLASSIFICATION_LABEL } from "@/components/ui/classification-badge";
import { INCOME_KIND_LABEL } from "@/components/ui/income-kind-badge";
import { effectiveClassification } from "@/lib/review";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 목록 한 줄의 **거래 타입** 라벨(왼쪽 굵은 줄).
 *
 * 분류(classification)를 그대로 쓰되, 스왑·브릿지는 별도로 부른다:
 * - income_kind가 있으면 그 수익 종류(스테이킹 보상 등)
 * - EXCHANGE → 도착 체인이 있으면(자산이 바뀌는 크로스체인 브릿지, 예: Mayan) "브릿지 스왑",
 *   아니면 같은 체인 스왑 "스왑"
 * - INTERNAL_TRANSFER → 도착 체인이 있으면(같은 자산 크로스체인 이동) "브릿지", 아니면 "이동"
 * - 그 밖(RECEIVE·SEND·UNKNOWN) → 분류 라벨(수신·송금·미분류)
 *
 * 판정 도장(취득·양도 등)은 이제 목록이 아니라 거래 상세에서만 말한다.
 */
export function transactionTypeLabel(event: NormalizedEvent): string {
  if (event.income_kind) return INCOME_KIND_LABEL[event.income_kind];
  const classification = effectiveClassification(event);
  if (classification === "EXCHANGE") return event.bridge_dest_chain_id !== null ? "브릿지 스왑" : "스왑";
  if (classification === "INTERNAL_TRANSFER") return event.bridge_dest_chain_id !== null ? "브릿지" : "이동";
  return CLASSIFICATION_LABEL[classification];
}

/**
 * 거래 타입 배지의 색. 분류별 색은 상세 상단의 ClassificationBadge와 같은 팔레트를 쓰되,
 * income_kind(수익 수령)는 IncomeKindBadge처럼 violet로 구분한다. 스왑(EXCHANGE)·브릿지·이동
 * (INTERNAL_TRANSFER)은 분류 색을 그대로 따른다(라벨만 transactionTypeLabel이 바꾼다).
 */
const TYPE_BADGE_CLASS: Record<Classification, string> = {
  RECEIVE: "bg-green-100 text-green-700",
  SEND: "bg-red-100 text-red-700",
  EXCHANGE: "bg-orange-100 text-orange-700",
  INTERNAL_TRANSFER: "bg-blue-100 text-blue-700",
  UNKNOWN: "bg-zinc-100 text-zinc-600",
  // 스팸은 원장에서 빠져 목록에 뜨지 않지만 Record 계약상 빠짐없이 있어야 한다.
  SPAM: "bg-zinc-200 text-zinc-500",
};

/** 목록 왼쪽의 **거래 타입 배지**. 라벨은 transactionTypeLabel, 색은 분류(또는 수익 수령이면 violet). */
export function TransactionTypeBadge({ event }: { event: NormalizedEvent }) {
  const className = event.income_kind
    ? "bg-violet-100 text-violet-700"
    : TYPE_BADGE_CLASS[effectiveClassification(event)];
  return (
    <span className={`inline-flex shrink-0 items-center self-start rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      {transactionTypeLabel(event)}
    </span>
  );
}
