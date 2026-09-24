"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Downloads } from "@/components/report/downloads";
import { useReportContext } from "@/components/report/report-context";
import { ReportMenu } from "@/components/report/report-menu";
import { ReportCard } from "@/components/report/report-card";
import { ReportSummary } from "@/components/report/report-summary";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/provenance-chip";
import { taxYearWindow } from "@/lib/tax/year-window";

/**
 * 리포트 메인 — **세금 보고서**와 **리포트 내보내기** 두 가지만 남긴다.
 *
 * 예전에는 근거·한계·판단 항목·계산 설정·나라 비교까지 한 화면에 쌓아 12,259px(13.6화면)였고,
 * 이 화면의 본업인 내려받기가 10,000px 아래에 있었다. 나머지는 기능별 화면으로 나가고
 * 메인에는 그 화면들로 가는 메뉴 줄만 남는다(2026-09-18 사용자 결정).
 *
 * 입력과 결과는 여전히 하나다 — `app/export/layout.tsx`의 `ReportInputsProvider`가
 * `useReportInputs`를 한 번 부르고, 이 화면을 포함한 다섯 화면이 그 결과를 함께 읽는다.
 */
export function ReportMain() {
  const {
    result,
    previousResult,
    freshEstimate,
    rulesets,
    rulesetsFailed,
    headerNote,
    hasNothingToCompute,
    country,
    taxYear,
    setTaxYear,
    assumeEffective,
    canAssumeEffective,
    setAssumeEffective,
    effectiveTaxYear,
    openedOnPastYear,
    previewingEffectiveYear,
    currentYear,
    latestActivityYear,
    walletConnected,
    events,
    summary,
    ledgerError,
    ready,
    activePeriod,
    plan,
    planName,
    subscribed,
    allowance,
    billableCount,
    downloadLocked,
    gaugePercent,
    blockedReason,
    comparingLabel,
    showReportCard,
    returnHome,
  } = useReportContext();

  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const yearOptions = taxYearWindow(currentYear, latestActivityYear, effectiveTaxYear);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
      {/* 1. 헤더 */}
      <header data-surface="report" className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">리포트</h1>
            {/* 귀속연도 칩을 탭하면 연도를 고르는 바텀시트가 열린다. 선택은 전역 소스에 써서
                요약·거래 화면과 공유한다. */}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={yearPickerOpen}
              onClick={() => setYearPickerOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-600"
            >
              <span>{taxYear}년 귀속</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
            </button>
          </div>
          {/* 설명은 실제 상태에서 파생한다. 정적 문장으로 두면 데모를 지갑이라 하고,
              아직 계산하지 않은 화면을 "적용한 결과"라고 단정한다. */}
          <p className="mt-2 text-sm text-zinc-500">{headerNote}</p>
          {/* 고지 3줄이 쌓이면 아무것도 읽히지 않는다 — 배지로 접고 전문은 아래에 보존. */}
          {openedOnPastYear || previewingEffectiveYear ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {openedOnPastYear ? (
                <span className="inline-flex rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                  {latestActivityYear}년으로 열림
                </span>
              ) : null}
              {previewingEffectiveYear ? (
                <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {effectiveTaxYear}년 시행 기준 미리보기
                </span>
              ) : null}
            </div>
          ) : null}
          {openedOnPastYear || previewingEffectiveYear ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-zinc-400">이 연도로 연 이유</summary>
              {openedOnPastYear ? (
                <p className="mt-1 text-sm text-zinc-500">
                  {currentYear}년에는 계산할 거래가 없어 마지막 거래가 있는 {latestActivityYear}년으로 열었습니다.
                </p>
              ) : null}
              {previewingEffectiveYear ? (
                <p className="mt-1 text-sm text-zinc-500">
                  아직 시행 전인 {effectiveTaxYear}년 기준으로 미리 계산했습니다. 시행일이 지나야 확정된 답이 됩니다.
                </p>
              ) : null}
            </details>
          ) : null}
        </div>
        {/* 배지는 계산 입력의 출처를 말한다. 실 BE 스냅샷(live)으로 계산한 답에 mock 배지를 붙이면 거짓이 된다. */}
        {result?.provenance === "mock" ? <MockProvenanceChip /> : null}
      </header>
      {ledgerError && <p className="mt-3 text-sm text-red-600">{ledgerError}</p>}

      {/* 지갑 미연결 동안 상시 노출한다 — 가정 배너와 같은 원칙: 답 옆에 그 사실이 계속 있어야 한다. */}
      {!walletConnected ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-sm leading-6 text-zinc-600">
            데모 시나리오로 보는 중입니다. 지갑을 연결하면 이 화면이 내 거래로 다시 계산됩니다.
          </p>
          <Link
            href="/connect-wallet"
            className="shrink-0 rounded-lg border border-primary-500 px-2.5 py-1 text-xs font-semibold text-primary-600"
          >
            연결하기
          </Link>
        </div>
      ) : null}

      {rulesetsFailed ? (
        // 룰셋을 못 받으면 답도 못 낸다. 오류만 띄우고 나가는 문을 안 주면 막다른 화면이다.
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-red-600">
          <span>
            {rulesets.isError
              ? "룰셋 목록을 불러오지 못했습니다."
              : `이 목록에 ${country} 룰셋이 없습니다.`}{" "}
            룰셋을 알기 전에는 계산하지 않습니다.
          </span>
          <button
            type="button"
            className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-700"
            onClick={() => void rulesets.refetch()}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {freshEstimate.state === "error" ? (
        <p role="alert" className="mt-4 text-sm text-red-600">계산 결과를 불러오지 못했습니다.</p>
      ) : null}
      {freshEstimate.state === "pending" ? (
        <p className="mt-6 text-sm text-zinc-500">계산 결과를 불러오는 중입니다</p>
      ) : null}
      {freshEstimate.state === "disabled" && !rulesetsFailed ? (
        // 요청을 보낸 적이 없다. "불러오는 중"이라 하면 하지 않은 일을 하고 있다고 말하는 것이다.
        <p className="mt-6 text-sm text-zinc-500">적용할 룰셋을 확인하는 중입니다. 아직 계산하지 않았습니다.</p>
      ) : null}

      {/* 2. 시행 가정 안내 — 고른 연도가 시행 전일 때만. 시행 예정 룰셋이면 가정을 켜고 열되(사용자 결정),
          켜져 있는 동안 그 사실이 금액 옆에 계속 있어야 한다. 끄는 문은 그대로 남는다. */}
      {canAssumeEffective ? (
        assumeEffective ? (
          <div data-surface="assume-effective" className="mt-5 rounded-card border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-6 text-amber-900">
                <span className="font-semibold">시행 가정으로 보는 중입니다</span> · 아래 금액은 {taxYear}년 거래에{" "}
                {effectiveTaxYear}년 시행 규칙을 적용했다고 가정한 값이며, 실제 부담이 아닙니다.
              </p>
              <button
                type="button"
                aria-pressed={true}
                className="shrink-0 rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-900"
                onClick={() => setAssumeEffective(false)}
              >
                가정 끄기
              </button>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-amber-800">시행 전인 지금 실제 부담은</summary>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {taxYear}년은 아직 시행 전({effectiveTaxYear}년 시행)이라 실제 부담은 0원입니다.
              </p>
            </details>
          </div>
        ) : (
          <div data-surface="assume-effective" className="mt-5 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm leading-6 text-zinc-600">
              {taxYear}년은 아직 시행 전({effectiveTaxYear}년 시행)이라 실제 부담은 0원입니다. 시행 후 규칙으로
              계산하면 얼마인지 미리 볼 수 있습니다.
            </p>
            <button
              type="button"
              aria-pressed={false}
              onClick={() => setAssumeEffective(true)}
              className="shrink-0 rounded-lg border border-primary-500 px-3 py-1.5 text-sm font-semibold text-primary-600"
            >
              시행 가정으로 보기
            </button>
          </div>
        )
      ) : null}

      {/* 3. 세금 보고서 — 답 + 신고 기입란 8줄. 같은 estimate 하나에서 나온다. */}
      {result ? (
        <ReportSummary
          result={result}
          hasNothingToCompute={hasNothingToCompute}
          comparingLabel={comparingLabel}
          onReturnHome={returnHome}
        />
      ) : null}
      {showReportCard && result ? <ReportCard estimate={result} /> : null}
      {!result && previousResult ? (
        <section aria-busy="true" aria-label="이전 계산 결과">
          <p role="status" className="mt-4 text-sm text-zinc-500">업데이트 중입니다. 이전 계산 결과를 표시합니다. 새 결과 확인 전에는 내보내기와 증명서 발급에 사용하지 않습니다.</p>
          {previousResult.country === "KR" ? <ReportCard estimate={previousResult} /> : (
            <ReportSummary result={previousResult} hasNothingToCompute={false} comparingLabel={comparingLabel} onReturnHome={returnHome} />
          )}
        </section>
      ) : null}

      {/* 4. 내보내기 — 구독 상태와 내려받기. 이 화면의 본업이므로 메뉴보다 위에 둔다.
          요약을 아직 못 읽었으면(summary === null) 건수·게이지는 그리지 않는다 — 근거 없는 숫자는
          locked 판정과 같은 원칙으로 금지한다. */}
      {plan !== null && (
        <Card data-surface="plan-status" className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-zinc-900">
              {planName} 플랜 · {plan.taxYear}년 귀속
            </p>
            <MockProvenanceChip />
          </div>
          {summary !== null && (
            <>
              <p className="mt-3 text-sm text-zinc-600">
                {allowance.toLocaleString("ko-KR")}건 중 {billableCount.toLocaleString("ko-KR")}건 사용
              </p>
              <div
                role="progressbar"
                aria-label="내보내기 사용량"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={gaugePercent}
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100"
              >
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${gaugePercent}%` }} />
              </div>
            </>
          )}
          <p className="mt-3 text-xs text-zinc-500">과세연도당 한 번 결제</p>
          {/* 지금 보는 귀속연도가 활성 플랜의 연도와 다르면 사실만 한 줄 덧붙인다.
              두 연도를 대조해 잠금을 걸지는 않는다 — 그 대조에는 BE 계약이 필요하다(use-plan.ts 주석). */}
          {taxYear !== plan.taxYear && (
            <p className="mt-2 text-sm text-zinc-500">
              활성 플랜은 {plan.taxYear}년 귀속입니다. 지금 보는 연도는 {taxYear}년
            </p>
          )}
        </Card>
      )}

      <Downloads
        events={events}
        estimate={result ?? null}
        summary={summary}
        activePeriod={activePeriod}
        ready={ready}
        downloadLocked={downloadLocked}
        blockedReason={blockedReason}
        subscribed={subscribed}
        planName={planName}
        allowance={allowance}
        billableCount={billableCount}
      />

      {/* 5. 메뉴 — 근거·확인할 것·설정·나라 비교는 각자의 화면으로 갔다. 여기서는 상태만 말한다. */}
      <ReportMenu />

      {/* 귀속연도 선택 바텀시트. 고른 해는 전역 소스에 써서 estimate를 그 해로 재계산하고,
          요약·거래 화면도 같은 해를 본다. 목록은 최근·미래가 위로 오게 내림차순. */}
      <BottomSheet open={yearPickerOpen} onClose={() => setYearPickerOpen(false)} title="귀속연도 선택">
        <h2 className="text-lg font-bold text-zinc-900">귀속연도 선택</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          고른 연도로 리포트를 다시 계산합니다. 시행 전 연도는 정직하게 &ldquo;시행 전&rdquo;으로 표시됩니다.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-2">
          {[...yearOptions].reverse().map((year) => {
            const isEffective = effectiveTaxYear !== undefined && year === effectiveTaxYear && year > currentYear;
            return (
              <li key={year}>
                <button
                  type="button"
                  aria-pressed={year === taxYear}
                  className={`flex w-full items-center justify-between gap-3 rounded-card border px-4 py-3 text-left text-sm font-semibold ${
                    year === taxYear ? "border-primary-500 bg-primary-50 text-primary-600" : "border-zinc-200 bg-white text-zinc-700"
                  }`}
                  onClick={() => {
                    setTaxYear(year);
                    setYearPickerOpen(false);
                  }}
                >
                  <span>{year}년 귀속</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {latestActivityYear !== undefined && year === latestActivityYear ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">데이터</span>
                    ) : null}
                    {isEffective ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">시행</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </main>
  );
}
