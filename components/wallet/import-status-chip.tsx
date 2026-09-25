"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ImportChainList, ImportProgressBar } from "@/components/wallet/import-chain-list";
import { PARTIAL_IMPORT_CODE, useImportElapsed, useImportTracker } from "@/components/wallet/import-tracker-provider";
import { chainLabel, shortHash } from "@/lib/format";
import type { ImportProgress } from "@/lib/wallet/import-progress";
import {
  SLOW_IMPORT_CHIP_MS,
  importScanChains,
  importStartedLabel,
  reportedEventCount,
  reportedProgressAt,
  reportedScanProgress,
  skippedChainIds,
} from "@/lib/wallet/import-tracker";

/**
 * 어느 탭에 있든 불러오기가 어떻게 되고 있는지 말하는 한 줄.
 *
 * 모달을 걷은 뒤 화면이 침묵하면 사용자는 불러오기가 취소된 것으로 읽는다 — 실제로는 계속 돌고 있는데도.
 * 그래서 진행 중·실패·유실은 **비켜난 자리에서 계속 말한다.** 완료만 칩에서 빠진다(토스트가 대신 말한다).
 *
 * 모달이 떠 있는 동안에는 그리지 않는다 — 같은 사실을 두 겹으로 말할 이유가 없다.
 */

/** 칩의 틱. 모달(120ms)보다 성긴 이유: 칩은 앱 전체에 얹히므로 초당 여덟 번씩 다시 그릴 값이 아니다. */
const CHIP_TICK_MS = 1_000;

export function ImportStatusChip() {
  const { state, retry, modalOpen } = useImportTracker();
  const [sheetOpen, setSheetOpen] = useState(false);
  const elapsedMs = useImportElapsed(state.startedAt, CHIP_TICK_MS);
  const reported = state.job?.progress ?? null;
  const chains = useMemo(() => importScanChains(state.result, reported, state.walletAddress), [state.result, reported, state.walletAddress]);
  // 시트에 넘기는 진행은 BE 보고뿐이다. 연출 타이머를 물리면 칩은 "불러오는 중"인데 시트는 전부 완료로 그린다.
  const sheetProgress = useMemo<ImportProgress | null>(
    () => (reported === null || state.status !== "running" ? null : reportedProgressAt(reported, elapsedMs, state.walletAddress)),
    [reported, state.status, elapsedMs, state.walletAddress],
  );

  const skipped = skippedChainIds(state.result);

  // 완료는 토스트가 말한다. idle은 말할 것이 없다. 모달이 떠 있으면 이미 같은 사실이 화면 가운데 있다.
  if (modalOpen || state.status === "idle" || state.status === "done") return null;

  if (state.status === "running") {
    // BE가 실제로 알려준 진척만 쓴다. 지금 계약에서는 대개 null이고, 그때 칩은 **모른다고 말한다** —
    // 연출 타이머로 "3곳 끝났다"를 지어내면 사용자는 그것을 사실로 읽는다.
    const scan = reportedScanProgress(state);
    const detail =
      // BE가 진척을 말해 주면 그것이 가장 좋은 답이다 — 오래 걸리는 중에도 "어디까지 왔는지"가 "오래 걸린다"보다 낫다.
      scan !== null
        ? scan.currentChain !== null
          ? `체인 ${scan.totalChainCount}곳 중 ${scan.scannedChainCount}곳 · ${scan.currentChain.chainName} 조회 중`
          : scan.scannedChainCount === scan.totalChainCount
            ? `체인 ${scan.totalChainCount}곳 조회 끝 · 정리하는 중`
            : (scan.note ?? `체인 ${scan.totalChainCount}곳 중 ${scan.scannedChainCount}곳 완료`)
        : // 진척을 모를 때: 오래 걸린다는 사실이 침묵보다 낫다. 침묵하면 사용자는 멈췄다고 읽는다.
          elapsedMs >= SLOW_IMPORT_CHIP_MS
          ? "거래가 많아 조회가 지연되고 있습니다."
          : `체인 ${chains.length}개 네트워크 조회 중`;

    return (
      <>
        <ChipShell role="status">
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-3 rounded-card bg-primary-50 px-3.5 py-2.5 text-left"
            onClick={() => setSheetOpen(true)}
          >
            <ProgressRing fraction={scan === null ? null : scan.scannedChainCount / scan.totalChainCount} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-primary-600">새 지갑 거래 불러오는 중</span>
              <span className="block truncate text-[13px] text-zinc-700">{detail}</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-primary-500" />
          </button>
        </ChipShell>
        <ImportProgressSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          chains={chains}
          progress={sheetProgress}
          walletAddress={state.walletAddress}
          elapsedMs={elapsedMs}
        />
      </>
    );
  }

  if (state.status === "lost") {
    return (
      <ChipShell role="alert">
        <AlertChip
          tone="amber"
          title="거래 조회 상태 확인 불가"
          // 무엇이 됐는지 모른다는 사실을 그대로 말한다. "실패했어요"는 하지 않은 단정이다.
          detail="잠시 후 다시 확인해 주세요."
          actionLabel="다시 불러오기"
          onAction={retry}
        />
      </ChipShell>
    );
  }

  const partial = state.errorCode === PARTIAL_IMPORT_CODE;
  const skippedLabel =
    skipped.length === 0
      ? "일부 체인"
      : skipped.length === 1
        ? chainLabel(skipped[0])
        : `${chainLabel(skipped[0])} 외 ${skipped.length - 1}곳`;

  return (
    <ChipShell role="alert">
      <AlertChip
        tone="red"
        title={partial ? `${skippedLabel} 거래 조회 실패` : "거래 조회 실패"}
        // 부분 실패에서 들어온 만큼은 진짜 원장에 남았다. 그 사실을 빼면 사용자는 전부 실패했다고 읽는다.
        detail={partial ? `나머지 ${chains.length - skipped.length}곳 ${reportedEventCount(state.result)}건 반영 완료` : null}
        actionLabel="다시 시도"
        onAction={retry}
      />
    </ChipShell>
  );
}

/** 칩이 앉는 자리. 스크롤을 내려도 따라오되, 아래 본문이 비쳐 보이지 않게 바탕을 덮는다. */
function ChipShell({ role, children }: { role: "status" | "alert"; children: ReactNode }) {
  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className="sticky top-0 z-30 bg-canvas/95 px-5 pb-2 pt-3 backdrop-blur-sm"
      data-surface="import-status-chip"
    >
      {children}
    </div>
  );
}

function AlertChip({
  tone,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  tone: "red" | "amber";
  title: string;
  detail: string | null;
  actionLabel: string;
  onAction: () => void;
}) {
  const surface = tone === "red" ? "bg-red-50" : "bg-amber-50";
  const icon = tone === "red" ? "text-red-600" : "text-amber-600";
  const heading = tone === "red" ? "text-red-700" : "text-amber-800";
  const action = tone === "red" ? "text-red-600" : "text-amber-700";
  return (
    <div className={`flex min-h-11 items-center gap-3 rounded-card px-3.5 py-2.5 ${surface}`}>
      {/* 색만으로 구분하지 않는다 — 모양(경고 마크)과 글자가 같은 사실을 반복한다. */}
      <AlertCircle aria-hidden="true" className={`size-5 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${heading}`}>{title}</p>
        {detail !== null ? <p className="text-[13px] text-zinc-700">{detail}</p> : null}
      </div>
      <button type="button" className={`shrink-0 px-1 py-2 text-sm font-bold ${action}`} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

/**
 * 조회를 마친 체인 비율. 옆의 글자가 같은 사실을 말하므로 이 원은 장식이다.
 *
 * `fraction`이 null이면 진척을 모르는 것이다. 0%로 멈춘 원은 "아무 것도 안 끝났다"는 **주장**이 되므로
 * 그때는 도는 원을 쓴다 — 진행률이 아니라 살아 있다는 사실만 말한다.
 */
function ProgressRing({ fraction }: { fraction: number | null }) {
  const radius = 9;
  if (fraction === null) {
    return (
      <svg
        viewBox="0 0 24 24"
        data-progress-ring="indeterminate"
        className="size-6 shrink-0 animate-spin text-primary-500 motion-reduce:animate-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r={radius} className="opacity-20" />
        <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
      </svg>
    );
  }
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(1, Math.max(0, fraction));
  return (
    <svg viewBox="0 0 24 24" data-progress-ring="determinate" className="size-6 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="2.5" className="stroke-primary-200" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary-500 transition-[stroke-dashoffset] duration-500 ease-out"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
      />
    </svg>
  );
}

/**
 * 진행 시트. 모달과 같은 체인 목록을 쓰지만 여기엔 취소도 백그라운드도 없다 —
 * 이 창은 상태를 보여줄 뿐이고 불러오기는 창과 무관하게 끝까지 간다.
 *
 * **BE가 보고한 진행만 넘긴다.** 연출 타이머를 물리면 칩이 "불러오는 중"이라 말하는 동안
 * 시트는 모든 체인을 "완료"로 그린다 — 한 앱이 두 이야기를 하는 셈이다. 보고가 없으면(구 BE) 모른다고 그린다.
 */
function ImportProgressSheet({
  open,
  onClose,
  chains,
  progress,
  walletAddress,
  elapsedMs,
}: {
  open: boolean;
  onClose: () => void;
  chains: ComponentProps<typeof ImportChainList>["chains"];
  progress: ImportProgress | null;
  walletAddress: string | null;
  elapsedMs: number;
}) {
  if (!open) return null;
  const started = importStartedLabel(elapsedMs);
  return (
    <BottomSheet open onClose={onClose} title="거래 불러오는 중">
      <h2 className="text-lg font-bold text-zinc-900">거래 불러오는 중</h2>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {walletAddress !== null ? <span className="font-mono">{shortHash(walletAddress)}</span> : null}
        {started !== null ? <span>{started}</span> : null}
      </p>
      <div className="mt-4">
        <ImportProgressBar progress={progress} />
      </div>
      <div className="mt-4">
        <ImportChainList chains={chains} progress={progress} />
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-400">
        창을 닫아도 거래 조회는 계속됩니다. 완료되면 알림이 표시됩니다.
      </p>
      <button type="button" className="mt-4 w-full rounded-xl bg-zinc-100 py-3.5 font-semibold text-zinc-700" onClick={onClose}>
        닫기
      </button>
    </BottomSheet>
  );
}
