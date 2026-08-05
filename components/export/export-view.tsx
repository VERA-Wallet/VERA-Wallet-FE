"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { anchorProofProvider, eventRepository, summaryProvider } from "@/lib/composition-root.client";
import { collectAllEvents } from "@/lib/export/collect";
import { createExportCsv } from "@/lib/export/csv";
import { createExportXlsx } from "@/lib/export/xlsx";
import type { SummaryDTO } from "@/lib/http/dto";
import { periodFilePart, periodLabel } from "@/lib/period";
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
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button className="rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready} type="button" onClick={() => download(createExportCsv(events), "text/csv;charset=utf-8", `verawallet-명세-${filenamePeriod}.csv`)}>CSV 다운로드</button>
          <button className="rounded-xl border border-primary-500 py-3.5 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready || !summary} type="button" onClick={() => summary && download(createExportXlsx(events, summary), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-명세-${filenamePeriod}.xlsx`)}>XLSX 다운로드</button>
        </div>
      </Card>
      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><MockProvenanceChip /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{new Date(proof.anchored_at).toLocaleString("ko-KR")}</dd></div></dl>
        <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>
      </Card>}
    </main>
  );
}
