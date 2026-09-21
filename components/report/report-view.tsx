"use client";

import { ArrowLeft, ArrowRight, Lock, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useTaxEvidence } from "@/components/report/evidence-anchor";
import { useReportContext } from "@/components/report/report-context";
import { Card } from "@/components/ui/card";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import {
  FILING_LINE_SPECS,
  buildAssetCostDetail,
  buildExceptions,
  buildFilingSummary,
  filingConfidenceNote,
  filingRow,
  type FilingLineRole,
  type ReportRow,
} from "@/lib/export/report";
import {
  EXCEPTION_ROW_LIMIT,
  STATUS_BADGE,
  cellText,
  decimalOf,
  generatedAtText,
  groupedAmount,
  groupedCellText,
  quantityText,
  relatedEventIds,
  unitLabel,
} from "@/lib/export/report-format";
import { buildReportHtml, type ReportMeta } from "@/lib/export/report-html";
import { printReportHtml } from "@/lib/export/print";
import { formatFiat } from "@/lib/format";
import { halfOpenPeriodLabel, periodFilePart } from "@/lib/period";
import { ZERO, isNegative, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { ruleNotesOf } from "@/lib/tax/limitations";

/**
 * 신고 근거자료 **보고서의 앱 화면**. 종이(`report-html.ts`)와 같은 estimate·같은 빌더(`report.ts`)에서 값을 읽어
 * 앱 컬럼(모바일 폭) 안에 그린다. 표지 → 신고 요약 → 자산별 명세 → 예외 → 근거와 한계, 순서도 종이와 같다.
 *
 * 종이는 A4 한 장을 전제로 조판돼 폰에서 열면 축소된 종이 사진이 된다. 앱 화면은 같은 내용을 카드로 세워
 * 손가락으로 읽게 하고, PDF가 필요할 때만 기존 인쇄 경로(`print.ts`)로 넘긴다. 두 문서는 값이 같아야 하므로
 * 여기서 룰셋 조건이나 위계를 다시 쓰지 않는다.
 *
 * estimate·원장·요약·귀속연도·시행 가정은 리포트 한 벌이 공유하는 context에서 읽는다(`app/export/layout.tsx`).
 * 여기서 따로 계산하면 메인이 말한 금액과 보고서의 금액이 갈릴 수 있다.
 */

const ROLE_ROW_CLASS: Record<FilingLineRole, string> = {
  item: "py-2.5",
  subtract: "py-2.5",
  subtotal: "border-t border-zinc-200 py-2.5",
  note: "border-t border-dashed border-zinc-200 py-2",
  total: "mt-1 border-t-2 border-zinc-900 py-3",
};

const ROLE_LABEL_CLASS: Record<FilingLineRole, string> = {
  item: "text-sm text-zinc-700",
  subtract: "text-sm text-zinc-500",
  subtotal: "text-sm font-semibold text-zinc-900",
  note: "text-xs text-zinc-500",
  total: "text-base font-bold text-zinc-900",
};

const ROLE_AMOUNT_CLASS: Record<FilingLineRole, string> = {
  item: "text-sm text-zinc-900",
  subtract: "text-sm text-zinc-500",
  subtotal: "text-sm font-semibold text-zinc-900",
  note: "text-xs text-zinc-500",
  total: "text-lg font-bold text-primary-600",
};

/** 자산별 명세 표의 합계. 화면에 실제로 그린 행을 그대로 더한다(종이와 같은 규칙). */
function columnTotal(rows: readonly ReportRow[], key: string): Decimal {
  return sum(rows.map((row) => (typeof row[key] === "number" ? decimalOf(row[key] as number) ?? ZERO : ZERO)));
}

function MetaItem({ term, children, mono = false }: { term: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{term}</dt>
      <dd className={`mt-0.5 ${mono ? "break-all font-mono text-xs text-zinc-900" : "wrap-anywhere font-medium text-zinc-900"}`}>{children}</dd>
    </div>
  );
}

function AssetFigure({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm tabular-nums ${negative ? "text-red-700" : "text-zinc-900"}`}>{value}</dd>
    </div>
  );
}

export function ReportView() {
  const {
    result,
    freshEstimate,
    events,
    summary,
    ledgerError,
    ready,
    downloadLocked,
    blockedReason,
    assumeEffective,
    effectiveTaxYear,
  } = useReportContext();
  const { evidence, stale: evidenceStale } = useTaxEvidence();
  const [printError, setPrintError] = useState<string | null>(null);

  const estimate = result ?? null;
  // 화면이 말하는 "작성 시각". 서버 렌더에는 시계가 없으므로 estimate가 준비된 순간 클라이언트에서 찍는다.
  const viewedAt = useMemo(() => (estimate ? new Date().toISOString() : null), [estimate]);

  // 파생값: 전부 estimate 하나에서만 읽는다.
  const filing = useMemo(() => (estimate ? buildFilingSummary(estimate) : []), [estimate]);
  const assetRows = useMemo(() => (estimate ? buildAssetCostDetail(estimate) : []), [estimate]);
  const exceptionRows = useMemo(() => (estimate ? buildExceptions(events, estimate) : []), [events, estimate]);
  // 원장 경고는 notes와 limitations에 같은 문구로 온다. 3절이 이미 실었으므로 메모에는 규칙 설명만 남긴다.
  const ruleNotes = useMemo(() => (estimate ? ruleNotesOf(estimate.notes, estimate.limitations) : []), [estimate]);
  const wallets = useMemo(() => [...new Set(events.map((event) => event.wallet_address.toLowerCase()))].sort(), [events]);
  const bases = estimate
    ? [...new Set(estimate.lines.map((line) => line.basis).filter((basis): basis is string => Boolean(basis)))]
    : [];
  // 기록 뒤에 거래를 고쳤으면 그 루트는 지금 보고서의 근거가 아니다. 종이에도 화면에도 싣지 않는다.
  const anchor = evidence && !evidenceStale
    ? { merkleRoot: evidence.merkleRoot, txHash: evidence.txHash, anchoredAt: evidence.anchoredAt, explorerUrl: evidence.explorerUrl }
    : null;

  const activePeriod = estimate?.period ?? summary?.period ?? null;
  const filenamePeriod = activePeriod ? periodFilePart(activePeriod) : "기간";
  const currency = estimate?.currency ?? summary?.currency ?? "KRW";
  const badge = estimate ? STATUS_BADGE[estimate.status] : null;
  const headlineRow = filingRow(filing, "예상 합계 부담");
  const hasIncome = estimate ? estimate.judgments.some((row) => row.amountKind === "fmv" && row.group === "income") : false;

  // 원장·요약이 왔고 계산이 답하거나 실패로 끝났을 때 보고서를 그린다. 계산 중에는 반쪽 문서를 만들지 않는다.
  const loading = freshEstimate.state === "pending";
  const reportReady = ready && !loading;

  const reportMeta = (generatedAt: string): ReportMeta => ({
    generatedAt,
    ...(assumeEffective ? { assumeEffective: true, effectiveYear: effectiveTaxYear } : {}),
    ...(anchor ? { anchor } : {}),
  });

  // 클릭 핸들러에서 **동기로** 인쇄를 연다. 팝업 허용은 사용자 제스처에 붙어 있어 await 뒤에서는 막힌다.
  const print = () => {
    const outcome = printReportHtml(buildReportHtml(events, estimate, reportMeta(new Date().toISOString()), filenamePeriod));
    setPrintError(outcome === "unavailable" ? "인쇄 창을 열지 못했습니다. 팝업 차단을 해제하거나 리포트에서 XLSX로 내려받아 주세요." : null);
  };

  const printButton = (
    <button
      type="button"
      data-surface="report-pdf"
      disabled={!reportReady}
      onClick={print}
      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Printer aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
      PDF로 저장
    </button>
  );

  const header = (
    <>
      <Link href="/export" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-zinc-500">
        <ArrowLeft aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
        리포트
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-primary-500">리포트 · 보고서</p>
        {estimate && <ProvenanceChip provenance={estimate.provenance} />}
      </div>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">기타소득 신고 근거자료</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-base leading-6 text-zinc-600">
          {estimate ? `${estimate.taxYear}년 귀속 · ${estimate.countryLabel} · ${estimate.method}` : "계산 결과 없음"}
        </p>
        {badge && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              badge.tone === "ok" ? "bg-primary-50 text-primary-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            {badge.label}
          </span>
        )}
      </div>
    </>
  );

  if (downloadLocked) {
    return (
      <main data-surface="report-view" className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
        {header}
        <Card className="mt-5">
          <div className="flex items-center gap-2">
            <Lock aria-hidden className="size-5 shrink-0 text-primary-600" strokeWidth={2} />
            <p className="font-semibold text-primary-600">플랜을 구독하면 보고서가 열립니다</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-600">신고 요약·자산별 명세·예외 목록과 PDF 저장은 구독 후 공개됩니다.</p>
          <Link href="/plan" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary-600">
            플랜 보기
            <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
          </Link>
        </Card>
      </main>
    );
  }

  // 데모 시나리오·비교 중·지갑 미연결은 내 지갑의 계산이 아니다. 파일과 같은 이유로 보고서도 만들지 않는다.
  if (blockedReason !== null) {
    return (
      <main data-surface="report-view" className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
        {header}
        <p data-surface="report-blocked" className="mt-5 rounded-card border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
          {blockedReason}
        </p>
      </main>
    );
  }

  return (
    <main data-surface="report-view" className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
      {header}
      {ledgerError && <p className="mt-3 text-sm wrap-anywhere text-red-600">{ledgerError}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-5 text-zinc-500">인쇄에서 &lsquo;PDF로 저장&rsquo;을 고르면 이 보고서가 파일이 됩니다.</p>
        {printButton}
      </div>
      {printError && <p className="mt-2 text-sm text-red-600">{printError}</p>}

      {summary === null && !ledgerError && <p className="mt-5 text-sm text-zinc-500">보고서를 만드는 중…</p>}
      {summary !== null && loading && <p className="mt-5 text-sm text-zinc-500">계산을 불러오는 중…</p>}

      {reportReady && (
        <>
          {/* 표지. 이 문서가 무엇에 대한 것인지. */}
          <Card className="mt-5">
            <p className="font-semibold text-zinc-900">표지</p>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <MetaItem term="과세기간">{activePeriod ? halfOpenPeriodLabel(activePeriod) : "기간 미정"}</MetaItem>
                <MetaItem term="거래 건수">{events.length.toLocaleString("ko-KR")}건</MetaItem>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MetaItem term="작성 시각">{viewedAt ? generatedAtText(viewedAt) : "-"}</MetaItem>
                <MetaItem term="계산 신뢰도">{estimate ? filingConfidenceNote(estimate) : "-"}</MetaItem>
              </div>
              <MetaItem term="대상 지갑" mono>
                {wallets.length === 0 ? "-" : wallets.map((address) => <span key={address} className="block">{address}</span>)}
              </MetaItem>
              {anchor && <MetaItem term="계산 근거 머클루트" mono>{anchor.merkleRoot}</MetaItem>}
            </dl>
          </Card>

          {/* 결론. 보고서를 펼친 사람이 가장 먼저 찾는 숫자. */}
          {estimate ? (
            <section data-surface="report-headline" className="mt-5 rounded-card border border-primary-200 bg-primary-50/50 p-5">
              <p className="text-xs font-semibold text-primary-600">예상 합계 부담</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">{cellText(headlineRow?.금액, currency)}</p>
              <p className="mt-1 text-sm wrap-anywhere text-zinc-600">{String(headlineRow?.근거 ?? "산출 소득세 + 개인지방소득세")}</p>
              {assumeEffective && (
                <p className="mt-3 border-t border-dashed border-primary-200 pt-3 text-sm leading-6 text-amber-900">
                  시행 가정: {estimate.taxYear}년 거래에 {effectiveTaxYear ?? ""}년 시행 규칙({estimate.method})을 적용했다고{" "}
                  <strong>가정한</strong> 금액이며, 현재 확정된 실제 부담이 아닙니다.
                </p>
              )}
            </section>
          ) : (
            <section data-surface="report-headline" className="mt-5 rounded-card border border-zinc-200 bg-zinc-50 p-5">
              <p className="text-xs font-semibold text-zinc-500">계산 결과</p>
              <p className="mt-1 text-2xl font-bold text-zinc-900">계산할 거래 없음</p>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                가격·분류를 확정한 거래가 없어 신고 금액을 내지 못했습니다. 리포트의 거래 원장(CSV·XLSX)으로 확인해 주세요.
              </p>
            </section>
          )}

          {estimate && (
            <>
              {/* 1. 신고 요약. 종이와 같은 위계(FILING_LINE_SPECS). 세율 줄도 종이처럼 남긴다. */}
              <Card className="mt-5">
                <p className="font-semibold text-zinc-900">1. 신고 요약</p>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  종합소득세 신고 별지 제40호서식(6)의 기입란과 1:1로 대응합니다. 금액은 아래 자산별 명세와 거래 원장에서 집계한 값입니다.
                </p>
                <dl className="mt-3">
                  {FILING_LINE_SPECS.map((spec) => {
                    const row = filingRow(filing, spec.source);
                    // 룰셋이 내지 않은 줄은 0원으로 지어내지 않고 그 줄 자체를 뺀다.
                    if (row === undefined) return null;
                    const label = spec.role === "subtract" ? `(−) ${spec.source}` : spec.source;
                    return (
                      <div key={spec.source} className={`flex items-start justify-between gap-3 ${ROLE_ROW_CLASS[spec.role]}`}>
                        <dt className="min-w-0">
                          <span className={ROLE_LABEL_CLASS[spec.role]}>{label}</span>
                          {row.근거 !== undefined && String(row.근거).length > 0 && (
                            <span className="block text-xs wrap-anywhere text-zinc-400">{String(row.근거)}</span>
                          )}
                        </dt>
                        <dd className={`shrink-0 text-right tabular-nums ${ROLE_AMOUNT_CLASS[spec.role]}`}>{cellText(row.금액, currency)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </Card>

              {/* 2. 자산별 취득가액 명세. 표 11칸은 폰 폭에 들어가지 않는다. 자산 하나를 카드 하나로 세운다. */}
              <Card className="mt-5">
                <p className="font-semibold text-zinc-900">2. 자산별 취득가액 명세</p>
                {assetRows.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">취득·양도 기록이 있는 자산이 없습니다.</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      {estimate.method}으로 산정했습니다. 총평균단가는 계산에 실제로 적용된 단가이며, 의제취득가액이 적용된 자산은 실제
                      취득단가보다 높습니다. 금액 단위: {unitLabel(currency)}.
                    </p>
                    <ul className="mt-3 space-y-3">
                      {assetRows.map((row) => {
                        const deemed = String(row.의제취득가액적용여부) === "적용";
                        const gain = typeof row.손익 === "number" ? row.손익 : 0;
                        return (
                          <li key={String(row.자산)} className="rounded-card border border-zinc-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="min-w-0 wrap-anywhere font-semibold text-zinc-900">{String(row.자산)}</p>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${deemed ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
                                의제취득가액 {deemed ? "적용" : "미적용"}
                              </span>
                            </div>
                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                              <AssetFigure label="기초 수량" value={quantityText(row.기초수량)} />
                              <AssetFigure label="기초 가액" value={groupedCellText(row.기초가액)} />
                              <AssetFigure label="당기 취득 수량" value={quantityText(row.당기취득수량)} />
                              <AssetFigure label="당기 취득 가액" value={groupedCellText(row.당기취득가액)} />
                              <AssetFigure label="총평균단가" value={groupedCellText(row.총평균단가)} />
                              <AssetFigure label="당기 양도 수량" value={quantityText(row.당기양도수량)} />
                              <AssetFigure label="적용취득가액" value={groupedCellText(row.적용취득가액)} />
                              <AssetFigure label="양도가액" value={groupedCellText(row.양도가액)} />
                            </dl>
                            <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2">
                              <span className="text-sm font-semibold text-zinc-900">손익</span>
                              <span className={`text-sm font-bold tabular-nums ${gain < 0 ? "text-red-700" : "text-zinc-900"}`}>{groupedCellText(row.손익)}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {/* 합계는 위에 그린 행을 그대로 더한 값이다. estimate의 다른 합을 가져오면 표와 합계가 어긋난다. */}
                    <dl className="mt-3 divide-y divide-zinc-100 border-y border-zinc-100 text-sm">
                      {(
                        [
                          ["기초가액 합계", "기초가액"],
                          ["당기취득가액 합계", "당기취득가액"],
                          ["적용취득가액 합계", "적용취득가액"],
                          ["양도가액 합계", "양도가액"],
                        ] as const
                      ).map(([label, key]) => (
                        <div key={key} className="flex items-center justify-between gap-3 py-2">
                          <dt className="text-zinc-600">{label}</dt>
                          <dd className="font-semibold text-zinc-900 tabular-nums">{groupedAmount(columnTotal(assetRows, key))}</dd>
                        </div>
                      ))}
                      {(() => {
                        const totalGain = columnTotal(assetRows, "손익");
                        return (
                          <div className="flex items-center justify-between gap-3 py-2">
                            <dt className="font-semibold text-zinc-900">손익 합계</dt>
                            <dd className={`font-bold tabular-nums ${isNegative(totalGain) ? "text-red-700" : "text-zinc-900"}`}>{groupedAmount(totalGain)}</dd>
                          </div>
                        );
                      })()}
                    </dl>
                    {hasIncome && (
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        이 합계는 <strong>자산 처분분</strong>만 더한 값입니다. 대여대가·에어드랍 등 수령 소득은 위 신고 요약의 총수입금액에 함께 들어가 있습니다.
                      </p>
                    )}
                  </>
                )}
              </Card>

              {/* 3. 예외·판단보류. 계산이 무엇을 못 했는지. 비어 있으면 비어 있다고 말한다. */}
              <Card className="mt-5">
                <p className="font-semibold text-zinc-900">3. 예외 · 판단보류</p>
                {exceptionRows.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">계산에서 제외되었거나 판단을 보류한 항목이 없습니다.</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      계산이 확정하지 못한 항목입니다. 금액영향은 관련 거래의 가액 합이며, 가격을 모르는 거래가 섞이면 비워 둡니다.
                    </p>
                    <ul className="mt-2 divide-y divide-zinc-100">
                      {exceptionRows.slice(0, EXCEPTION_ROW_LIMIT).map((row, index) => {
                        const related = relatedEventIds(row.관련이벤트);
                        const impact = typeof row.금액영향_원 === "number"
                          ? formatFiat(decimalOf(row.금액영향_원) ?? "0", currency)
                          : String(row.금액영향_원 ?? "-");
                        return (
                          <li key={`${String(row.구분)}-${index}`} className="py-3">
                            <div className="flex items-start justify-between gap-3">
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">{String(row.구분)}</span>
                              <span className="shrink-0 text-sm font-semibold text-zinc-900 tabular-nums">{impact}</span>
                            </div>
                            {/* 문구에 주소·해시 같은 긴 토큰이 남아도 카드 안에서 꺾인다. */}
                            <p className="mt-1.5 text-sm leading-6 wrap-anywhere text-zinc-700">{String(row.내용)}</p>
                            {/* 빌더가 id를 붙이지 않은 행(건수만 문장에 있는 근사 계산)은 "0건"이라고 말하지 않는다. */}
                            {related.length > 0 && (
                              <p className="mt-1 text-xs text-zinc-500">관련 거래 {related.length.toLocaleString("ko-KR")}건</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {exceptionRows.length > EXCEPTION_ROW_LIMIT
                        ? `예외 ${exceptionRows.length.toLocaleString("ko-KR")}건 중 ${EXCEPTION_ROW_LIMIT}건을 실었습니다. 나머지와 `
                        : "관련 거래의 "}
                      전체 목록은 리포트의 XLSX <strong>예외</strong> 시트와 CSV 거래 원장에 있습니다.
                    </p>
                  </>
                )}
              </Card>
            </>
          )}

          {/* 4. 계산 근거와 한계. 이 문서만 보고 과세를 확정하지 않도록. */}
          <Card className="mt-5">
            <p className="font-semibold text-zinc-900">{estimate ? "4. " : ""}계산 근거와 한계</p>
            <dl className="mt-3 space-y-3 text-sm">
              {estimate && (
                <div className="grid grid-cols-2 gap-3">
                  <MetaItem term="적용 룰셋">{estimate.countryLabel} · {estimate.taxYear}년 귀속</MetaItem>
                  <MetaItem term="취득가액 산정">{estimate.method}</MetaItem>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {estimate && <MetaItem term="표시 통화">{estimate.currency}</MetaItem>}
                <MetaItem term="원장 행 수">{events.length.toLocaleString("ko-KR")}건</MetaItem>
              </div>
              {bases.length > 0 && <MetaItem term="근거 조문">{bases.join(" · ")}</MetaItem>}
            </dl>

            {anchor && (
              <section data-surface="report-anchor" className="mt-4 rounded-card border border-primary-200 bg-primary-50/50 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden className="size-5 shrink-0 text-primary-600" strokeWidth={2.5} />
                  <p className="font-semibold text-zinc-900">OmniOne 체인 기록</p>
                </div>
                <dl className="mt-3 space-y-3 text-sm">
                  <MetaItem term="머클루트" mono>{anchor.merkleRoot}</MetaItem>
                  {anchor.txHash && <MetaItem term="거래 해시" mono>{anchor.txHash}</MetaItem>}
                  {anchor.anchoredAt && <MetaItem term="기록 시각">{generatedAtText(anchor.anchoredAt)}</MetaItem>}
                </dl>
                <p className="mt-3 text-xs leading-5 text-zinc-600">
                  머클루트는 건별 판정을 잎으로 묶은 해시입니다. 체인에는 이 해시만 올라가며 금액·지갑 주소는 올라가지 않습니다.
                </p>
                <Link href={`/export/evidence/${anchor.merkleRoot}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-600">
                  체인에서 직접 확인
                  <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                </Link>
              </section>
            )}

            {estimate && estimate.requiredInputs.length > 0 && (
              <>
                <p className="mt-4 text-sm font-semibold text-zinc-800">지갑 밖에서 확인이 필요한 입력</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 wrap-anywhere text-zinc-700">
                  {estimate.requiredInputs.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </>
            )}
            {estimate && ruleNotes.length > 0 && (
              <>
                <p className="mt-4 text-sm font-semibold text-zinc-800">계산 메모</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 wrap-anywhere text-zinc-700">
                  {ruleNotes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </>
            )}
            <p className="mt-4 rounded-card border-l-4 border-amber-400 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              <strong>이 리포트는 계산 보조용이며 확정 판단이 아닙니다.</strong> 거주국 룰셋·의제취득가액·거래소 보유분 등에 따라 실제 신고 값은
              달라질 수 있습니다. 신고 전 세무 전문가의 확인을 권합니다.
            </p>
          </Card>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-zinc-500">같은 내용을 A4로 조판한 문서를 인쇄합니다.</p>
            {printButton}
          </div>
        </>
      )}
    </main>
  );
}
