"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { anchorProofProvider, eventRepository, summaryProvider, taxEngine } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import { buildFilingSummary, createReportLedgerCsv } from "@/lib/export/report";
import { createReportXlsx } from "@/lib/export/report-workbook";
import type { SummaryDTO } from "@/lib/http/dto";
import { formatDateTime, formatFiat } from "@/lib/format";
import { isGroundedPeriod, periodFilePart, periodLabel } from "@/lib/period";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { estimateConfidence } from "@/lib/tax/estimate-summary";
import { canonicalCountryCode } from "@/lib/tax/rulesets";
import { useTaxYear } from "@/lib/tax/tax-year-context";
import type { TaxEstimate } from "@/lib/tax/types";
import { taxYearWindow } from "@/lib/tax/year-window";

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 그룹형 리포트 라인. 값은 `buildFilingSummary(estimate)`에서만 파생한다 — 화면이 룰셋 조건을
 * 다시 쓰면 계산·리포트·화면이 서로 다른 답을 말한다. 여기서는 소계·차감 위계만 정한다.
 */
type ReportLineSpec = { label: string; source: string; role: "item" | "subtract" | "subtotal" | "total" };
const REPORT_LINES: readonly ReportLineSpec[] = [
  { label: "총수입금액", source: "총수입금액", role: "item" },
  { label: "필요경비", source: "필요경비", role: "subtract" },
  { label: "기타소득금액", source: "기타소득금액", role: "subtotal" },
  { label: "기본공제", source: "기본공제", role: "subtract" },
  { label: "과세표준", source: "과세표준", role: "subtotal" },
  { label: "소득세", source: "산출 소득세", role: "item" },
  { label: "개인지방소득세", source: "개인지방소득세", role: "item" },
  { label: "예상 부담", source: "예상 합계 부담", role: "total" },
];

export function ExportView({ countryCode }: { countryCode?: string } = {}) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [proof, setProof] = useState<Awaited<ReturnType<typeof anchorProofProvider.getProof>>>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 룰셋이 선언한 시행연도(한국 2027). 하드코딩하지 않고 listRuleSets에서 best-effort로 받는다 —
  // 없으면 연도 창은 시행 연도를 끼우지 않을 뿐, 그 밖은 그대로 동작한다.
  const [effectiveYear, setEffectiveYear] = useState<number | undefined>(undefined);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  // 시행 전 룰셋(한국 2027)을 "시행됐다고 가정하고" 볼지. 기본은 사실 — 가정은 사용자가 켠다.
  // 세금 화면(tax-simulator)의 assumeEffective와 같은 패턴이다.
  const [assumeEffective, setAssumeEffective] = useState(false);
  const { plan } = usePlan();

  useEffect(() => {
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
  }, []);

  // 리포트를 estimate로 채운다. estimate는 근거자료의 판정·손익을 싣는 보강값이므로,
  // 못 받아도 최상위 오류로 올리지 않는다 — 원장 부속명세는 온체인 값만으로도 만들 수 있다.
  const country = countryCode ? canonicalCountryCode(countryCode) : null;

  // 귀속연도는 전역 단일 소스(TaxYearProvider)에 둔다 — 여기서 바꾸면 대시보드·세금 화면도 같은 해를 본다.
  // 사용자가 아직 고르지 않았을 때의 기본값(fallback)은 예전과 같다: 요약 기간의 시작 연도.
  // 요약을 아직 못 읽었으면 올해로 물러난다(그때는 연도 칩을 그리지 않으므로 화면엔 안 보인다).
  const currentYear = new Date().getFullYear();
  const groundedSummary = summary !== null && isGroundedPeriod(summary.period);
  const fallbackYear = groundedSummary ? new Date(summary.period.from).getUTCFullYear() : currentYear;
  const [selectedYear, selectYear] = useTaxYear(fallbackYear);

  // 시행연도는 룰셋에서 받는다(하드코딩 금지). estimate 경로와 같은 포트를 쓰되 best-effort다 —
  // 못 받아도 연도 창이 시행 연도만 빠질 뿐 나머지는 그대로다.
  useEffect(() => {
    if (country === null) return;
    let active = true;
    void taxEngine
      ?.listRuleSets?.()
      .then((rulesets) => {
        if (!active) return;
        const found = rulesets.find((ruleset) => ruleset.code === country);
        setEffectiveYear(found?.effectiveTaxYear);
      })
      .catch(() => { /* 시행연도를 못 받아도 연도 선택은 데이터·현재연도 창으로 돌아간다. */ });
    return () => { active = false; };
  }, [country]);

  useEffect(() => {
    // 화면이 과세연도를 다시 계산하지 않는다 — 전역 선택(selectedYear)을 그대로 귀속연도로 쓴다.
    // 선택이 바뀌면 이 효과가 다시 돌아 그 해로 estimate를 재요청한다.
    if (!summary || country === null || !isGroundedPeriod(summary.period)) return;
    let active = true;
    void taxEngine
      // 로딩 중에는 이전 estimate를 지우지 않는다 — 성공 시에만 갈아끼워 깜빡임을 줄인다.
      // 시행 가정을 켰으면 그 사실을 요청에 실어 시행 후 규칙(총평균)으로 재계산한다.
      ?.estimate({ country, taxYear: selectedYear, source: "wallet", ...(assumeEffective ? { assumeEffective: true } : {}) })
      .then((next) => { if (active) setEstimate(next); })
      .catch(() => { /* 원장 부속명세는 estimate 없이도 나온다. 조용히 온체인 값만 싣는다. */ });
    return () => { active = false; };
  }, [summary, country, selectedYear, assumeEffective]);

  const ready = summary !== null && !error;
  // 파일명·기간 라벨은 선택 연도를 따른다 — estimate.period가 선택 연도의 과세기간을 싣는다.
  // estimate가 아직 없으면(로딩·미연동) 예전처럼 요약 기간으로 물러난다.
  const activePeriod = estimate?.period ?? summary?.period ?? null;
  const filenamePeriod = activePeriod ? periodFilePart(activePeriod) : "기간";
  // 연도 선택지: 현재연도 인근 + 데이터가 있는 연도(fallback) + 시행연도(2027). 세금 화면과 같은 창.
  const yearOptions = taxYearWindow(currentYear, groundedSummary ? fallbackYear : undefined, effectiveYear);
  // 고른 연도가 시행 전(한국 2027 시행)일 때만 "시행 가정" 토글을 노출한다.
  // 시행연도 이후를 고르면 가정이 아니라 실제라 토글이 필요 없다.
  const canAssumeEffective = effectiveYear !== undefined && selectedYear < effectiveYear;

  // 리포트 라인은 estimate 하나(buildFilingSummary)에서만 파생한다 — 하드코딩하지 않는다.
  const filing = estimate ? buildFilingSummary(estimate) : [];
  const filingAmount = (label: string): string => {
    const value = filing.find((row) => row.기입란 === label)?.금액;
    return typeof value === "number" ? String(value) : "0";
  };

  // 신뢰도 칩·확인 필요 배너는 문구를 지어내지 않고 estimate 구조에서만 파생한다.
  const confidence = estimate ? estimateConfidence(estimate) : null;
  const confidenceParts: string[] = [];
  if (confidence) {
    if (confidence.notReflected > 0) confidenceParts.push(`미반영 ${confidence.notReflected}`);
    if (confidence.zeroBasis > 0) confidenceParts.push(`원가 0원 ${confidence.zeroBasis}`);
    if (confidence.partial) confidenceParts.push("부분집계");
  }

  // 확인 필요 N = 미반영(excludedEventIds) + 원가 0원(zero_basis) 이벤트, 중복은 한 번만 센다.
  const nudgeCount = estimate
    ? new Set<string>([
        ...estimate.excludedEventIds,
        ...estimate.limitations.filter((limitation) => limitation.kind === "zero_basis").flatMap((limitation) => limitation.eventIds),
      ]).size
    : 0;

  // 근거 조문은 룰셋이 lines에 실어 준 basis에서만 모은다. 없으면 그 줄 자체를 생략한다.
  const bases = estimate
    ? [...new Set(estimate.lines.map((line) => line.basis).filter((basis): basis is string => Boolean(basis)))]
    : [];

  // 과금 기준은 계산 대상 이벤트 수다(`SummaryDTO.computableEventCount`) — 화면에 보이는 행 수가 아니다.
  const billableCount = summary?.computableEventCount ?? 0;
  const allowance = exportEventAllowance(plan);
  const planName = plan === null ? "무료" : planDefinition(plan.tier).name;
  // 요약을 아직 못 읽었으면 잠그지 않는다 — 건수를 모르는 상태의 자물쇠는 근거 없는 자물쇠다.
  const locked = summary !== null && billableCount > allowance;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
      {/* 1. 헤더 */}
      <p className="text-sm font-semibold text-primary-500">내보내기 · 신고 근거자료</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">리포트</h1>
        {/* 귀속연도 칩을 탭하면 연도를 고르는 바텀시트가 열린다. 선택은 전역 소스에 써서
            대시보드·세금 화면과 공유한다. 요약(귀속연도의 근거)이 잡히기 전엔 그리지 않는다. */}
        {groundedSummary && (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={yearPickerOpen}
            onClick={() => setYearPickerOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-600"
          >
            <span>{selectedYear}년 귀속</span>
            <span aria-hidden>▾</span>
          </button>
        )}
      </div>
      <p className="mt-3 text-base leading-6 text-zinc-600">확인한 거래로 신고 근거자료를 만들어 저장합니다.</p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {/* 2. 확인 필요 배너(넛지) — 신호가 있을 때만. 강제 게이트가 아니다. */}
      {estimate && nudgeCount > 0 && (
        <Link
          href="/dashboard"
          className="mt-5 flex items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            <span className="font-semibold">확인 필요 {nudgeCount}건</span> · 정리하면 더 정확해져요
          </span>
          <span aria-hidden className="shrink-0 font-semibold">→</span>
        </Link>
      )}

      {/* 2-b. 시행 가정 토글 — 고른 연도가 시행 전일 때만. 켜면 그 사실이 답 옆에 계속 있어야 한다
          (tax-simulator와 같은 원칙). 리포트의 method·근거도 "시행 가정"이라고 함께 말한다. */}
      {estimate && canAssumeEffective && (
        assumeEffective ? (
          <div data-surface="assume-effective" className="mt-5 flex items-start justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm leading-6 text-amber-900">
              <span className="font-semibold">시행 가정으로 보는 중</span> · 아래 리포트는 {selectedYear}년 거래에{" "}
              {effectiveYear}년 시행 규칙(거주자별 총평균법)을 적용했다고 가정한 값이며, 실제 부담이 아닙니다.
            </p>
            <button
              type="button"
              aria-pressed={true}
              onClick={() => setAssumeEffective(false)}
              className="shrink-0 rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-900"
            >
              가정 끄기
            </button>
          </div>
        ) : (
          <div data-surface="assume-effective" className="mt-5 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm leading-6 text-zinc-600">
              {selectedYear}년은 아직 시행 전({effectiveYear}년 시행)이라 실제 부담은 0원입니다. 시행 후 규칙(거주자별
              총평균법)으로 계산하면 얼마인지 미리 볼 수 있습니다.
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
      )}

      {/* 3. 리포트 카드 (그룹형 · estimate 파생) */}
      {estimate && (
        <Card className="mt-5">
          <div data-surface="report-preview" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-zinc-900">기타소득 계산</p>
              {estimate.status === "PARTIAL" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">잠정</span>
              )}
            </div>
            <MockProvenanceChip />
          </div>
          <dl className="mt-4">
            {REPORT_LINES.map((line) => {
              const emphasize = line.role === "subtotal" || line.role === "total";
              return (
                <div
                  key={line.source}
                  className={`flex items-center justify-between gap-3 py-2 ${
                    line.role === "subtotal" ? "border-t border-zinc-200" : line.role === "total" ? "mt-1 border-t-2 border-zinc-300" : ""
                  }`}
                >
                  <dt className={`text-sm ${emphasize ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>{line.label}</dt>
                  <dd
                    className={`tabular-nums ${
                      line.role === "total"
                        ? "text-base font-bold text-primary-600"
                        : emphasize
                          ? "text-sm font-semibold text-zinc-900"
                          : "text-sm text-zinc-700"
                    }`}
                  >
                    {line.role === "subtract" ? "− " : ""}
                    {formatFiat(filingAmount(line.source), estimate.currency)}
                  </dd>
                </div>
              );
            })}
          </dl>
          {confidenceParts.length > 0 && (
            <p className="mt-4 inline-flex rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 tabular-nums">
              {confidenceParts.join(" · ")}
            </p>
          )}
        </Card>
      )}

      {/* 4. 계산 설정 카드 */}
      {estimate && (
        <Card className="mt-5">
          <p className="font-semibold text-zinc-900">계산 설정</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-zinc-500">계산 방식</dt>
              <dd className="text-right font-medium text-zinc-900">{estimate.method}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-zinc-500">통화·국가</dt>
              <dd className="text-right font-medium text-zinc-900">{estimate.currency} · {estimate.countryLabel}</dd>
            </div>
            {bases.length > 0 && (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">근거 조문</dt>
                <dd className="text-right font-medium text-zinc-900">{bases.join(" · ")}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* 5. 용도별 다운로드 */}
      <Card className="mt-5">
        <p className="font-semibold text-zinc-900">내려받기</p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {summary ? `${periodLabel(activePeriod ?? summary.period)} · ${events.length}건` : "거래 내역을 불러오는 중입니다."}
        </p>
        {/* 위 줄의 건수는 파일에 들어갈 행 수다. 과금 건수는 그것과 다를 수 있으므로 기준과 수를 함께 적는다. */}
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          건수는 계산 대상 이벤트 기준입니다{summary ? ` · 현재 ${billableCount.toLocaleString("ko-KR")}건` : ""}.
        </p>

        <div className="mt-5 space-y-3">
          {/* 직접 신고용(추천) — 홈택스 본인 신고. PDF 요약서 생성기가 없어 CSV 원장으로 구성한다. */}
          <div className="rounded-card border border-primary-200 bg-primary-50/40 p-4">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-zinc-900">직접 신고용</p>
              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">추천</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-500">홈택스 본인 신고용 · CSV 원장(거래 부속명세)</p>
            <button
              className="mt-3 w-full rounded-xl bg-primary-500 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!ready || locked}
              type="button"
              onClick={() => download(createReportLedgerCsv(events, estimate), "text/csv;charset=utf-8", `verawallet-신고근거-${filenamePeriod}.csv`)}
            >
              {locked ? "🔒 " : ""}직접 신고용 내려받기
            </button>
          </div>

          {/* 세무사 전달용 — XLSX 4시트(요약·자산별·원장·예외). 미리보기 목록을 여기에 흡수한다. */}
          <div className="rounded-card border border-zinc-200 p-4">
            <p className="font-semibold text-zinc-900">세무사 전달용</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              XLSX 4시트 · 요약(신고 기입란) · 자산별(취득가액 명세) · 원장(거래 부속명세) · 예외(판단보류·미반영)
            </p>
            <button
              className="mt-3 w-full rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!ready || !summary || locked}
              type="button"
              onClick={() => download(createReportXlsx(events, estimate), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-신고근거-${filenamePeriod}.xlsx`)}
            >
              {locked ? "🔒 " : ""}세무사 전달용 내려받기
            </button>
          </div>
        </div>

        {summary !== null && (
          // 잠기는 것은 다운로드뿐이다 — 위의 기간·건수와 아래 앵커링 증명은 그대로 보인다.
          // 잠기지 않았을 때도 남겨 둔다: 플랜은 탭에 없어서 이 줄이 앱 안의 유일한 진입로다.
          <Link
            href="/plan"
            className={`mt-3 flex items-center justify-between gap-3 rounded-card border p-3 text-sm ${
              locked ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-600"
            }`}
          >
            <span>
              {`${planName} 플랜 ${allowance.toLocaleString("ko-KR")}건까지 · 현재 ${billableCount.toLocaleString("ko-KR")}건`}
              {locked && (plan === null ? " — 플랜이 필요합니다" : " — 상위 플랜이 필요합니다")}
            </span>
            <span className={`shrink-0 font-semibold underline ${locked ? "" : "text-primary-600"}`}>플랜 보기</span>
          </Link>
        )}
      </Card>

      {/* 7. 앵커링 증명 */}
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><MockProvenanceChip /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{formatDateTime(proof.anchored_at)}</dd></div></dl>
        <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>
      </Card>}

      {/* 귀속연도 선택 바텀시트. 고른 해는 전역 소스에 써서 estimate를 그 해로 재계산하고,
          대시보드·세금 화면도 같은 해를 본다. 목록은 최근·미래가 위로 오게 내림차순. */}
      <BottomSheet open={yearPickerOpen} onClose={() => setYearPickerOpen(false)} title="귀속연도 선택">
        <h2 className="text-lg font-bold text-zinc-900">귀속연도 선택</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          고른 연도로 리포트를 다시 계산합니다. 시행 전 연도는 정직하게 &ldquo;시행 전&rdquo;으로 표시됩니다.
        </p>
        <ul className="mt-4 grid gap-2">
          {[...yearOptions].reverse().map((year) => {
            const isEffective = effectiveYear !== undefined && year === effectiveYear && year > currentYear;
            return (
              <li key={year}>
                <button
                  type="button"
                  aria-pressed={year === selectedYear}
                  className={`flex w-full items-center justify-between gap-3 rounded-card border px-4 py-3 text-left text-sm font-semibold ${
                    year === selectedYear ? "border-primary-500 bg-primary-50 text-primary-600" : "border-zinc-200 bg-white text-zinc-700"
                  }`}
                  onClick={() => {
                    selectYear(year);
                    setYearPickerOpen(false);
                  }}
                >
                  <span>{year}년 귀속</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {groundedSummary && year === fallbackYear ? (
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
