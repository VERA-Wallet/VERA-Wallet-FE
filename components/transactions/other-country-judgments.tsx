"use client";

import { AMOUNT_KIND_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { formatFiat } from "@/lib/format";
import { fresh, freshNotice, type FreshState } from "@/lib/queries/fresh";
import { useTaxEstimate } from "@/lib/queries/tax";
import { isZero } from "@/lib/tax/decimal";
import type { JudgmentRow, TaxEstimate } from "@/lib/tax/types";

const COMPARISON_COUNTRIES = ["DE", "IN", "PT"] as const;

export function OtherCountryJudgments({
  eventId,
  countryCode,
  taxYear,
  grounded,
}: {
  eventId: string;
  countryCode: string;
  taxYear: number;
  /** 과세연도가 신뢰할 수 있는 기간에서 나왔는가. 아니면 계산 자체를 하지 않는다. */
  grounded: boolean;
}) {
  const [de, india, portugal] = COMPARISON_COUNTRIES;
  const firstCountry = countryCode === de ? india : de;
  const secondCountry = countryCode === de ? portugal : countryCode === india ? portugal : india;
  const firstEstimate = useTaxEstimate({ country: firstCountry, taxYear, source: "wallet" }, grounded);
  const secondEstimate = useTaxEstimate({ country: secondCountry, taxYear, source: "wallet" }, grounded);
  const firstFresh = fresh(firstEstimate, !grounded);
  const secondFresh = fresh(secondEstimate, !grounded);
  const firstRows = firstFresh.data?.judgments.filter((row) => row.eventId === eventId) ?? [];
  const secondRows = secondFresh.data?.judgments.filter((row) => row.eventId === eventId) ?? [];

  const renderRows = (
    estimate: TaxEstimate | undefined,
    rows: JudgmentRow[],
    country: string,
    state: FreshState,
  ) => {
    if (!estimate) {
      return <p className={state === "error" ? "text-sm text-amber-800" : "text-sm text-zinc-500"}>{freshNotice(state, `${country} 판정 정보`)}</p>;
    }
    // 로딩이 끝났는데 행이 없으면 그 나라 계산에도 들어가지 않은 것이다. 계속 "불러오는 중"이라 하면 거짓이다.
    if (rows.length === 0) {
      return (
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
          <span className="font-medium">{estimate.countryLabel}</span>
          <span className="text-zinc-500">계산에 들어가지 않음</span>
        </p>
      );
    }

    return rows.map((row, index) => (
      <p key={`${row.eventId}-${row.leg}-${index}`} className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
        <span className="font-medium">{estimate.countryLabel}</span>
        {row.leg === "dispose" ? <span className="text-zinc-500">내보냄</span> : null}
        {row.leg === "receive" ? <span className="text-zinc-500">받음</span> : null}
        <JudgmentBadge group={row.group} label={row.label} />
        <span>{AMOUNT_KIND_LABEL[row.amountKind]} · {isZero(row.amount) ? "없음" : formatFiat(row.amount, estimate.currency)}</span>
      </p>
    ));
  };

  return (
    <details className="mt-4 rounded-lg bg-zinc-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 marker:text-zinc-400">국가별 계산 비교</summary>
      <div className="mt-2 space-y-2">
        {renderRows(firstFresh.data, firstRows, firstCountry, firstFresh.state)}
        {renderRows(secondFresh.data, secondRows, secondCountry, secondFresh.state)}
      </div>
    </details>
  );
}
