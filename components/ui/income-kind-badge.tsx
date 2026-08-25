import type { IncomeKind } from "@/lib/tax/types";

export type { IncomeKind };

/**
 * DeFi 수익(수령분) 종류의 한글 라벨.
 * income_kind가 있는 RECEIVE는 단순 수신이 아니라 소득 수령이므로,
 * 목록·상세에서 "수신" 대신 이 라벨로 무슨 수익인지 밝힌다.
 */
export const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  STAKING: "스테이킹 보상",
  DEFI_REWARD: "디파이 보상",
  LENDING: "대여 이자",
  AIRDROP: "에어드랍",
  AIRDROP_INITIAL: "에어드랍 최초배분",
  MINING: "채굴",
};

type IncomeKindBadgeProps = {
  kind: IncomeKind;
};

export function IncomeKindBadge({ kind }: IncomeKindBadgeProps) {
  // 수신(녹색)과 색으로 구분한다 — 같은 IN이지만 소득 수령이라는 별도 정보다.
  return (
    <span
      data-income-kind={kind}
      className="inline-flex shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700"
    >
      {INCOME_KIND_LABEL[kind]}
    </span>
  );
}
