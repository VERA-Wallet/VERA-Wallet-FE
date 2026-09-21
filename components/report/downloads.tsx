"use client";

import { Link2, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useReportContext } from "@/components/report/report-context";
import { anchorInFlight, useReportAnchor, type ReportAnchorState } from "@/components/report/use-report-anchor";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { SummaryDTO } from "@/lib/http/dto";
import { periodLabel } from "@/lib/period";
import type { ReportAnchorRecord } from "@/lib/ports/report-anchor";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

/** 진행 중에는 버튼이 지금 무엇을 하는지 말한다. 멈춰 보이는 버튼을 남기지 않는다. */
function buttonLabel(phase: ReportAnchorState["phase"], base: string): string {
  if (phase === "hashing" || phase === "checking") return "파일을 확인하는 중…";
  if (phase === "registering" || phase === "waiting") return "체인에 등록하는 중…";
  return base;
}

/**
 * 등록이 확정된 파일 한 줄. 체인에 올라간 사실만 적는다 — 금액도 지갑 주소도 여기 없다.
 *
 * 거래 해시는 앞 10자만 보이되 전문을 복사할 수 있게 한다. 이 체인에는 블록 탐색기가 없어
 * 사용자가 조회에 쓸 수 있는 값이 그 해시뿐이다(`evidence-anchor.tsx:144`와 같은 사실).
 */
function AnchorDone({ record }: { record: ReportAnchorRecord }) {
  const [copied, setCopied] = useState(false);
  // 클립보드는 브라우저에만 있다. 서버 스냅샷을 false로 두어 서버 HTML과 hydration이 갈리지 않게 하고,
  // 붙은 뒤에 실제 지원 여부로 한 번 바뀐다. 효과 안에서 setState를 부르면 렌더가 연쇄된다.
  const canCopy = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.clipboard?.writeText === "function",
    () => false,
  );
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const txHash = record.txHash;
  return (
    <div data-surface="anchor-done" className="mt-3 rounded-card border border-primary-200 bg-primary-50/40 p-3">
      <p className="text-sm leading-6 text-zinc-700">
        <ShieldCheck aria-hidden className="mr-1 inline size-4 shrink-0 align-text-bottom text-primary-600" strokeWidth={2.5} />
        체인에 등록됨 · {formatDateTime(record.anchoredAt ?? record.recordedAt)} · 파일 {record.fileHash.slice(0, 10)}
        {/* 계약상 anchored에는 txHash가 있다. 없으면 없는 값을 지어내지 않고 그 칸만 뺀다. */}
        {txHash && ` · tx ${txHash.slice(0, 10)}`}
      </p>
      {txHash && (canCopy ? (
        <button
          aria-label="거래 해시 복사"
          className="mt-2 text-sm font-semibold text-primary-600 underline"
          type="button"
          // 카드 전체가 복원 조회의 첫 접촉을 받는다(아래 `onClick={csv.restore}`). 해시를 복사하는 것은
          // 그 접촉이 아니므로 여기서 멈춘다 — 안 그러면 복사 한 번이 조회 한 번을 끌고 간다.
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard.writeText(txHash).then(() => setCopied(true));
          }}
        >
          {copied ? "복사됨" : "거래 해시 복사"}
        </button>
      ) : (
        <p className="mt-2 break-all font-mono text-xs text-zinc-800">{txHash}</p>
      ))}
      {/* 누르면 401이 뜨는 링크를 증명이라고 내놓지 않는다. 탐색기가 있을 때만 링크가 된다. */}
      {record.explorerUrl && (
        <a
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 underline"
          href={record.explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Link2 aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
          체인에서 확인하기
        </a>
      )}
    </div>
  );
}

/** 카드 하나의 등록 상태. 아직 아무 일도 없었으면(=idle) 아무것도 그리지 않는다. */
function AnchorStatus({ anchor }: { anchor: ReportAnchorState }) {
  const { phase, record, error, rejoined, retry } = anchor;

  if (phase === "registering" || phase === "waiting") {
    return (
      <p data-surface="anchor-progress" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
        {rejoined
          ? "이미 등록을 요청한 파일입니다. 확정될 때까지 기다리는 중입니다."
          : "체인에 등록하는 중입니다. 등록이 끝나면 파일이 저장됩니다."}
      </p>
    );
  }

  if (phase === "anchored" && record) return <AnchorDone record={record} />;

  if (phase === "failed") {
    return (
      <>
        <p data-surface="anchor-failed" className="mt-3 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          {error ?? "파일을 등록하지 못했습니다."}
          {record !== null && record.attempt > 1 && ` (${record.attempt}번째 시도)`}
        </p>
        <button
          className="mt-2 flex w-full items-center justify-center rounded-xl border border-primary-500 py-2.5 text-sm font-semibold text-primary-600"
          data-surface="anchor-retry"
          type="button"
          // 재시도는 자기 흐름을 연다. 카드로 올라가면 복원 조회 핸들러가 한 번 더 따라붙는다.
          onClick={(event) => { event.stopPropagation(); retry(); }}
        >
          다시 시도
        </button>
      </>
    );
  }

  return null;
}

/**
 * 용도별 내려받기.
 *
 * 잠금 규칙(`downloadLocked`)은 호출부가 정한 그대로 받는다 — 여기서 다시 판단하지 않는다.
 * `blockedReason`은 잠금과 다른 사실이다: 거주국이 아닌 나라를 비교 중이거나 데모 시나리오로
 * 보는 중이면 그 값으로 신고 근거자료를 만들 수 없다. 플랜과 무관하므로 자물쇠가 아니라 이유를 말한다.
 *
 * CSV·XLSX 두 버튼은 등록 게이트를 지난다(`useReportAnchor`): 파일 바이트의 해시를 등록하고
 * 확정된 뒤에만 저장한다. 게이트에 필요한 값(`gateEnabled`·`events`·`result`·나라·연도)은
 * prop을 셋 늘리는 대신 context에서 직접 읽는다 — `EvidenceAnchor`(evidence-anchor.tsx:73)와 같은 방식이다.
 * **잠금·차단 규칙이 게이트보다 앞이다.** 못 만드는 파일은 해시하지도, 등록하지도 않는다.
 */
// `estimate`는 prop 목록에 남아 있지만 여기서 읽지 않는다 — 파일을 만드는 쪽이 훅으로 옮겨
// context의 `result`를 직접 읽기 때문이다. 시그니처를 줄이면 이번 범위 밖의 호출부가 따라 바뀐다.
export function Downloads({
  events,
  summary,
  activePeriod,
  ready,
  downloadLocked,
  blockedReason,
  subscribed,
  planName,
  allowance,
  billableCount,
}: {
  events: NormalizedEvent[];
  estimate: TaxEstimate | null;
  summary: SummaryDTO | null;
  activePeriod: SummaryDTO["period"] | null;
  ready: boolean;
  downloadLocked: boolean;
  blockedReason: string | null;
  subscribed: boolean;
  planName: string;
  allowance: number;
  billableCount: number;
}) {
  // 게이트 표시는 켜졌을 때만 그린다. 꺼져 있으면 예전 화면 그대로다(진행·성공·실패 세 줄 전부 없다).
  const { gateEnabled, freshEstimate } = useReportContext();
  const csv = useReportAnchor("csv");
  const xlsx = useReportAnchor("xlsx");
  // 계산이 아직 오는 중이면 파일에 들어갈 값이 확정되지 않았다. 그 사이에 누른 내려받기는 계산 없는
  // 파일을 만들어 그 해시를 등록하는데, 그것은 몇백 밀리초 뒤 이 버튼이 만들 파일의 해시가 아니다.
  // 막는 것은 "오는 중"뿐이다 — 계산이 **끝났는데 결과가 없는 것**(엔진 실패·룰셋 미확인)은 정당한
  // 경로이고, 그때도 온체인 값만으로 원장을 만들 수 있다(`tests/ui/export-empty-period.test.tsx`).
  const estimatePending = freshEstimate.state === "pending";
  const disabled = !ready || downloadLocked || blockedReason !== null || estimatePending;

  return (
    <Card className="mt-5">
      <p className="font-semibold text-zinc-900">내려받기</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        {summary ? `${periodLabel(activePeriod ?? summary.period)} · ${events.length}건` : "거래 내역을 불러오는 중입니다."}
      </p>
      {/* 위 줄의 건수는 파일에 들어갈 행 수다. 과금 건수는 그것과 다를 수 있으므로 기준과 수를 함께 적는다. */}
      <p className="mt-1 text-sm leading-6 text-zinc-500">
        건수는 계산 대상 이벤트 기준입니다{summary ? ` · 현재 ${billableCount.toLocaleString("ko-KR")}건` : ""}.
      </p>
      {/* 계산은 무료다 — 결제는 파일을 만들 때만 필요하다. 예전 배너처럼 "금액은 구독 후 공개"라고
          말하면 화면이 하지 않는 잠금을 광고하는 셈이 된다(금액 블러는 이제 없다). */}
      {!subscribed && (
        <p className="mt-1 text-sm leading-6 text-zinc-500">계산은 무료예요. 파일로 내려받을 때만 결제해요.</p>
      )}
      {blockedReason !== null && (
        <p data-surface="download-blocked" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
          {blockedReason}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {/* 직접 신고용(추천) — 홈택스 본인 신고. PDF 요약서 생성기가 없어 CSV 원장으로 구성한다. */}
        {/* 복원 조회는 사용자가 이 카드에 처음 닿을 때 한 번만 일어난다. 마운트마다 XLSX까지 만들면
            리포트를 여는 모든 사람이 쓰지도 않을 파일 생성 비용을 낸다(계획 §3). */}
        <div
          className="rounded-card border border-primary-200 bg-primary-50/40 p-4"
          data-anchor-kind="csv"
          onClick={csv.restore}
          onFocusCapture={csv.restore}
          onPointerEnter={csv.restore}
        >
          <div className="flex items-center gap-2">
            <p className="font-semibold text-zinc-900">직접 신고용</p>
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">추천</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">홈택스 본인 신고용 · CSV 원장(거래 부속명세)</p>
          <button
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-500 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            data-locked={downloadLocked ? "download" : undefined}
            disabled={disabled || anchorInFlight(csv.phase) || csv.phase === "failed"}
            type="button"
            onClick={csv.start}
          >
            {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
            {buttonLabel(csv.phase, "직접 신고용 내려받기")}
          </button>
          {gateEnabled && <AnchorStatus anchor={csv} />}
        </div>

        {/* 세무사 전달용 — XLSX 4시트(요약·자산별·원장·예외). 미리보기 목록을 여기에 흡수한다. */}
        <div
          className="rounded-card border border-zinc-200 p-4"
          data-anchor-kind="xlsx"
          onClick={xlsx.restore}
          onFocusCapture={xlsx.restore}
          onPointerEnter={xlsx.restore}
        >
          <p className="font-semibold text-zinc-900">세무사 전달용</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            XLSX 4시트 · 요약(신고 기입란) · 자산별(취득가액 명세) · 원장(거래 부속명세) · 예외(판단보류·미반영)
          </p>
          <button
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            data-locked={downloadLocked ? "download" : undefined}
            disabled={disabled || !summary || anchorInFlight(xlsx.phase) || xlsx.phase === "failed"}
            type="button"
            onClick={xlsx.start}
          >
            {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
            {buttonLabel(xlsx.phase, "세무사 전달용 내려받기")}
          </button>
          {gateEnabled && <AnchorStatus anchor={xlsx} />}
        </div>

        {/* 보고서: 값만 늘어놓은 격자가 아니라 계산 흐름을 보이는 문서. 앱 화면(/export/report)에서 그대로 읽고,
            PDF는 거기서 브라우저 인쇄로 저장한다(한글 PDF를 직접 쓰려면 글꼴을 통째로 내장해야 해서).
            귀속연도·시행 가정은 리포트 한 벌이 공유하는 프로바이더에 살아 있어 링크에 실어 나르지 않는다. */}
        <div className="rounded-card border border-zinc-200 p-4">
          <p className="font-semibold text-zinc-900">보고서</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            표지 · 신고 요약(기입란) · 자산별 명세 · 예외와 한계를 한 문서로. 앱 안에서 읽고, 인쇄에서
            &lsquo;PDF로 저장&rsquo;을 고르면 파일이 됩니다.
          </p>
          {!disabled ? (
            <Link
              href="/export/report"
              data-surface="report-open"
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600"
            >
              보고서 보기
            </Link>
          ) : (
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-locked={downloadLocked ? "download" : undefined}
              data-surface="report-open"
              disabled
              type="button"
            >
              {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
              보고서 보기
            </button>
          )}
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
            {downloadLocked && (!subscribed ? " (플랜 필요)" : " (상위 플랜 필요)")}
          </span>
          <span className={`shrink-0 font-semibold underline ${downloadLocked ? "" : "text-primary-600"}`}>플랜 보기</span>
        </Link>
      )}
    </Card>
  );
}
