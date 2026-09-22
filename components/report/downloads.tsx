"use client";

import { ChevronRight, Link2, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useReportContext } from "@/components/report/report-context";
import { bundleInFlight, useReportBundle, type ReportBundleState } from "@/components/report/use-report-bundle";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { SummaryDTO } from "@/lib/http/dto";
import { periodLabel } from "@/lib/period";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

/** 등록 한 벌이 지나는 네 걸음. 시트가 지금 어디인지를 이 순서로 말한다. */
const STEPS = ["파일 만들기", "계산 근거와 묶기", "체인에 등록", "저장"] as const;

/** 지금 밟고 있는 걸음. -1은 "아직 시작하지 않음", `STEPS.length`는 "전부 끝남"이다. */
function activeStep(phase: ReportBundleState["phase"]): number {
  if (phase === "hashing") return 0;
  if (phase === "checking") return 1;
  if (phase === "registering" || phase === "waiting") return 2;
  if (phase === "anchored") return STEPS.length;
  return -1;
}

/** 해시 한 줄은 앞자리만 보인다. 전문은 시트에서 복사한다. */
const short = (value: string) => value.slice(0, 10);

/**
 * 전문을 복사하는 한 줄. 이 체인에는 블록 탐색기가 없어 사용자가 조회에 쓸 수 있는 값이 이 해시뿐이다
 * (`evidence-anchor.tsx:144`와 같은 사실) — 그래서 앞자리만 보이되 전문을 손에 쥐여 준다.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  // 클립보드는 브라우저에만 있다. 서버 스냅샷을 false로 두어 서버 HTML과 hydration이 갈리지 않게 하고,
  // 붙은 뒤에 실제 지원 여부로 한 번 바뀐다.
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

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      {canCopy ? (
        <button
          aria-label={`${label} 복사`}
          className="truncate font-mono text-xs text-primary-600 underline"
          type="button"
          onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopied(true)); }}
        >
          {copied ? "복사됨" : short(value)}
        </button>
      ) : (
        <span className="truncate font-mono text-xs text-zinc-800">{value}</span>
      )}
    </div>
  );
}

/**
 * 카드 상단의 등록 상태 한 줄.
 *
 * `aria-live="polite"`인 이유: 사용자가 시트를 닫고 백그라운드로 기다리는 경로가 있어서, 그때
 * 확정·실패를 스스로 말하지 않으면 스크린리더 사용자는 아무 일도 없는 화면 앞에 선다.
 * 영역은 상태와 무관하게 항상 있어야 한다 — 나중에 생기는 live 영역은 읽히지 않는다.
 */
function BundleStatus({ bundle, hasEstimate }: { bundle: ReportBundleState; hasEstimate: boolean }) {
  const { phase, record, error, rejoined, latestRecord, retry } = bundle;

  const body = (() => {
    if (!hasEstimate) {
      return (
        <Line surface="anchor-idle" tone="idle" title="등록할 계산 근거가 없어요">
          계산이 없는 기간이라 파일만 만들어요. 체인에는 아무것도 올라가지 않아요.
        </Line>
      );
    }
    if (bundleInFlight(phase)) {
      return (
        <Line surface="anchor-progress" tone="progress" title="체인에 등록하고 있어요">
          {rejoined ? "이미 등록을 요청했어요. 확정될 때까지 기다려요." : "등록이 끝나면 파일이 저장돼요."}
        </Line>
      );
    }
    if (phase === "anchored" && record !== null) {
      return (
        <Line surface="anchor-done" tone="done" title="체인에 등록됐어요">
          {formatDateTime(record.anchoredAt ?? record.recordedAt)} · 루트 {short(record.merkleRoot)}
          {record.txHash !== null && ` · tx ${short(record.txHash)}`}
        </Line>
      );
    }
    if (phase === "failed") {
      return (
        <Line surface="anchor-failed" tone="failed" title="등록하지 못했어요">
          <span className="block">{error ?? "체인에 등록하지 못했어요."}</span>
          <button
            className="mt-2 inline-flex items-center rounded-xl border border-primary-500 px-3 py-1.5 text-sm font-semibold text-primary-600"
            data-surface="anchor-retry"
            type="button"
            // 재시도는 자기 흐름을 연다. 카드로 올라가면 복원 조회 핸들러가 한 번 더 따라붙는다.
            onClick={(event) => { event.stopPropagation(); retry(); }}
          >
            다시 시도
          </button>
        </Line>
      );
    }
    return (
      <Line surface="anchor-idle" tone="idle" title="이 리포트는 아직 체인에 등록되지 않았어요">
        {latestRecord !== null
          // `latest()`가 말한 것은 "이 해에 무언가 등록된 적이 있다"뿐이다. 루트를 맞춰 보지 않았으므로
          // 「이 리포트가 등록됐다」고 단정하지 않는다 — 그 말은 클릭 흐름이 루트를 확인한 뒤에만 쓴다.
          ? `최근 등록 · ${formatDateTime(latestRecord.anchoredAt ?? latestRecord.recordedAt)}${latestRecord.txHash !== null ? ` · tx ${short(latestRecord.txHash)}` : ""}`
          : "처음 내려받을 때 계산 근거와 파일을 한 번에 등록해요."}
      </Line>
    );
  })();

  return <div aria-live="polite" className="mt-4">{body}</div>;
}

const DOT = {
  idle: "bg-zinc-300",
  progress: "bg-primary-500 motion-safe:animate-pulse",
  done: "bg-emerald-500",
  failed: "bg-red-500",
} as const;

function Line({
  surface, tone, title, children,
}: { surface: string; tone: keyof typeof DOT; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5" data-surface={surface}>
      <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        <div className="mt-0.5 break-words text-sm leading-6 text-zinc-500">{children}</div>
      </div>
    </div>
  );
}

/** 회색 그룹 한 덩어리. 토스식 목록은 배경이 묶고 행은 흰 카드로 뜬다. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-3xl bg-zinc-100 p-2">
      <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-zinc-500">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const ROW = "flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-50";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-bold text-zinc-500">
      {children}
    </span>
  );
}

/**
 * 등록 흐름의 바텀시트.
 *
 * `components/ui/bottom-sheet.tsx`를 그대로 쓴다 — `role="dialog"` + `aria-modal` + 포커스 트랩 +
 * Esc + 바디 스크롤 잠금이 이미 있다. 그 재사용에 두 제약이 따라온다:
 * 시트는 **행을 실제로 탭했을 때만** 열리고(열릴 때 포커스를 옮기므로 호버로 열면 안 된다),
 * 단계별로 바뀌는 본문은 `aria-live="polite"`로 감싼다(대화상자 내용 변경은 저절로 읽히지 않는다).
 */
function BundleSheet({ bundle }: { bundle: ReportBundleState }) {
  const { phase, record, error, sheetOpen, awaitingConfirm, confirm, retry, closeSheet } = bundle;
  const running = bundleInFlight(phase);
  const title = phase === "anchored"
    ? "체인에 등록됐어요"
    : phase === "failed"
      ? "등록하지 못했어요"
      : running
        ? "체인에 등록하고 있어요"
        : "신고 자료를 내려받을 수 있어요";
  const step = activeStep(phase);

  return (
    <BottomSheet open={sheetOpen} title={title} onClose={closeSheet}>
      <div data-surface="anchor-sheet">
        <h3 className="text-lg font-bold text-zinc-900">{title}</h3>
        <div aria-live="polite" className="mt-4">
          {phase === "anchored" && record !== null ? (
            <div className="rounded-card border border-zinc-200 p-3">
              <CopyRow label="루트" value={record.merkleRoot} />
              {record.txHash !== null && <CopyRow label="거래 해시" value={record.txHash} />}
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="shrink-0 text-sm text-zinc-500">등록 시각</span>
                <span className="text-sm text-zinc-800">{formatDateTime(record.anchoredAt ?? record.recordedAt)}</span>
              </div>
              {record.explorerUrl !== null && (
                // 누르면 401이 뜨는 링크를 증명이라고 내놓지 않는다. 탐색기가 있을 때만 링크가 된다.
                <a
                  className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 underline"
                  href={record.explorerUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Link2 aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                  체인에서 확인하기
                </a>
              )}
            </div>
          ) : phase === "failed" ? (
            <p className="rounded-card border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900">
              {error ?? "체인에 등록하지 못했어요."}
            </p>
          ) : (
            <ol className="space-y-2">
              {STEPS.map((label, index) => (
                <li key={label} className="flex items-center gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-full ${index < step ? "bg-emerald-500" : index === step ? "bg-primary-500 motion-safe:animate-pulse" : "bg-zinc-300"}`}
                  />
                  <span className={index === step ? "font-semibold text-zinc-900" : "text-zinc-500"}>{label}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-500">
          계산 근거 + CSV + XLSX의 해시를 하나의 루트로 묶어 체인에 한 번 등록해요. 금액·지갑 주소는 올라가지 않아요.
        </p>
        <div className="mt-5 space-y-2">
          {awaitingConfirm && (
            <button
              className="flex w-full items-center justify-center rounded-xl bg-primary-500 py-3 font-semibold text-white"
              data-surface="anchor-sheet-confirm"
              type="button"
              onClick={confirm}
            >
              내려받기
            </button>
          )}
          {phase === "failed" && (
            <button
              className="flex w-full items-center justify-center rounded-xl bg-primary-500 py-3 font-semibold text-white"
              data-surface="anchor-retry"
              type="button"
              onClick={retry}
            >
              다시 시도
            </button>
          )}
          <button
            className={`flex w-full items-center justify-center rounded-xl py-3 font-semibold ${
              phase === "anchored" ? "bg-primary-500 text-white" : "border border-zinc-200 text-zinc-600"
            }`}
            type="button"
            onClick={closeSheet}
          >
            {running ? "백그라운드에서 계속" : "닫기"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * 용도별 내려받기.
 *
 * 잠금 규칙(`downloadLocked`)은 호출부가 정한 그대로 받는다 — 여기서 다시 판단하지 않는다.
 * `blockedReason`은 잠금과 다른 사실이다: 거주국이 아닌 나라를 비교 중이거나 데모 시나리오로
 * 보는 중이면 그 값으로 신고 근거자료를 만들 수 없다. 플랜과 무관하므로 자물쇠가 아니라 이유를 말한다.
 *
 * 두 파일 행은 **하나의 등록 게이트**를 지난다(`useReportBundle`): 계산 근거와 CSV·XLSX 해시를
 * 한 루트로 묶어 올리고 확정된 뒤에만 저장한다. 등록이 하나이므로 진행 중에는 두 행이 함께 잠긴다.
 * 게이트에 필요한 값(`gateEnabled`·`events`·`result`·나라·연도)은 prop을 늘리는 대신 context에서
 * 직접 읽는다 — `EvidenceAnchor`(evidence-anchor.tsx:73)와 같은 방식이다.
 * **잠금·차단 규칙이 게이트보다 앞이다.** 못 만드는 파일은 해시하지도, 등록하지도 않는다.
 *
 * 접근성 이름은 계약이다: 두 행의 보이는 제목과 `aria-label`이 모두 「직접 신고용 내려받기」·
 * 「세무사 전달용 내려받기」여야 한다(Playwright `:has-text()`는 텍스트를, vitest `getByRole`은
 * 접근성 이름을 본다). 카드 제목도 정확히 「내려받기」 한 단어다(`report-split`이 완전 일치로 찾는다).
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
  // 게이트 표시는 켜졌을 때만 그린다. 꺼져 있으면 예전 화면 그대로다(상단 줄도 시트도 없다).
  const { gateEnabled, freshEstimate, result } = useReportContext();
  const bundle = useReportBundle();
  // 계산이 아직 오는 중이면 파일에 들어갈 값이 확정되지 않았다. 그 사이에 누른 내려받기는 계산 없는
  // 파일을 만들어 그 해시를 등록하는데, 그것은 몇백 밀리초 뒤 이 행이 만들 파일의 해시가 아니다.
  // 막는 것은 "오는 중"뿐이다 — 계산이 **끝났는데 결과가 없는 것**(엔진 실패·룰셋 미확인)은 정당한
  // 경로이고, 그때도 온체인 값만으로 원장을 만들 수 있다(`tests/ui/export-empty-period.test.tsx`).
  // 게이트가 꺼져 있으면 이 잠금도 없다 — 스위치를 내렸을 때는 예전 내려받기와 한 글자도 다르지 않아야 한다.
  const estimatePending = gateEnabled && freshEstimate.state === "pending";
  const disabled = !ready || downloadLocked || blockedReason !== null || estimatePending;
  const busy = bundleInFlight(bundle.phase);

  return (
    <Card
      className="mt-5"
      data-surface="download-card"
      // 복원 조회는 사용자가 이 카드에 처음 닿을 때 한 번만 일어난다. 마운트마다 부르면 리포트를
      // 여는 모든 사람이 쓰지도 않을 왕복을 낸다(계획 §5). 파일은 여기서 만들지 않는다.
      onClick={bundle.restore}
      onFocusCapture={bundle.restore}
      onPointerEnter={bundle.restore}
    >
      <p className="font-semibold text-zinc-900">내려받기</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        {summary ? `${periodLabel(activePeriod ?? summary.period)} · ${events.length}건` : "거래 내역을 불러오는 중입니다."}
      </p>
      {/* 위 줄의 건수는 파일에 들어갈 행 수다. 과금 건수는 그것과 다를 수 있으므로 기준과 수를 함께 적는다. */}
      <p className="mt-1 text-sm leading-6 text-zinc-500">
        건수는 계산 대상 이벤트 기준입니다{summary ? ` · 현재 ${billableCount.toLocaleString("ko-KR")}건` : ""}.
      </p>
      {/* 계산은 무료다 — 결제는 파일을 만들 때만 필요하다. */}
      {!subscribed && (
        <p className="mt-1 text-sm leading-6 text-zinc-500">계산은 무료예요. 파일로 내려받을 때만 결제해요.</p>
      )}
      {blockedReason !== null && (
        <p data-surface="download-blocked" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
          {blockedReason}
        </p>
      )}

      {gateEnabled && <BundleStatus bundle={bundle} hasEstimate={result !== undefined} />}

      <Group label="파일">
        {/* 직접 신고용(추천) — 홈택스 본인 신고. PDF 요약서 생성기가 없어 CSV 원장으로 구성한다. */}
        <button
          aria-label="직접 신고용 내려받기"
          className={ROW}
          data-anchor-kind="csv"
          data-locked={downloadLocked ? "download" : undefined}
          disabled={disabled || busy}
          type="button"
          onClick={() => bundle.start("csv")}
        >
          <Badge>CSV</Badge>
          <span className="min-w-0 grow">
            <span className="block font-semibold text-zinc-900">직접 신고용 내려받기</span>
            <span className="mt-0.5 block text-sm leading-6 text-zinc-500">홈택스 본인 신고 · CSV 원장(거래 부속명세)</span>
          </span>
          {downloadLocked
            ? <Lock aria-hidden className="size-4 shrink-0 text-zinc-400" strokeWidth={2.5} />
            : <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-300" strokeWidth={2.5} />}
        </button>

        {/* 세무사 전달용 — XLSX 4시트(요약·자산별·원장·예외). */}
        <button
          aria-label="세무사 전달용 내려받기"
          className={ROW}
          data-anchor-kind="xlsx"
          data-locked={downloadLocked ? "download" : undefined}
          disabled={disabled || !summary || busy}
          type="button"
          onClick={() => bundle.start("xlsx")}
        >
          <Badge>XLSX</Badge>
          <span className="min-w-0 grow">
            <span className="block font-semibold text-zinc-900">세무사 전달용 내려받기</span>
            {/* 네 시트가 무엇을 담는지는 이 행에만 있다 — 줄이면 사용자가 둘 중 무엇을 고를지 알 길이 없다. */}
            <span className="mt-0.5 block text-sm leading-6 text-zinc-500">
              XLSX 4시트 · 요약(신고 기입란) · 자산별(취득가액 명세) · 원장(거래 부속명세) · 예외(판단보류·미반영)
            </span>
          </span>
          {downloadLocked
            ? <Lock aria-hidden className="size-4 shrink-0 text-zinc-400" strokeWidth={2.5} />
            : <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-300" strokeWidth={2.5} />}
        </button>
      </Group>

      {/* 보고서: 값만 늘어놓은 격자가 아니라 계산 흐름을 보이는 문서. 앱 화면(/export/report)에서 그대로 읽고,
          PDF는 거기서 브라우저 인쇄로 저장한다(한글 PDF를 직접 쓰려면 글꼴을 통째로 내장해야 해서).
          바이트가 없으므로 이 행은 등록 게이트를 지나지 않는다. */}
      <Group label="문서">
        {!disabled ? (
          <Link aria-label="보고서 보기" href="/export/report" className={ROW} data-surface="report-open">
            <Badge>PDF</Badge>
            <span className="min-w-0 grow">
              <span className="block font-semibold text-zinc-900">보고서 보기</span>
              <span className="mt-0.5 block text-sm leading-6 text-zinc-500">앱에서 읽고 인쇄로 저장</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-300" strokeWidth={2.5} />
          </Link>
        ) : (
          <button aria-label="보고서 보기" className={ROW} data-locked={downloadLocked ? "download" : undefined} data-surface="report-open" disabled type="button">
            <Badge>PDF</Badge>
            <span className="min-w-0 grow">
              <span className="block font-semibold text-zinc-900">보고서 보기</span>
              <span className="mt-0.5 block text-sm leading-6 text-zinc-500">앱에서 읽고 인쇄로 저장</span>
            </span>
            {downloadLocked
              ? <Lock aria-hidden className="size-4 shrink-0 text-zinc-400" strokeWidth={2.5} />
              : <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-300" strokeWidth={2.5} />}
          </button>
        )}
      </Group>

      {gateEnabled && (
        <p className="mt-3 text-xs leading-5 text-zinc-400">
          계산 근거 + CSV + XLSX의 해시를 하나의 루트로 묶어 체인에 한 번 등록해요. 금액·지갑 주소는 올라가지 않아요.
        </p>
      )}

      {summary !== null && (
        // 잠기는 것은 다운로드뿐이다 — 위의 기간·건수와 등록 상태는 그대로 보인다.
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

      {gateEnabled && <BundleSheet bundle={bundle} />}
    </Card>
  );
}
