import type { Classification } from "@/lib/schema/normalized-event";

export type { Classification };

const classificationStyles: Record<
  Classification,
  { label: string; className: string }
> = {
  RECEIVE: { label: "수신", className: "bg-green-100 text-green-700" },
  SEND: { label: "송금", className: "bg-red-100 text-red-700" },
  EXCHANGE: { label: "교환", className: "bg-orange-100 text-orange-700" },
  INTERNAL_TRANSFER: {
    label: "내부 이동",
    className: "bg-blue-100 text-blue-700",
  },
  UNKNOWN: { label: "미분류", className: "bg-zinc-100 text-zinc-600" },
  // 스팸은 원장에서 빠지므로 목록에는 거의 뜨지 않지만, 오탐을 되돌리는 화면에는 이 라벨이 필요하다.
  SPAM: { label: "스팸", className: "bg-zinc-200 text-zinc-500" },
};

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  RECEIVE: classificationStyles.RECEIVE.label,
  SEND: classificationStyles.SEND.label,
  EXCHANGE: classificationStyles.EXCHANGE.label,
  INTERNAL_TRANSFER: classificationStyles.INTERNAL_TRANSFER.label,
  UNKNOWN: classificationStyles.UNKNOWN.label,
  SPAM: classificationStyles.SPAM.label,
};

type ClassificationBadgeProps = {
  classification: Classification;
};

export function ClassificationBadge({
  classification,
}: ClassificationBadgeProps) {
  const { label, className } = classificationStyles[classification];

  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
