"use client";

import { ArrowRight, Link2, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useReportContext } from "@/components/report/report-context";
import { Card } from "@/components/ui/card";
import { taxEvidenceProvider } from "@/lib/composition-root.client";
import { formatDateTime } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/ports/tax-evidence";
import { buildEvidenceDocument } from "@/lib/tax/evidence";

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

/** 리포트 한 벌이 공유하는 체인 기록 상태. 계산 근거 카드와 보고서 화면이 같은 규칙으로 읽는다. */
export function useTaxEvidence() {
  const { result, country, taxYear, walletConnected } = useReportContext();

  // 체인에 봉인한 계산 근거. 어느 연도의 답인지 함께 들고 있는다. 연도를 바꿀 때 상태를 비우려고
  // 효과 안에서 setState를 부르면 렌더가 연쇄된다(React Compiler가 막는다). 연도가 다르면 아래에서 안 쓴다.
  const [entry, setEntry] = useState<{ country: string; taxYear: number; record: EvidenceRecord | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 지금 화면이 말하는 계산의 머클루트. 체인에 올라간 루트와 같은지 비교해 "고친 뒤인지"를 판단한다.
  // 잎마다 keccak을 돌리므로 estimate가 바뀔 때만 다시 센다.
  const currentRoot = useMemo(() => (result ? buildEvidenceDocument(result).merkleRoot : null), [result]);
  // 고른 귀속연도의 기록. 아직 못 읽었거나 다른 해의 답이면 null로 둔다. 없는 기록을 있다고 말하지 않는다.
  const evidence = entry !== null && entry.country === country && entry.taxYear === taxYear ? entry.record : null;
  // 기록은 있는데 지금 계산과 루트가 다르면, 기록 뒤에 거래를 고쳤다는 뜻이다.
  const stale = evidence !== null && currentRoot !== null && evidence.merkleRoot.toLowerCase() !== currentRoot.toLowerCase();

  // 404는 실패가 아니라 "그 해에는 기록이 없다"는 사실이다(어댑터가 null로 번역한다).
  // 지갑 미연결(DID-only)에는 봉인할 내 계산이 없다. 대시보드 빈 상태와 같은 원칙으로 네트워크를 건드리지 않는다.
  useEffect(() => {
    if (!walletConnected) return;
    let active = true;
    void taxEvidenceProvider
      .latest(country, taxYear)
      .then((record) => { if (active) setEntry({ country, taxYear, record }); })
      .catch(() => { /* 기록 조회 실패가 리포트 전체를 막지는 않는다. 버튼은 그대로 눌러 볼 수 있다. */ });
    return () => { active = false; };
  }, [country, taxYear, walletConnected]);

  const record = () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    void taxEvidenceProvider
      .record(buildEvidenceDocument(result))
      .then((next) => setEntry({ country, taxYear, record: next }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "계산 근거를 기록하지 못했습니다."))
      .finally(() => setBusy(false));
  };

  return { evidence, stale, busy, error, record };
}

/**
 * 계산 근거 기록. 귀속연도 하나의 estimate를 정본 문서로 만들어 OmniOne 체인에 봉인한다.
 *
 * 체인에 나가는 것은 머클루트 하나다. 건별 판정을 잎으로 묶은 해시라, 나중에 거래 한 건만 골라
 * "그때 이렇게 판정했다"를 나머지를 보이지 않고 증명할 수 있다. 루트는 서버가 잎에서 다시 계산한다.
 * 화면이 준 해시를 그냥 올리면 아무도 재현할 수 없는 값이 남는다.
 *
 * 계산 근거 화면(`/export/basis`)의 한 카드다. estimate·나라·연도는 리포트 한 벌이 공유하는 context에서 읽는다.
 * 여기서 따로 계산하면 같은 귀속연도에 두 답이 생긴다.
 */
export function EvidenceAnchor() {
  const { result, taxYear, ready, downloadLocked, blockedReason } = useReportContext();
  const { evidence, stale, busy, error, record } = useTaxEvidence();

  if (!result) return null;

  // 데모 시나리오·비교 중(blockedReason)은 내 지갑의 계산이 아니다. 파일과 같은 이유로 체인에도 올리지 않는다.
  const disabled = !ready || downloadLocked || blockedReason !== null || busy || (evidence !== null && !stale);

  return (
    <Card className="mt-5">
      <div data-surface="evidence-anchor" className="flex items-center justify-between gap-3">
        <p className="font-semibold text-zinc-900">계산 근거 기록</p>
        {evidence && !stale && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-600">
            <ShieldCheck aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
            체인에 기록됨
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        {taxYear}년 귀속 계산을 OmniOne 체인에 봉인합니다. 금액·지갑 주소는 올라가지 않고, 건별 판정을 묶은
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
            {/* 잎에는 헤더 1개가 함께 들어간다. 사용자에게는 판정 건수로 말한다. */}
            <dd className="text-right font-medium text-zinc-900">{Math.max(evidence.leafCount - 1, 0)}건</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-zinc-500">기록 시각</dt>
            <dd className="text-right font-medium text-zinc-900">{formatDateTime(evidence.anchoredAt ?? evidence.recordedAt)}</dd>
          </div>
        </dl>
      )}

      {/* 기록 뒤에 거래를 고쳤으면 그 사실을 말한다. "기록됨" 배지만 남기면 옛 근거를 현재 근거로 읽는다. */}
      {stale && (
        <p className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          기록한 뒤로 계산이 달라졌습니다. 지금 화면의 근거를 남기려면 다시 기록해 주세요. 이전 기록은 체인에 그대로 남습니다.
        </p>
      )}

      {evidence?.anchorStatus === "pending" && (
        <p className="mt-4 text-sm leading-6 text-zinc-500">체인에 올리는 중입니다. 잠시 뒤 이 화면을 다시 열면 거래 번호가 표시됩니다.</p>
      )}

      <button
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
        data-locked={downloadLocked ? "download" : undefined}
        disabled={disabled}
        type="button"
        onClick={record}
      >
        {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
        {busy ? "기록하는 중…" : stale ? "다시 기록하기" : evidence ? "기록 완료" : "계산 근거 기록하기"}
      </button>
      {error && <p className="mt-2 text-sm wrap-anywhere text-red-600">{error}</p>}

      {/* 탐색기가 있으면 링크, 없으면 거래 해시 전문. OmniOne 스테이지에는 블록 탐색기가 없어
          사용자가 조회에 쓸 수 있는 값은 이 해시뿐이다. 누르면 401이 뜨는 링크로 대신하지 않는다. */}
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

      {/* 체인에서 직접 확인은 근거 화면(/export/evidence/<루트>)으로 간다. 이 체인에는 블록 탐색기가 없어 사용자가
          트랜잭션을 눈으로 볼 수 없으므로 앱이 그 자리를 맡는다. 체인을 지금 읽어 대조한 결과와, 그 루트가
          덮는 판정 전체를 한 화면에서 보인다. 해시가 같다는 한 줄만으로는 근거가 아니다. */}
      {evidence && (
        <Link
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700"
          data-surface="evidence-chain-check"
          href={`/export/evidence/${evidence.merkleRoot}`}
        >
          <ShieldCheck aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
          체인에서 직접 확인
          <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
        </Link>
      )}
    </Card>
  );
}
