import type { ConfirmationStatus, LimitationKind, RuleTopic } from "@/lib/tax/types";

/** 리포트 화면의 섹션들이 같은 말을 쓰도록 라벨·색을 한 곳에 둔다. */

export const STATUS_LABEL: Record<ConfirmationStatus, string> = {
  CONFIRMED: "확정·시행중",
  SCHEDULED: "확정·시행예정",
  PARTIAL: "부분확정",
  UNDETERMINED: "미확정",
};

const STATUS_STYLE: Record<ConfirmationStatus, string> = {
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  SCHEDULED: "bg-blue-100 text-blue-800",
  PARTIAL: "bg-amber-100 text-amber-800",
  UNDETERMINED: "bg-zinc-200 text-zinc-700",
};

export const TOPIC_LABEL: Record<RuleTopic, string> = {
  CAPITAL_GAINS: "매매차익",
  STAKING: "스테이킹·렌딩",
  AIRDROP: "에어드랍",
  CRYPTO_TO_CRYPTO: "가상자산 간 교환",
  DEFI_LP: "디파이 LP",
  WRAPPING: "랩핑",
  LOSS_OFFSET: "손실 상계",
};

// 배지는 "계산이 무엇을 했는지"만 말한다. 섹션 제목(흔들리는 지점)과 같은 말을 배지에 또 쓰면 줄마다 반복된다.
export const LIMITATION_LABEL: Record<LimitationKind, string> = {
  excluded: "계산 제외",
  zero_basis: "취득가액 0원으로 계산",
  approximation: "근사 계산",
  not_reflected: "미반영",
  other: "기타 확인 사항",
};

export const LIMITATION_STYLE: Record<LimitationKind, string> = {
  excluded: "bg-amber-100 text-amber-900",
  zero_basis: "bg-red-100 text-red-900",
  approximation: "bg-blue-100 text-blue-900",
  not_reflected: "bg-zinc-100 text-zinc-700",
  other: "bg-zinc-100 text-zinc-700",
};

export function StatusBadge({ status }: { status: ConfirmationStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}
