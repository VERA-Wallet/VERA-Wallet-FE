"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CalcDetails } from "@/components/report/calc-details";
import { Downloads } from "@/components/report/downloads";
import { Limitations } from "@/components/report/limitations";
import { OpenQuestions } from "@/components/report/open-questions";
import { OtherCountries } from "@/components/report/other-countries";
import { ReportCard } from "@/components/report/report-card";
import { ReportSummary } from "@/components/report/report-summary";
import { WhyThisAmount, groupJudgments } from "@/components/report/why-this-amount";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { anchorProofProvider, eventRepository, summaryProvider } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import type { SummaryDTO } from "@/lib/http/dto";
import { formatDate, formatDateTime } from "@/lib/format";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { omitsCharge } from "@/lib/tax/status";
import { useReportInputs } from "@/lib/tax/use-report-inputs";
import { taxYearWindow } from "@/lib/tax/year-window";

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

/**
 * 리포트 — 세금 계산과 신고 근거자료 내보내기가 한 화면이다.
 *
 * 두 화면이던 시절에는 각자 estimate를 따로 냈고, 그래서 같은 귀속연도에 두 금액이 나올 수 있었다.
 * 이제 입력도 결과도 `useReportInputs` 하나다 — 리포트 카드·근거·다운로드 파일이 같은 계산에서 나온다.
 *
 * 잠기는 것은 **파일 내려받기뿐**이다(2026-09-17 사용자 결정, Koinly식). 계산 결과는 미구독이어도 전부 보인다.
 */
export function ReportView({
  countryCode,
  currentYear = new Date().getFullYear(),
  latestActivityYear,
  walletConnected = true,
}: { countryCode?: string; currentYear?: number; latestActivityYear?: number; walletConnected?: boolean } = {}) {
  const inputs = useReportInputs({ countryCode, currentYear, latestActivityYear, walletConnected });
  const {
    result,
    freshEstimate,
    rulesets,
    rulesetsFailed,
    headerNote,
    hasNothingToCompute,
    country,
    setCountry,
    homeCountry,
    isHomeCountry,
    selected,
    taxYear,
    setTaxYear,
    source,
    assumeEffective,
    canAssumeEffective,
    setAssumeEffective,
    effectiveTaxYear,
    openedOnPastYear,
    previewingEffectiveYear,
  } = inputs;

  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [proof, setProof] = useState<Awaited<ReturnType<typeof anchorProofProvider.getProof>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const { plan } = usePlan();

  useEffect(() => {
    // 지갑 미연결(DID-only)에는 낼 지갑 이력이 없다. 그래도 계산은 데모 시나리오로 보여 준다 —
    // 대신 원장·요약·앵커 증명은 부르지 않는다(ON 모드에서 bound-wallet 404가 난다).
    if (!walletConnected) return;
    let active = true;
    void Promise.all([collectAllEvents(eventRepository), summaryProvider.getSummary()])
      .then(async ([items, nextSummary]) => {
        const nextProof = items[0] ? await anchorProofProvider.getProof(items[0].event.id) : null;
        if (!active) return;
        setEvents(items.map(({ event }) => event));
        setSummary(nextSummary);
        setProof(nextProof);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "내보내기 데이터를 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, [walletConnected]);

  const ready = summary !== null && !error;
  // 파일명·기간 라벨은 선택 연도를 따른다 — estimate.period가 선택 연도의 과세기간을 싣는다.
  const activePeriod = result?.period ?? summary?.period ?? null;

  // 과금 기준은 계산 대상 이벤트 수다(`SummaryDTO.computableEventCount`) — 화면에 보이는 행 수가 아니다.
  const billableCount = summary?.computableEventCount ?? 0;
  const allowance = exportEventAllowance(plan);
  const planName = plan === null ? "무료" : planDefinition(plan.tier).name;
  // 유료 플랜(plan !== null)이 있어야 구독으로 본다.
  const subscribed = plan !== null;
  // 요약을 아직 못 읽었으면 잠그지 않는다 — 건수를 모르는 상태의 자물쇠는 근거 없는 자물쇠다.
  const locked = summary !== null && billableCount > allowance;
  // 다운로드 잠금은 두 조건의 OR다: 미구독이면 무조건 잠기고, 구독 중이어도 allowance를 넘으면 잠긴다.
  const downloadLocked = !subscribed || locked;
  // 구독 상태 카드의 게이지 값(0~100). 한도를 넘어도 막대는 100%에서 멈춘다 — 초과 사실 자체는
  // 위의 downloadLocked·안내 문구가 이미 말하므로, 막대가 그릇 밖으로 넘치는 모양을 만들지 않는다.
  const gaugePercent = summary !== null ? Math.min(Math.round((billableCount / allowance) * 100), 100) : 0;

  // 확인 필요 N = 미반영(excludedEventIds) + 원가 0원(zero_basis) 이벤트, 중복은 한 번만 센다.
  const nudgeCount = result
    ? new Set<string>([
        ...result.excludedEventIds,
        ...result.limitations.filter((limitation) => limitation.kind === "zero_basis").flatMap((limitation) => limitation.eventIds),
      ]).size
    : 0;

  // 거주국이 아닌 나라를 보고 있으면 그것은 비교다. 그 사실은 금액 옆과 내려받기 양쪽에서 말한다.
  const comparingLabel = homeCountry !== null && !isHomeCountry ? (selected?.label ?? country) : null;
  // 잠금(플랜)과 다른 이유로 파일을 만들 수 없는 경우. 자물쇠가 아니라 사실을 말한다.
  const blockedReason = !walletConnected
    ? "지갑을 연결하면 내 거래로 신고 근거자료를 만들 수 있습니다."
    : source === "scenario"
      ? "데모 시나리오는 내 지갑 데이터가 아니라 파일로 만들지 않습니다. 아래 계산 조건에서 “내 지갑 이벤트”로 바꾸면 내려받을 수 있습니다."
      : comparingLabel !== null
        ? `지금은 ${comparingLabel} 기준으로 비교 중입니다. 신고 근거자료는 거주국 기준으로만 만듭니다.`
        : null;

  // 셀 것이 없다고 말해놓고 옛 취득 그룹을 금액과 함께 보이면 두 이야기를 한다.
  const groups = result && !hasNothingToCompute ? groupJudgments(result) : [];
  // 부담을 산출하지 않았거나 셀 것이 없는 기간에 신고 기입란 8줄을 0원으로 깔면
  // 요약이 "과세 대상 아님"이라 해놓고 카드는 "예상 부담 ₩0"이라 말하게 된다.
  const showReportCard = result !== undefined && !omitsCharge(result.status) && !hasNothingToCompute;
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

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

      {/* 3. 답 + 신고 기입란 8줄 — 같은 estimate 하나에서 나온다. */}
      {result ? (
        <ReportSummary
          result={result}
          hasNothingToCompute={hasNothingToCompute}
          comparingLabel={comparingLabel}
          onReturnHome={() => { if (homeCountry !== null) setCountry(homeCountry); }}
        />
      ) : null}
      {showReportCard && result ? <ReportCard estimate={result} /> : null}

      {/* 4. 왜 이 금액인가 */}
      {groups.length > 0 && result ? <WhyThisAmount groups={groups} currency={result.currency} /> : null}

      {/* 5. 이 답이 흔들리는 지점 — 셀 것이 없는 기간에는 흔들 답 자체가 없다. */}
      {result && !hasNothingToCompute && result.limitations.length > 0 ? (
        <Limitations limitations={result.limitations} />
      ) : null}

      {/* 6. 판단이 필요한 항목 */}
      {result && result.openQuestions.length > 0 ? <OpenQuestions openQuestions={result.openQuestions} /> : null}

      {/* 7. 확인 필요 넛지 — 신호가 있을 때만. 강제 게이트가 아니다. */}
      {result && nudgeCount > 0 ? (
        <Link
          href="/transactions?tab=review"
          data-surface="review-nudge"
          className="mt-5 flex items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            <span className="font-semibold">확인 필요 {nudgeCount}건</span> · 계산에서 빠진 이벤트를 정리하면 더 정확해져요
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
        </Link>
      ) : null}

      {/* 8. 구독 상태 카드 — 구독 중일 때만. 무엇을 결제했는지가 맨 아래 한 줄에만 있으면 아무도 못 본다.
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
              활성 플랜은 {plan.taxYear}년 귀속입니다 — 지금 보는 연도는 {taxYear}년
            </p>
          )}
        </Card>
      )}

      {/* 9. 내려받기 */}
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

      {/* 10. 과세연도별 결제 — BE 계약(영수증 조회·연도 귀속 검증·스냅샷 보관,
          `docs/be-contract-draft-plan-receipts-snapshots.md`) 전까지는 현재 활성 플랜 1행만 실데이터로 그린다. */}
      {plan !== null && (
        <Card data-surface="plan-payments" className="mt-5">
          <p className="font-semibold text-zinc-900">과세연도별 결제</p>
          <p className="mt-3 text-sm text-zinc-700">
            {plan.taxYear}년 귀속 · {planName} 플랜 · 활성화 {formatDate(plan.activatedAt)}
          </p>
          <p className="mt-3 text-xs text-zinc-400">
            지난 연도 결제 이력과 내보내기 스냅샷 보관은 아직 제공하지 않습니다.
          </p>
        </Card>
      )}

      {/* 11. 세부·설정 (전부 접힘) */}
      <CalcDetails inputs={inputs} />

      {/* 12. 다른 나라였다면 (접힘) */}
      <OtherCountries
        rulesets={rulesets.data ?? []}
        country={country}
        onSelect={setCountry}
        loading={rulesets.isLoading}
      />

      {/* 13. 앵커링 증명 */}
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><MockProvenanceChip /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{formatDateTime(proof.anchored_at)}</dd></div></dl>
        <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>
      </Card>}

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
