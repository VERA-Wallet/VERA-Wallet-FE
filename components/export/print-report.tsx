"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { eventRepository, summaryProvider, taxEngine } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import {
  buildAssetCostDetail,
  buildExceptions,
  buildFilingSummary,
  buildLedgerDetail,
  filingConfidenceNote,
  type ReportRow,
} from "@/lib/export/report";
import {
  PRINT_ASSET_COLUMNS,
  PRINT_EXCEPTION_COLUMNS,
  PRINT_FILING_COLUMNS,
  PRINT_LEDGER_COLUMNS,
  headerLabel,
  isNowrapColumn,
  isNumericColumn,
} from "@/lib/export/print-layout";
import type { SummaryDTO } from "@/lib/http/dto";
import { formatDateTime } from "@/lib/format";
import { periodLabel } from "@/lib/period";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { canonicalCountryCode } from "@/lib/tax/rulesets";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 인쇄용 신고근거 보고서.
 *
 * PDF 라이브러리를 쓰지 않는 이유는 한글이다. 이 앱은 폰트 파일을 self-host하지 않고
 * `globals.css`가 Pretendard를 이름으로만 부른 뒤 OS 폰트로 물러난다. jsPDF·react-pdf는
 * 한글을 그리려면 TTF를 번들에 실어야 해서, 폰트 자산이 0개인 앱에 1~2MB짜리 부류가 새로 생긴다.
 * 브라우저 인쇄는 화면과 **같은 폰트**를 쓰므로 한글이 깨질 일이 없고 새 의존성도 없다.
 *
 * 값은 전부 `report.ts`의 빌더에서 온다 — XLSX·CSV와 같은 소스다. 화면이 금액을 다시 계산하면
 * 같은 신고에 대해 파일과 인쇄물이 다른 숫자를 말하게 된다.
 *
 * 귀속연도·시행가정은 URL 쿼리로 받는다. 인쇄는 새 창에서 열리는데 과세연도는 메모리 컨텍스트라
 * 새 창이 그 선택을 물려받지 못한다 — 주소에 실어야 "화면에서 보던 그 해"가 그대로 인쇄된다.
 */
export function PrintReport({ countryCode, taxYear, assumeEffective }: { countryCode?: string; taxYear: number; assumeEffective: boolean }) {
  const [events, setEvents] = useState<NormalizedEvent[] | null>(null);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const country = countryCode ? canonicalCountryCode(countryCode) : null;

  useEffect(() => {
    let active = true;
    void Promise.all([collectAllEvents(eventRepository), summaryProvider.getSummary()])
      .then(([items, nextSummary]) => {
        if (!active) return;
        setEvents(items.map(({ event }) => event));
        setSummary(nextSummary);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "보고서 데이터를 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (country === null) return;
    let active = true;
    void taxEngine
      ?.estimate({ country, taxYear, source: "wallet", ...(assumeEffective ? { assumeEffective: true } : {}) })
      .then((next) => { if (active) setEstimate(next); })
      .catch(() => { /* estimate 없이도 원장 부속명세는 만든다 — 화면 표와 같은 태도다. */ });
    return () => { active = false; };
  }, [country, taxYear, assumeEffective]);

  const ready = events !== null && summary !== null;

  const filing = useMemo(() => (estimate ? buildFilingSummary(estimate) : []), [estimate]);
  const assets = useMemo(() => (estimate ? buildAssetCostDetail(estimate) : []), [estimate]);
  const ledger = useMemo(() => (events ? buildLedgerDetail(events, estimate) : []), [events, estimate]);
  const exceptions = useMemo(() => (events ? buildExceptions(events, estimate) : []), [events, estimate]);

  // 인쇄 대화상자는 표가 다 그려진 뒤에 연다. 먼저 열면 브라우저가 빈 문서를 스냅샷한다.
  // 한 번만 연다 — 취소한 사용자에게 다시 들이밀지 않는다(위 버튼으로 다시 열 수 있다).
  // "열었다"는 사실은 ref에 둔다. state로 두면 렌더를 한 번 더 돌릴 뿐이고 화면에 쓰이지도 않는다.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!ready || openedRef.current) return;
    openedRef.current = true;
    // 레이아웃이 확정된 뒤로 미룬다.
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const period = estimate?.period ?? summary?.period ?? null;

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:px-0 print:py-0" data-surface="print-report">
      {/* 인쇄물에는 남지 않는 조작 줄. */}
      <div data-print-hide className="mb-6 flex items-center gap-2 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
        <span className="flex-1">
          {ready ? "인쇄 대화상자에서 대상을 “PDF로 저장”으로 고르세요." : "보고서를 준비하는 중입니다…"}
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => window.print()}
          className="rounded-xl bg-primary-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <header className="border-b-2 border-zinc-900 pb-4">
        <p className="text-sm font-semibold text-zinc-500">VeraWallet</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-900">가상자산 신고근거 보고서</h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Field label="귀속연도" value={`${taxYear}년${assumeEffective ? " (시행 가정)" : ""}`} />
          <Field label="과세기간" value={period ? periodLabel(period) : "—"} />
          <Field label="거주국 룰셋" value={country ?? "—"} />
          <Field label="거래 건수" value={events ? `${events.length.toLocaleString("ko-KR")}건` : "—"} />
          <Field label="작성 시각" value={formatDateTime(new Date().toISOString())} />
          <Field label="자료 출처" value={estimate?.provenance === "live" ? "온체인 인덱싱" : "mock 데이터"} />
        </dl>
      </header>

      {estimate ? (
        <p className="mt-4 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700 print:bg-transparent">
          {filingConfidenceNote(estimate)}
        </p>
      ) : null}

      <Section title="1. 신고 요약" note="아래 금액은 신고 기입란에 대응합니다.">
        <ReportTable columns={PRINT_FILING_COLUMNS} rows={filing} empty="계산된 신고 금액이 없습니다." />
      </Section>

      <Section title="2. 자산별 취득가액 명세" note="열을 줄여 실었습니다 — 기초수량·기초가액·의제취득가액 적용여부를 포함한 전체 11열은 XLSX 「자산별」 시트에 있습니다.">
        <ReportTable columns={PRINT_ASSET_COLUMNS} rows={assets} empty="자산별 명세가 없습니다." />
      </Section>

      <Section title="3. 거래 부속명세" note="열을 줄여 실었습니다 — 트랜잭션 해시·체인·가격출처를 포함한 전체 36열은 XLSX 「원장」 시트에 있습니다.">
        <ReportTable columns={PRINT_LEDGER_COLUMNS} rows={ledger} empty="거래가 없습니다." />
      </Section>

      <Section title="4. 예외 · 계산 한계" note="계산이 하지 못한 일입니다. 이 목록을 확인해야 금액을 신고에 쓸 수 있습니다.">
        <ReportTable columns={PRINT_EXCEPTION_COLUMNS} rows={exceptions} empty="기록된 예외가 없습니다." />
      </Section>

      <footer className="mt-8 border-t border-zinc-300 pt-3 text-xs leading-5 text-zinc-500">
        본 보고서는 온체인 거래 내역을 정리·분류하는 계산 보조 자료이며, 세무 대리 또는 세무 상담을 제공하지 않습니다.
        산출된 결과는 참고용이며, 실제 신고는 세무 전문가의 검토를 거치시기 바랍니다.
      </footer>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  // break-inside-avoid를 섹션 전체에 걸면 긴 원장이 통째로 다음 장으로 밀려 첫 장이 빈다.
  // 제목+안내만 묶어 두고(고아 제목 방지) 표는 자연스럽게 쪽을 넘게 둔다.
  return (
    <section className="mt-8">
      <div className="break-inside-avoid">
        <h2 className="text-base font-bold text-zinc-900">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{note}</p>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ReportTable({ columns, rows, empty }: { columns: readonly string[]; rows: readonly ReportRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        {/* 표가 쪽을 넘으면 머리글을 다음 장에도 다시 그린다(브라우저 기본 동작). */}
        <tr>
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              className={`border-b border-zinc-400 py-1.5 pr-2 font-semibold whitespace-nowrap text-zinc-700 ${isNumericColumn(column) ? "text-right" : "text-left"}`}
            >
              {headerLabel(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="break-inside-avoid border-b border-zinc-200">
            {columns.map((column) => {
              const value = row[column];
              return (
                <td
                  key={column}
                  // 긴 16진 id는 `anywhere`로만 접힌다. 그대로 두면 그 열이 표 폭을 독차지해 옆 열을 세로로 뭉갠다.
                  className={`py-1 pr-2 align-top text-zinc-800 ${
                    isNumericColumn(column)
                      ? "whitespace-nowrap text-right tabular-nums"
                      : isNowrapColumn(column)
                        ? "whitespace-nowrap text-left"
                        : "text-left [overflow-wrap:anywhere]"
                  }`}
                >
                  {value === undefined || value === "" ? "—" : typeof value === "number" ? value.toLocaleString("ko-KR") : value}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
