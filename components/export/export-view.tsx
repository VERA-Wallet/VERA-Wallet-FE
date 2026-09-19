"use client";

import { ArrowRight, ChevronDown, Link2, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { Provenance } from "@/lib/http/envelope";
import { anchorProofProvider, eventRepository, summaryProvider, taxEngine, taxEvidenceProvider } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import { FILING_LINE_SPECS, buildFilingSummary, createReportLedgerCsv, filingRow } from "@/lib/export/report";
import { buildReportHtml } from "@/lib/export/report-html";
import { createReportXlsx } from "@/lib/export/report-workbook";
import { printReportHtml } from "@/lib/export/print";
import type { SummaryDTO } from "@/lib/http/dto";
import { formatDateTime, formatFiat } from "@/lib/format";
import { isGroundedPeriod, periodFilePart, periodLabel } from "@/lib/period";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { buildEvidenceDocument } from "@/lib/tax/evidence";
import type { EvidenceChainCheck, EvidenceRecord } from "@/lib/ports/tax-evidence";
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
 * 그룹형 리포트 라인. 값도 위계도 지어내지 않는다 — 금액은 `buildFilingSummary(estimate)`에서,
 * 순서·소계·차감은 `FILING_LINE_SPECS`(리포트 빌더)에서 온다. PDF 보고서도 같은 스펙을 읽으므로
 * 룰셋이 줄을 하나 더 내면 화면과 종이가 함께 따라간다.
 *
 * 세율(`note`)만 뺀다. 카드 한 줄이 금액 아닌 값을 말하면 좁은 화면에서 계산 흐름이 끊긴다 —
 * 세율은 아래 "계산 설정"과 PDF 요약표가 대신 말한다.
 */
const REPORT_LINES = FILING_LINE_SPECS.filter((spec) => spec.role !== "note");

/** `provenance`는 앵커 증명 카드용(응답에 출처가 없다). 리포트 카드는 estimate가 실어 온 출처를 쓴다. */
export function ExportView({ countryCode, provenance = "mock" }: { countryCode?: string; provenance?: Provenance } = {}) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [proof, setProof] = useState<Awaited<ReturnType<typeof anchorProofProvider.getProof>>>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 룰셋이 선언한 시행연도(한국 2027). 하드코딩하지 않고 listRuleSets에서 best-effort로 받는다 —
  // 없으면 연도 창은 시행 연도를 끼우지 않을 뿐, 그 밖은 그대로 동작한다.
  const [effectiveYear, setEffectiveYear] = useState<number | undefined>(undefined);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  // 보고서 인쇄는 팝업 차단·인쇄 미지원 브라우저에서 열리지 않을 수 있다. 조용히 아무 일도 안 일어나면
  // 사용자는 자기 탓인지 앱 탓인지 모른다 — 그때만 이 자리에서 다른 내려받기를 권한다.
  const [reportError, setReportError] = useState<string | null>(null);
  // 체인에 봉인한 계산 근거. **어느 연도의 답인지 함께** 들고 있는다 — 연도를 바꿀 때 상태를 비우려고
  // 효과 안에서 setState를 부르면 렌더가 연쇄된다(React Compiler가 막는다). 연도가 다르면 아래에서 안 쓴다.
  const [evidenceEntry, setEvidenceEntry] = useState<{ country: string; taxYear: number; record: EvidenceRecord | null } | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  // 체인을 직접 읽어 대조한 결과. 누르기 전에는 null — 묻지 않은 것을 답인 척 보여 주지 않는다.
  const [chainCheck, setChainCheck] = useState<EvidenceChainCheck | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
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
    const value = filingRow(filing, label)?.금액;
    return typeof value === "number" ? String(value) : "0";
  };

  // 지금 화면이 말하는 계산의 머클루트. 체인에 올라간 루트와 같은지 비교해 "고친 뒤인지"를 판단한다 —
  // 잎마다 keccak을 돌리므로 estimate가 바뀔 때만 다시 센다.
  const currentRoot = useMemo(() => (estimate ? buildEvidenceDocument(estimate).merkleRoot : null), [estimate]);
  // 고른 귀속연도의 기록. 아직 못 읽었거나 다른 해의 답이면 null로 둔다 — 없는 기록을 있다고 말하지 않는다.
  const evidence = evidenceEntry !== null && evidenceEntry.country === country && evidenceEntry.taxYear === selectedYear
    ? evidenceEntry.record
    : null;

  // 기록은 있는데 지금 계산과 루트가 다르면, 기록 뒤에 거래를 고쳤다는 뜻이다.
  const evidenceStale = evidence !== null && currentRoot !== null && evidence.merkleRoot.toLowerCase() !== currentRoot.toLowerCase();

  // 404는 실패가 아니라 "그 해에는 기록이 없다"는 사실이다(어댑터가 null로 번역한다).
  useEffect(() => {
    if (country === null) return;
    let active = true;
    void taxEvidenceProvider
      .latest(country, selectedYear)
      .then((record) => { if (active) setEvidenceEntry({ country, taxYear: selectedYear, record }); })
      .catch(() => { /* 기록 조회 실패가 리포트 전체를 막지는 않는다 — 버튼은 그대로 눌러 볼 수 있다. */ });
    return () => { active = false; };
  }, [country, selectedYear]);

  const recordEvidence = () => {
    if (!estimate || country === null) return;
    setEvidenceBusy(true);
    setEvidenceError(null);
    void taxEvidenceProvider
      .record(buildEvidenceDocument(estimate))
      .then((record) => {
        setEvidenceEntry({ country, taxYear: selectedYear, record });
        // 새로 기록했으면 옛 대조 결과는 다른 루트의 것이다 — 남겨 두면 거짓을 말한다.
        setChainCheck(null);
      })
      .catch((cause: unknown) => setEvidenceError(cause instanceof Error ? cause.message : "계산 근거를 기록하지 못했습니다."))
      .finally(() => setEvidenceBusy(false));
  };

  const checkChain = () => {
    if (!evidence) return;
    setChainBusy(true);
    setEvidenceError(null);
    void taxEvidenceProvider
      .checkChain(evidence.merkleRoot)
      .then((check) => setChainCheck(check))
      .catch((cause: unknown) => setEvidenceError(cause instanceof Error ? cause.message : "체인을 확인하지 못했습니다."))
      .finally(() => setChainBusy(false));
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
  // 유료 플랜(plan !== null)이 있어야 구독으로 본다. 구독 전에는 리포트 금액을 잠그고 배너로 안내한다.
  const subscribed = plan !== null;
  // 요약을 아직 못 읽었으면 잠그지 않는다 — 건수를 모르는 상태의 자물쇠는 근거 없는 자물쇠다.
  const locked = summary !== null && billableCount > allowance;
  // 다운로드 잠금은 두 조건의 OR다: 미구독이면 무조건 잠기고, 구독 중이어도 allowance를 넘으면 잠긴다.
  const downloadLocked = !subscribed || locked;

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
            <ChevronDown aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
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
          <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
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

      {/* 2-c. 플랜 CTA 배너 — 미구독(plan === null)일 때 리포트 위에 띄운다. 금액·다운로드가
          구독 후 열린다는 사실을 자물쇠와 함께 말하고 /plan으로 보낸다. mock 결제라는 사실은
          리포트/다운로드 카드의 기존 mock 배지·문구가 그대로 유지한다. */}
      {estimate && !subscribed && (
        <Link
          href="/plan"
          data-surface="plan-cta"
          className="mt-5 flex items-center justify-between gap-3 rounded-card border border-primary-200 bg-primary-50 p-4"
        >
          <span className="flex items-center gap-3">
            <Lock aria-hidden className="size-5 shrink-0 text-primary-600" strokeWidth={2} />
            <span className="text-sm leading-6 text-zinc-700">
              <span className="block font-semibold text-primary-600">플랜을 구독하면 리포트가 열립니다</span>
              <span className="block text-zinc-600">금액과 다운로드는 구독 후 공개됩니다.</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold text-primary-600">
            플랜 보기
            <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
          </span>
        </Link>
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
            <ProvenanceChip provenance={estimate.provenance} />
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
                  <dt className={`text-sm ${emphasize ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>{line.shortLabel ?? line.source}</dt>
                  <dd
                    className={`tabular-nums ${
                      line.role === "total"
                        ? "text-base font-bold text-primary-600"
                        : emphasize
                          ? "text-sm font-semibold text-zinc-900"
                          : "text-sm text-zinc-700"
                    }`}
                  >
                    {subscribed ? (
                      <>
                        {line.role === "subtract" ? "− " : ""}
                        {formatFiat(filingAmount(line.source), estimate.currency)}
                      </>
                    ) : (
                      // 미구독: 라벨은 그대로 두고 금액만 잠금 플레이스홀더(자물쇠 + 블러 회색 바)로 가린다.
                      <span
                        data-locked="amount"
                        aria-label="구독 후 공개"
                        className="inline-flex select-none items-center gap-1 align-middle"
                      >
                        <Lock aria-hidden className="size-3 shrink-0 text-zinc-400" strokeWidth={2.5} />
                        <span
                          aria-hidden
                          className={`inline-block rounded bg-zinc-200 blur-[2px] ${
                            line.role === "total" ? "h-4 w-20" : "h-3 w-14"
                          }`}
                        />
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {confidenceParts.length > 0 &&
            (subscribed ? (
              <p className="mt-4 inline-flex rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 tabular-nums">
                {confidenceParts.join(" · ")}
              </p>
            ) : (
              // 미구독: 신뢰도 칩도 수치를 가린다 — 신호가 있다는 사실만 남기고 값은 잠근다.
              <p
                data-locked="confidence"
                aria-label="구독 후 공개"
                className="mt-4 inline-flex select-none items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600"
              >
                <Lock aria-hidden className="size-3 shrink-0 text-zinc-400" strokeWidth={2.5} />
                <span aria-hidden className="inline-block h-3 w-16 rounded bg-zinc-200 blur-[2px]" />
              </p>
            ))}
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
          {/* 직접 신고용(추천) — 홈택스 본인 신고. 기입란에 옮겨 적을 값은 아래 보고서가, 근거 원장은 이 CSV가 맡는다. */}
          <div className="rounded-card border border-primary-200 bg-primary-50/40 p-4">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-zinc-900">직접 신고용</p>
              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">추천</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-500">홈택스 본인 신고용 · CSV 원장(거래 부속명세)</p>
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-500 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-locked={downloadLocked ? "download" : undefined}
              disabled={!ready || downloadLocked}
              type="button"
              onClick={() => download(createReportLedgerCsv(events, estimate), "text/csv;charset=utf-8", `verawallet-신고근거-${filenamePeriod}.csv`)}
            >
              {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
              직접 신고용 내려받기
            </button>
          </div>

          {/* 보고서(PDF) — 값만 늘어놓은 격자가 아니라 계산 흐름을 보이는 문서. 한글 PDF를 직접 쓰려면
              글꼴을 통째로 내장해야 해서(수 MB), 조판은 CSS가 하고 PDF 변환은 브라우저 인쇄가 맡는다.
              그래서 이 버튼만 파일을 바로 주지 않고 보고서를 연다 — 그 사실을 버튼 옆에서 미리 말한다. */}
          <div className="rounded-card border border-zinc-200 p-4">
            <p className="font-semibold text-zinc-900">보고서 (PDF)</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              표지 · 신고 요약(기입란) · 자산별 취득가액 명세 · 예외와 한계. 보고서가 열리면 인쇄에서
              &lsquo;PDF로 저장&rsquo;을 고르세요.
            </p>
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-locked={downloadLocked ? "download" : undefined}
              data-surface="report-pdf"
              disabled={!ready || downloadLocked}
              type="button"
              onClick={() => {
                const outcome = printReportHtml(
                  buildReportHtml(
                    events,
                    estimate,
                    {
                      generatedAt: new Date().toISOString(),
                      // 시행 가정으로 보고 있으면 종이에도 그 사실이 함께 가야 한다 — 가정을 뗀 금액은 다른 금액이다.
                      ...(assumeEffective ? { assumeEffective: true, effectiveYear } : {}),
                      // 체인 기록은 **지금 화면의 계산과 같을 때만** 싣는다. 고친 뒤의 종이에 옛 루트를 찍으면
                      // 받는 사람이 대조에 실패하고, 그 실패의 이유를 알 방법이 없다.
                      ...(evidence && !evidenceStale
                        ? {
                            anchor: {
                              merkleRoot: evidence.merkleRoot,
                              txHash: evidence.txHash,
                              anchoredAt: evidence.anchoredAt,
                              explorerUrl: evidence.explorerUrl,
                            },
                          }
                        : {}),
                    },
                    filenamePeriod,
                  ),
                );
                setReportError(
                  outcome === "unavailable"
                    ? "보고서 창을 열지 못했습니다. 팝업 차단을 해제하거나 아래 XLSX로 내려받아 주세요."
                    : null,
                );
              }}
            >
              {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
              보고서 열기
            </button>
            {reportError && <p className="mt-2 text-sm text-red-600">{reportError}</p>}
          </div>

          {/* 세무사 전달용 — XLSX 4시트(요약·자산별·원장·예외). 미리보기 목록을 여기에 흡수한다. */}
          <div className="rounded-card border border-zinc-200 p-4">
            <p className="font-semibold text-zinc-900">세무사 전달용</p>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              XLSX 4시트 · 요약(신고 기입란) · 자산별(취득가액 명세) · 원장(거래 부속명세) · 예외(판단보류·미반영)
            </p>
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-locked={downloadLocked ? "download" : undefined}
              disabled={!ready || !summary || downloadLocked}
              type="button"
              onClick={() => download(createReportXlsx(events, estimate), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-신고근거-${filenamePeriod}.xlsx`)}
            >
              {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
              세무사 전달용 내려받기
            </button>
          </div>
        </div>

        {summary !== null && (
          // 잠기는 것은 다운로드뿐이다 — 위의 기간·건수와 아래 앵커링 증명은 그대로 보인다.
          // 잠기지 않았을 때도 남겨 둔다: 플랜은 탭에 없어서 이 줄이 앱 안의 유일한 진입로다.
          <Link
            href="/plan"
            className={`mt-3 flex items-center justify-between gap-3 rounded-card border p-3 text-sm ${
              downloadLocked ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-600"
            }`}
          >
            <span>
              {`${planName} 플랜 ${allowance.toLocaleString("ko-KR")}건까지 · 현재 ${billableCount.toLocaleString("ko-KR")}건`}
              {downloadLocked && (plan === null ? " — 플랜이 필요합니다" : " — 상위 플랜이 필요합니다")}
            </span>
            <span className={`shrink-0 font-semibold underline ${downloadLocked ? "" : "text-primary-600"}`}>플랜 보기</span>
          </Link>
        )}
      </Card>

      {/* 6. 계산 근거 기록 — OmniOne 체인에 봉인한다.
          체인에 나가는 것은 **머클루트 하나**다: 건별 판정을 잎으로 묶은 해시라, 나중에 거래 한 건만
          골라 "그때 이렇게 판정했다"를 나머지를 보이지 않고 증명할 수 있다.
          루트는 서버가 잎에서 다시 계산한다 — 화면이 준 해시를 그냥 올리면 아무도 재현할 수 없는 값이 남는다. */}
      {estimate && (
        <Card className="mt-5">
          <div data-surface="evidence-anchor" className="flex items-center justify-between gap-3">
            <p className="font-semibold text-zinc-900">계산 근거 기록</p>
            {evidence && !evidenceStale && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-600">
                <ShieldCheck aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
                체인에 기록됨
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {selectedYear}년 귀속 계산을 OmniOne 체인에 봉인합니다. 금액·지갑 주소는 올라가지 않고, 건별 판정을 묶은
            해시(머클루트) 하나만 올라갑니다.
          </p>

          {evidence && (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">머클루트</dt>
                <dd className="text-right font-mono text-xs text-zinc-900">{shortHash(evidence.merkleRoot)}</dd>
              </div>
              {evidence.txHash && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-zinc-500">거래</dt>
                  <dd className="text-right font-mono text-xs text-zinc-900">{shortHash(evidence.txHash)}</dd>
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">봉인한 판정</dt>
                {/* 잎에는 헤더 1개가 함께 들어간다 — 사용자에게는 판정 건수로 말한다. */}
                <dd className="text-right font-medium text-zinc-900">{Math.max(evidence.leafCount - 1, 0)}건</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">기록 시각</dt>
                <dd className="text-right font-medium text-zinc-900">{formatDateTime(evidence.anchoredAt ?? evidence.recordedAt)}</dd>
              </div>
            </dl>
          )}

          {/* 기록 뒤에 거래를 고쳤으면 그 사실을 말한다 — "기록됨" 배지만 남기면 옛 근거를 현재 근거로 읽는다. */}
          {evidenceStale && (
            <p className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              기록한 뒤로 계산이 달라졌습니다. 지금 화면의 근거를 남기려면 다시 기록해 주세요 — 이전 기록은 체인에 그대로 남습니다.
            </p>
          )}

          {evidence?.anchorStatus === "pending" && (
            <p className="mt-4 text-sm leading-6 text-zinc-500">체인에 올리는 중입니다. 잠시 뒤 이 화면을 다시 열면 거래 번호가 표시됩니다.</p>
          )}

          <button
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            data-locked={downloadLocked ? "download" : undefined}
            disabled={!ready || downloadLocked || evidenceBusy || (evidence !== null && !evidenceStale)}
            type="button"
            onClick={recordEvidence}
          >
            {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
            {evidenceBusy ? "기록하는 중…" : evidenceStale ? "다시 기록하기" : evidence ? "기록 완료" : "계산 근거 기록하기"}
          </button>
          {evidenceError && <p className="mt-2 text-sm text-red-600">{evidenceError}</p>}

          {/* 탐색기가 있으면 링크, 없으면 거래 해시 전문. OmniOne 스테이지에는 블록 탐색기가 없어
              사용자가 조회에 쓸 수 있는 값은 이 해시뿐이다 — 누르면 401이 뜨는 링크로 대신하지 않는다. */}
          {evidence?.explorerUrl ? (
            <a
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 underline"
              href={evidence.explorerUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Link2 aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
              체인에서 확인하기
            </a>
          ) : evidence?.txHash ? (
            <div data-surface="evidence-tx" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-medium text-zinc-500">거래 해시 (체인 조회용)</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-800">{evidence.txHash}</p>
            </div>
          ) : null}

          {/* 체인에서 직접 확인. 이 체인에는 블록 탐색기가 없어 사용자가 트랜잭션을 눈으로 볼 수 없다.
              저장된 값을 되읽는 것이 아니라 **지금 체인에 물어** calldata의 해시를 루트와 대조한다. */}
          {evidence && (
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              data-surface="evidence-chain-check"
              disabled={chainBusy}
              type="button"
              onClick={checkChain}
            >
              <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
              {chainBusy ? "체인 확인 중…" : "체인에서 직접 확인"}
            </button>
          )}

          {chainCheck && (
            <div
              data-surface="evidence-chain-result"
              className={`mt-3 rounded-card border p-3 text-sm leading-6 ${
                chainCheck.matches
                  ? "border-primary-200 bg-primary-50/50 text-zinc-700"
                  : chainCheck.readFromChain
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {chainCheck.matches ? (
                <>
                  <p className="font-semibold text-primary-700">체인에 이 근거가 있습니다</p>
                  <p className="mt-1">
                    블록 {chainCheck.blockNumber}의 거래가 실어 나른 해시가 위 머클루트와 같습니다.
                  </p>
                </>
              ) : chainCheck.readFromChain ? (
                <>
                  <p className="font-semibold">체인의 값이 이 근거와 다릅니다</p>
                  <p className="mt-1 break-all">
                    체인의 해시: <span className="font-mono text-xs">{chainCheck.anchoredPayloadHash ?? "읽지 못함"}</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">체인을 읽지 못했습니다</p>
                  {/* 못 읽은 것과 없는 것은 다르다. 없다고 단정하지 않는다. */}
                  <p className="mt-1">기록이 없다는 뜻은 아닙니다. 잠시 뒤 다시 확인해 주세요.</p>
                </>
              )}
              <p className="mt-2 text-xs opacity-70">{formatDateTime(chainCheck.checkedAt)} 확인</p>
            </div>
          )}
        </Card>
      )}

      {/* 7. 앵커링 증명 */}
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><ProvenanceChip provenance={provenance} /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{formatDateTime(proof.anchored_at)}</dd></div></dl>
        {/* 탐색기가 없는 체인에서는 링크를 그리지 않는다 — 누르면 401이 뜨는 버튼은 증명이 아니다. */}
        {proof.explorer_url && <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>}
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
