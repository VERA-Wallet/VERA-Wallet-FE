"use client";

import { StatusBadge } from "@/components/report/labels";
import { OtherCountries } from "@/components/report/other-countries";
import { useReportContext } from "@/components/report/report-context";
import { ReportSubPage } from "@/components/report/report-sub-page";
import { formatFiat } from "@/lib/format";
import { halfOpenPeriodLabel } from "@/lib/period";
import { noChargeHeadline, omitsCharge } from "@/lib/tax/status";

/**
 * 다른 나라였다면 — 같은 원장에 다른 나라 룰셋을 적용해 본다.
 *
 * 예전에는 칩만 접혀 있어서, 나라를 고른 뒤 결과를 보려면 화면 맨 위로 되돌아가야 했다.
 * 고른 나라의 답과 핵심 차이를 이 화면 안에서 바로 보인다 — 값은 새로 계산하지 않고
 * 같은 프로바이더의 estimate 하나를 그대로 읽는다(나라를 바꾸면 그 하나가 다시 계산된다).
 */
export function ReportCompare() {
  const { result, rulesets, country, setCountry, comparingLabel, hasNothingToCompute, returnHome } = useReportContext();

  return (
    <ReportSubPage surface="report-compare" title="다른 나라였다면">
      <OtherCountries
        rulesets={rulesets.data ?? []}
        country={country}
        onSelect={setCountry}
        loading={rulesets.isLoading}
      />

      {result ? (
        <section className="mt-5" aria-label="비교 결과">
          {/* 제목은 메인의 "{나라} · {연도}"와 글자가 달라야 한다 — 같으면 한 앱 안에서 같은 문구가
              두 화면의 제목이 되어, 어느 화면을 보고 있는지 말로는 구별되지 않는다. */}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-900">{result.countryLabel} 기준</h2>
            <StatusBadge status={result.status} />
          </div>
          <div className="mt-3 rounded-card border border-zinc-200 bg-white p-4 shadow-card">
            <p className="text-sm text-zinc-500">예상 부담 추정</p>
            {/* 답을 내지 않은 상태(시행 전·규칙 미확정·셀 것 없음)를 0원으로 적으면 "낼 게 없다"로 읽힌다.
                메인과 같은 규칙으로 이유를 그대로 말한다. */}
            <p data-testid="compare-charge" className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
              {omitsCharge(result.status)
                ? noChargeHeadline(result.status)
                : hasNothingToCompute
                  ? "계산할 거래 없음"
                  : formatFiat(result.totals.estimatedCharge, result.currency)}
            </p>
            {!omitsCharge(result.status) && !hasNothingToCompute ? (
              <p className="mt-1 text-sm text-zinc-500">실효 {result.totals.effectiveRatePercent}%</p>
            ) : null}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2">
            {[
              { label: "계산 방식", value: result.method },
              { label: "통화", value: result.currency },
              { label: "과세기간", value: halfOpenPeriodLabel(result.period) },
              { label: "과세표준 제외", value: formatFiat(result.totals.exemptGains, result.currency) },
            ].map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 shadow-card">
                <dt className="shrink-0 text-sm text-zinc-500">{row.label}</dt>
                <dd className="text-right text-sm font-medium text-zinc-900">{row.value}</dd>
              </div>
            ))}
          </dl>
          {comparingLabel !== null ? (
            // 비교를 켜 둔 채 이 화면을 떠나면 메인의 금액도 그 나라 기준이고 내려받기도 막힌다.
            // 돌아갈 문을 여기에도 둔다 — 메인까지 가야만 끌 수 있으면 켠 줄도 모른 채 막힌다.
            <div className="mt-3 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-sm leading-6 text-zinc-600">
                <span className="font-semibold">비교 중: {comparingLabel}</span> · 이대로 리포트로 돌아가면 금액도 이
                나라 기준이고, 신고 근거자료는 만들 수 없습니다.
              </p>
              <button
                type="button"
                onClick={returnHome}
                className="shrink-0 rounded-lg border border-primary-500 px-2.5 py-1 text-xs font-semibold text-primary-600"
              >
                거주국으로
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="mt-5 text-sm leading-6 text-zinc-500">고른 나라의 계산 결과를 기다리는 중입니다.</p>
      )}
    </ReportSubPage>
  );
}
