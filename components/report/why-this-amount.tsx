import Link from "next/link";

import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { formatFiat } from "@/lib/format";
import { round, sum } from "@/lib/tax/decimal";
import type { JudgmentGroup, JudgmentRow, TaxEstimate } from "@/lib/tax/types";

/**
 * L2 — "왜 이 금액인가".
 * 판정 그룹별로 접어 **건수와 금액**을 보인다. 총액(L1)과 건별 근거(L3) 사이를 잇는 층이다.
 */
export type GroupRow = {
  group: JudgmentGroup;
  amountKind: JudgmentRow["amountKind"];
  count: number;
  amount: string;
  label: string;
};

/** 화면 순서는 "답에 가까운 것"부터: 과세 → 소득 → 비과세·상계 → 손실 → 나머지. */
const GROUP_ORDER: JudgmentGroup[] = [
  "taxable", "income", "exempt", "offset", "carry", "ignored", "denied", "deferred", "pending", "acquire",
];

/** 접힌 라벨들이 공통으로 말하던 조정 사유를 한 조각만 남긴다. */
function adjustmentSuffix(labels: string[]): string {
  const reasons = ["상계", "공제", "면세", "할인", "포함률"].filter((word) =>
    labels.every((label) => label.includes(word)),
  );
  return reasons.length > 0 ? ` · ${reasons.join("·")} 적용` : "";
}

export function groupJudgments(result: TaxEstimate): GroupRow[] {
  // 금액 종류가 다른 행을 한 숫자로 더하면 의미 없는 합계가 된다.
  // 한국의 `pending`은 손익과 수령 FMV를 함께 담는다 — 둘을 더한 수는 아무것도 아니다.
  const byKey = new Map<string, { events: Set<string>; amounts: string[]; labels: Set<string> }>();
  for (const row of result.judgments) {
    const key = `${row.group}${row.amountKind}`;
    const bucket = byKey.get(key) ?? { events: new Set(), amounts: [], labels: new Set() };
    bucket.events.add(row.eventId);
    bucket.amounts.push(row.amount);
    bucket.labels.add(row.label);
    byKey.set(key, bucket);
  }
  return [...byKey]
    .map(([key, bucket]) => {
      const [group, amountKind] = key.split("") as [JudgmentGroup, JudgmentRow["amountKind"]];
      return {
        group,
        amountKind,
        count: bucket.events.size,
        amount: round(sum(bucket.amounts), 2),
        // 라벨이 하나면 룰셋 문구를 그대로 쓴다.
        // 여러 개를 그룹 이름으로만 접으면 "왜 줄었는지"가 사라진다 — 조정 사유는 남긴다.
        label:
          bucket.labels.size === 1
            ? [...bucket.labels][0]!
            : `${GROUP_SHORT_LABEL[group]}${adjustmentSuffix([...bucket.labels])}`,
      };
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export function WhyThisAmount({ groups, currency }: { groups: GroupRow[]; currency: string }) {
  return (
    <section className="mt-6" aria-label="판정 그룹">
      <h3 className="font-bold text-zinc-900">거래별 계산 반영 내역</h3>
      <p className="mt-1 text-sm text-zinc-500">
        세금은 과세기간 전체 거래를 합산하여 계산합니다. 아래에서 거래 유형별 반영 내역을 확인할 수 있습니다.
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-2">
        {groups.map((row) => (
          <li
            key={`${row.group}-${row.amountKind}`}
            data-group={row.group}
            data-amount-kind={row.amountKind}
            className="flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 shadow-card"
          >
            <div className="min-w-0">
              <JudgmentBadge group={row.group} label={row.label} />
              <p className="mt-1 text-xs text-zinc-500">
                {row.count}건 · {AMOUNT_KIND_LABEL[row.amountKind]}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-zinc-900">
              {formatFiat(row.amount, currency)}
            </p>
          </li>
        ))}
      </ul>
      <Link
        href="/transactions"
        className="mt-2 flex items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 text-sm text-zinc-700 shadow-card"
      >
        <span>거래별 분류 확인</span>
        <span className="shrink-0 font-semibold text-primary-600 underline">거래 내역 확인</span>
      </Link>
    </section>
  );
}
