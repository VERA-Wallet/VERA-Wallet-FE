"use client";

import { EvidenceAnchor } from "@/components/report/evidence-anchor";
import { StatusBadge, TOPIC_LABEL } from "@/components/report/labels";
import { useReportContext } from "@/components/report/report-context";
import { ReportSubPage } from "@/components/report/report-sub-page";
import { WhyThisAmount } from "@/components/report/why-this-amount";
import { Card } from "@/components/ui/card";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { formatDateTime, formatFiat } from "@/lib/format";

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

/**
 * 계산 근거 — 이 금액이 어디서 나왔는지.
 *
 * 메인에서는 이 내용들이 전부 접힌 `<details>`였다. 페이지가 곧 그 주제인 지금은 펼쳐 둔다 —
 * "계산 근거"를 보려고 들어와서 다시 한 번 펼쳐야 하는 화면은 한 번 더 묻는 화면이다.
 */
export function ReportBasis() {
  const { result, selected, ruleNotes, hasNothingToCompute, groups, proof, provenance } = useReportContext();

  return (
    <ReportSubPage surface="report-basis" title="계산 근거">
      {/* 왜 이 금액인가 — 판정 그룹. 답에 가장 가까운 층이라 맨 위다. */}
      {groups.length > 0 && result ? <WhyThisAmount groups={groups} currency={result.currency} /> : null}

      {/* 셀 것이 없다면서 0.00 줄을 늘어놓으면 사용자가 의미를 찾느라 헤맨다. */}
      {result && !hasNothingToCompute ? (
        <section className="mt-6 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 내역">
          <h2 className="font-bold text-zinc-900">계산 내역</h2>
          <ul className="mt-3 divide-y divide-zinc-100 rounded-card border border-zinc-200 bg-white">
            {result.lines.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium text-zinc-800">{line.label}</p>
                  {line.basis ? <p className="mt-0.5 text-xs text-zinc-400">{line.basis}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-zinc-900">
                    {line.unit === "count" ? `${line.amount}건` : formatFiat(line.amount, result.currency)}
                  </p>
                  {line.rate ? <p className="mt-0.5 text-xs text-zinc-500">{line.rate}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ruleNotes.length > 0 ? (
        <section className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 근거">
          <h2 className="font-bold text-zinc-900">계산 근거와 가정</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600">
            {/* 한계는 "확인할 것" 화면이 이미 말했다. 여기서 또 말하면
                같은 문장이 두 곳에 떠서 어느 쪽이 최신인지 알 수 없다. */}
            {ruleNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <section className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="확정 상태">
          <h2 className="font-bold text-zinc-900">항목별 확정 상태</h2>
          <ul className="mt-3 grid grid-cols-1 gap-2">
            {selected.topics.map((topic, index) => (
              <li key={`${topic.topic}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-800">{TOPIC_LABEL[topic.topic]}</span>
                  <StatusBadge status={topic.status} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">{topic.basis}</p>
                {topic.note ? <p className="mt-1 text-xs text-zinc-400">{topic.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 계산 근거 기록. 이 화면의 estimate를 OmniOne 체인에 봉인하고, 봉인한 것을 근거 화면에서 끝까지 본다. */}
      <EvidenceAnchor />

      {proof && <Card className="mt-5">
        <div data-surface="anchor-proof" className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-900">앵커링 증명</p><ProvenanceChip provenance={provenance} /></div>
        <dl className="mt-4 space-y-2 text-sm text-zinc-600"><div><dt className="inline font-medium text-zinc-900">거래 </dt><dd className="inline font-mono">{shortHash(proof.tx_hash)}</dd></div><div><dt className="inline font-medium text-zinc-900">Merkle root </dt><dd className="inline font-mono">{shortHash(proof.merkle_root)}</dd></div><div><dt className="inline font-medium text-zinc-900">기록 시각 </dt><dd className="inline">{formatDateTime(proof.anchored_at)}</dd></div></dl>
        {/* 탐색기가 없는 체인에서는 링크를 그리지 않는다. 누르면 401이 뜨는 버튼은 증명이 아니다. */}
        {proof.explorer_url && <a className="mt-4 inline-block text-sm font-semibold text-primary-600 underline" href={proof.explorer_url} rel="noreferrer" target="_blank">탐색기에서 보기</a>}
      </Card>}
    </ReportSubPage>
  );
}
