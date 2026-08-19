"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { anchorProofProvider, eventRepository, summaryProvider } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import { createExportCsv } from "@/lib/export/csv";
import { createExportXlsx } from "@/lib/export/xlsx";
import type { SummaryDTO } from "@/lib/http/dto";
import { periodFilePart, periodLabel } from "@/lib/period";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

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

export function ExportView() {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
  const [proof, setProof] = useState<Awaited<ReturnType<typeof anchorProofProvider.getProof>>>(null);
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

  const ready = summary !== null && !error;
  const filenamePeriod = summary ? periodFilePart(summary.period) : "기간";

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
          <button className="rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || locked} type="button" onClick={() => download(createExportCsv(events), "text/csv;charset=utf-8", `verawallet-명세-${filenamePeriod}.csv`)}>{locked ? "🔒 " : ""}CSV 다운로드</button>
          <button className="rounded-xl border border-primary-500 py-3.5 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || !summary || locked} type="button" onClick={() => summary && download(createExportXlsx(events, summary), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-명세-${filenamePeriod}.xlsx`)}>{locked ? "🔒 " : ""}XLSX 다운로드</button>
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
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><MockProvenanceChip /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{new Date(proof.anchored_at).toLocaleString("ko-KR")}</dd></div></dl>
        <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>
      </Card>}
    </main>
  );
}
