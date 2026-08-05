import type { JudgmentGroup, JudgmentRow } from "@/lib/tax/types";

/**
 * 판정 도장. 세금 금액이 아니라 "이 거래가 계산에서 어떻게 쓰였는지"를 찍는다.
 * 실제 문구(label)는 룰셋이 정하므로 여기서는 색만 그룹에 매핑한다.
 */
const GROUP_STYLE: Record<JudgmentGroup | "excluded", string> = {
  acquire: "bg-slate-100 text-slate-700",
  income: "bg-amber-100 text-amber-800",
  taxable: "bg-red-100 text-red-700",
  exempt: "bg-green-100 text-green-700",
  offset: "bg-teal-100 text-teal-800",
  carry: "bg-indigo-100 text-indigo-700",
  ignored: "bg-zinc-200 text-zinc-700",
  denied: "bg-orange-100 text-orange-800",
  deferred: "bg-sky-100 text-sky-800",
  pending: "bg-zinc-100 text-zinc-600",
  excluded: "bg-amber-100 text-amber-800",
};

/** 그룹 필터 칩에 쓰는 짧은 이름. 행 도장에는 룰셋 label을 그대로 쓴다. */
export const GROUP_SHORT_LABEL: Record<JudgmentGroup | "excluded", string> = {
  acquire: "취득",
  income: "소득",
  taxable: "과세",
  exempt: "비과세",
  offset: "상계 소멸",
  carry: "손실",
  ignored: "상계 불가",
  denied: "부인",
  deferred: "이연",
  pending: "판정 보류",
  excluded: "계산 제외",
};

export function JudgmentBadge({ group, label }: { group: JudgmentGroup | "excluded"; label: string }) {
  return (
    <span
      data-judgment-badge={group}
      // 독일 면세한계처럼 라벨이 길어질 수 있다. shrink-0로 못 박으면 좁은 화면에서 금액을 밀어낸다.
      className={`inline-flex min-w-0 max-w-full rounded-full px-2.5 py-1 text-xs font-semibold break-keep ${GROUP_STYLE[group]}`}
    >
      {label}
    </span>
  );
}

/**
 * 행 금액이 **세금이 아니라는 것**을 밝히는 라벨.
 * 두 벌로 두면 목록과 비교 화면이 같은 값을 다르게 부른다.
 */
export const AMOUNT_KIND_LABEL: Record<JudgmentRow["amountKind"], string> = {
  gain: "손익",
  cost: "취득가액",
  fmv: "수령 FMV",
  carried_cost: "승계 원가",
};
