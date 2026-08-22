"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { anchorProofProvider, eventRepository, summaryProvider, taxEngine } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import { createReportLedgerCsv } from "@/lib/export/report";
import { createReportXlsx } from "@/lib/export/report-workbook";
import type { SummaryDTO } from "@/lib/http/dto";
import { formatDateTime, formatFiat } from "@/lib/format";
import { isGroundedPeriod, periodFilePart, periodLabel } from "@/lib/period";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { estimateConfidence, estimateHeadline } from "@/lib/tax/estimate-summary";
import { canonicalCountryCode } from "@/lib/tax/rulesets";
import type { TaxEstimate } from "@/lib/tax/types";

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

export function ExportView({ countryCode }: { countryCode?: string } = {}) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [proof, setProof] = useState<Awaited<ReturnType<typeof anchorProofProvider.getProof>>>(null);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  useEffect(() => {
    // 과세연도는 화면이 다시 계산하지 않는다 — 요약 기간의 시작 연도를 그대로 귀속연도로 쓴다.
    if (!summary || country === null || !isGroundedPeriod(summary.period)) return;
    const taxYear = new Date(summary.period.from).getUTCFullYear();
    let active = true;
    void taxEngine
      ?.estimate({ country, taxYear, source: "wallet" })
      .then((next) => { if (active) setEstimate(next); })
      .catch(() => { /* 원장 부속명세는 estimate 없이도 나온다. 조용히 온체인 값만 싣는다. */ });
    return () => { active = false; };
  }, [summary, country]);

  const ready = summary !== null && !error;
  const filenamePeriod = summary ? periodFilePart(summary.period) : "기간";
  // estimate 기반 미리보기 — 파일에 들어갈 손익·부담·신뢰도를 내려받기 전에 보여 준다.
  const headline = estimate ? estimateHeadline(estimate) : null;
  const confidence = estimate ? estimateConfidence(estimate) : null;

  // 과금 기준은 계산 대상 이벤트 수다(`SummaryDTO.computableEventCount`) — 화면에 보이는 행 수가 아니다.
  // 스팸 토큰 제외는 아직 요약이 말해 주지 않는다. `ignored` 같은 필드가 생기면 이 수에서 빼야 한다.
  const billableCount = summary?.computableEventCount ?? 0;
  const allowance = exportEventAllowance(plan);
  const planName = plan === null ? "무료" : planDefinition(plan.tier).name;
  // 요약을 아직 못 읽었으면 잠그지 않는다 — 건수를 모르는 상태의 자물쇠는 근거 없는 자물쇠다.
  const locked = summary !== null && billableCount > allowance;

  return (
    <main className="min-h-dvh px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">내보내기</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">거래 명세를 저장하세요</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">확인한 거래 내역을 파일로 내려받을 수 있습니다.</p>
      <Card className="mt-8">
        <p className="font-semibold text-zinc-900">거래 명세 파일</p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {summary ? `${periodLabel(summary.period)} · ${events.length}건` : "거래 내역을 불러오는 중입니다."}
        </p>
        {/* 위 줄의 건수는 파일에 들어갈 행 수다. 과금 건수는 그것과 다를 수 있으므로 기준과 수를 함께 적는다. */}
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          건수는 계산 대상 이벤트 기준입니다{summary ? ` · 현재 ${billableCount.toLocaleString("ko-KR")}건` : ""}.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button className="rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || locked} type="button" onClick={() => download(createReportLedgerCsv(events, estimate), "text/csv;charset=utf-8", `verawallet-신고근거-${filenamePeriod}.csv`)}>{locked ? "🔒 " : ""}CSV 다운로드</button>
          <button className="rounded-xl border border-primary-500 py-3.5 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || !summary || locked} type="button" onClick={() => download(createReportXlsx(events, estimate), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-신고근거-${filenamePeriod}.xlsx`)}>{locked ? "🔒 " : ""}XLSX 다운로드</button>
        </div>
        {summary !== null && (
          // 잠기는 것은 다운로드뿐이다 — 위의 기간·건수와 아래 앵커링 증명은 그대로 보인다.
          // 잠기지 않았을 때도 남겨 둔다: 플랜은 탭에 없어서 이 줄이 앱 안의 유일한 진입로다.
          // 대신 톤은 상태를 따라간다 — 열려 있는데 경고색을 쓰면 없는 문제를 있다고 말하는 셈이다.
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
      {estimate && headline && confidence && (
        <Card className="mt-5">
          <div data-surface="report-preview" className="flex items-center justify-between gap-3">
            <p className="font-semibold text-zinc-900">신고 근거자료 미리보기</p>
            <MockProvenanceChip />
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {estimate.taxYear}년 귀속 · {estimate.countryLabel} · {estimate.method}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-card border border-zinc-200 bg-white p-3">
              <dt className="text-xs text-zinc-500">실현 손익</dt>
              <dd className="mt-1 text-sm font-bold text-zinc-900">{formatFiat(headline.periodPnl, estimate.currency)}</dd>
            </div>
            <div className="rounded-card border border-zinc-200 bg-white p-3">
              <dt className="text-xs text-zinc-500">예상 부담</dt>
              <dd className="mt-1 text-sm font-bold text-zinc-900">{formatFiat(estimate.totals.estimatedCharge, estimate.currency)}</dd>
            </div>
          </dl>
          {/* 파일 구조를 먼저 말한다 — 요약·자산별·원장·예외 4시트가 무엇을 담는지. */}
          <ul className="mt-4 grid gap-2 text-sm text-zinc-600">
            <li className="rounded-card border border-zinc-200 bg-zinc-50 p-3"><span className="font-medium text-zinc-900">요약</span> · 신고 기입란(총수입금액·필요경비·과세표준·산출 소득세)</li>
            <li className="rounded-card border border-zinc-200 bg-zinc-50 p-3"><span className="font-medium text-zinc-900">자산별</span> · 취득가액 명세(총평균단가·적용취득가액·손익)</li>
            <li className="rounded-card border border-zinc-200 bg-zinc-50 p-3"><span className="font-medium text-zinc-900">원장</span> · 거래 부속명세(계산 {headline.computableEventCount}건 · 판정·근거)</li>
            <li className="rounded-card border border-zinc-200 bg-zinc-50 p-3"><span className="font-medium text-zinc-900">예외</span> · 판단보류·미반영 {confidence.notReflected}건</li>
          </ul>
        </Card>
      )}
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><MockProvenanceChip /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{formatDateTime(proof.anchored_at)}</dd></div></dl>
        <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>
      </Card>}
    </main>
  );
}
