"use client";

import { useEffect, useRef, useState } from "react";
import { ChainIcon } from "@/components/ui/chain-icon";
import { shortHash } from "@/lib/format";
import type { WalletChain } from "@/lib/wallet/holdings";
import {
  IMPORT_STEPS,
  IMPORT_TICK_MS,
  SCAN_STEP_INDEX,
  SLOW_IMPORT_MS,
  chainScanState,
  importProgressPercent,
  mockProgressAt,
  stepState,
  type ChainScanState,
  type ImportProgress,
} from "@/lib/wallet/import-progress";

/**
 * 지갑 연결 직후 대시보드 위에 뜨는 "거래 불러오는 중" 모달.
 *
 * 진행을 **만들지 않고 받기만 한다.** 지금은 호출부가 `useMockImportProgress`로 시간 기반 진행을 물리지만,
 * BE 동기화 상태가 생기면 이 컴포넌트를 고치지 않고 그 상태를 넘기면 된다.
 *
 * 닫기 버튼도 오버레이 클릭 닫기도 없다 — 진행 중 "닫기"는 취소로 읽히는데, 실제로 동기화가 취소되지는 않는다.
 * 대신 사용자가 기다리지 않을 자유는 `onBackground`("백그라운드에서 계속")로 준다.
 * 완전히 막아두면 오래 걸릴 때 사용자가 할 수 있는 일이 창을 닫는 것뿐이다.
 */

const FOCUSABLE = 'a[href],button:not([disabled]),select,input,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * 퍼블리싱용 진행 생성기. 실제 동기화 상태가 생기면 이 훅을 그 조회 훅으로 교체한다.
 * `active`가 false로 내려가면 경과가 0으로 돌아가, 재시도가 이전 진행을 물려받지 않는다.
 */
export function useMockImportProgress(active: boolean, chainCount: number): ImportProgress {
  const [elapsedMs, setElapsedMs] = useState(0);
  // active 토글은 새 불러오기의 시작이다. 이전 경과를 물려받으면 재시도가 중간부터 시작한 것처럼 보인다.
  // effect가 아니라 렌더 중에 맞춘다 — effect에서 setState하면 한 프레임 동안 옛 경과가 그려진다.
  const [tracking, setTracking] = useState(active);
  if (tracking !== active) {
    setTracking(active);
    setElapsedMs(0);
  }

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), IMPORT_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return mockProgressAt(elapsedMs, chainCount);
}

type ImportProgressModalProps = {
  open: boolean;
  progress: ImportProgress;
  walletAddress: string;
  /** 자산이 있어 실제로 훑을 체인. 순서가 곧 조회 순서라 `progress.scannedChainCount`와 짝이 맞아야 한다. */
  chains: WalletChain[];
  /** 기다리지 않고 대시보드를 쓰게 한다. 동기화를 멈추는 것이 아니다. */
  onBackground: () => void;
  /** 실패 상태에서만 노출된다. */
  onRetry?: () => void;
};

export function ImportProgressModal({
  open,
  progress,
  walletAddress,
  chains,
  onBackground,
  onRetry,
}: ImportProgressModalProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const restoreFocus = document.activeElement as HTMLElement | null;
    // 열릴 때 포커스를 안으로 옮기지 않으면 키보드·스크린리더 사용자는 뒤 대시보드에 갇힌 채 모달을 못 읽는다.
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(nativeEvent: KeyboardEvent) {
      // Esc는 취소가 아니라 "백그라운드로". 진행 중 동기화를 되돌릴 수단이 없으므로 취소인 척하지 않는다.
      if (nativeEvent.key === "Escape") {
        nativeEvent.stopPropagation();
        onBackground();
        return;
      }
      if (nativeEvent.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (nativeEvent.shiftKey && (active === first || !panel.contains(active))) {
        nativeEvent.preventDefault();
        last.focus();
      } else if (!nativeEvent.shiftKey && active === last) {
        nativeEvent.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      restoreFocus?.focus?.();
    };
  }, [open, onBackground]);

  if (!open) return null;

  const failed = progress.phase === "failed";
  const done = progress.phase === "done";
  const slow = progress.phase === "running" && progress.elapsedMs >= SLOW_IMPORT_MS;
  const currentStep = IMPORT_STEPS[Math.min(progress.stepIndex, IMPORT_STEPS.length - 1)];
  const heading = failed ? "거래를 다 불러오지 못했습니다" : done ? "거래를 불러왔습니다" : "거래를 불러오는 중";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      {/* 배경은 가리기만 한다. 클릭해도 닫히지 않는다 — 진행 중 실수로 닫는 것을 막는다. */}
      <div aria-hidden="true" className="absolute inset-0 bg-zinc-900/45" />
      <section
        aria-labelledby="import-progress-title"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-card bg-white px-6 pb-6 pt-7 shadow-card"
        data-surface="import-progress"
        ref={panelRef}
        role="dialog"
      >
        <div className="flex flex-col items-center text-center">
          <StatusMark failed={failed} done={done} />
          <h2 id="import-progress-title" className="mt-4 text-lg font-bold text-zinc-900">
            {heading}
          </h2>
          <p className="mt-1.5 font-mono text-xs text-zinc-500">{shortHash(walletAddress)}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {/* 왜 이 체인들인지 한 줄로 말한다 — 스캔 대상이 임의로 정해진 게 아니다. */}
            자산이 있는 EVM 체인 {chains.length}곳
          </p>
        </div>

        {/* 체인별 조회 상태. 아이콘은 aria-hidden이라 이름과 상태 글자가 같은 사실을 반복한다. */}
        <ul className="mt-4 space-y-2 rounded-xl bg-zinc-50 px-3 py-2.5" aria-label="조회할 체인">
          {chains.map((chain, index) => {
            const state = chainScanState(progress, index);
            return (
              <li key={chain.chainId} className="flex items-center gap-2">
                <ChainIcon chainId={chain.chainId} size={18} />
                <span className={`text-sm font-semibold ${state === "pending" ? "text-zinc-400" : "text-zinc-900"}`}>
                  {chain.chainName}
                </span>
                <span className="text-xs text-zinc-400">자산 {chain.assetCount}건</span>
                <span className="ml-auto">
                  <ChainScanMark state={state} />
                </span>
              </li>
            );
          })}
        </ul>

        {/* 막대는 단계 수에서 나온 값이라 실제 상태를 꽂아도 그대로 맞는다. 색만으로 말하지 않도록 아래 목록이 같은 사실을 글자로 반복한다. */}
        <div aria-hidden="true" className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? "bg-red-400" : "bg-primary-500"}`}
            style={{ width: `${importProgressPercent(progress)}%` }}
          />
        </div>

        <ol className="mt-5 space-y-3" aria-label="불러오기 진행 단계">
          {IMPORT_STEPS.map((step, index) => {
            const state = stepState(progress, index);
            return (
              <li key={step.id} className="flex items-start gap-3">
                <StepMark state={state} />
                <div className="min-w-0">
                  <p
                    className={`text-sm font-semibold ${
                      state === "pending" ? "text-zinc-400" : state === "failed" ? "text-red-700" : "text-zinc-900"
                    }`}
                  >
                    {step.label}
                  </p>
                  {state === "running" ? <p className="mt-0.5 text-xs text-zinc-500">{step.runningText}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>

        {/* 진행 상황을 스크린리더에 한 줄로 전한다. 목록 전체를 live로 두면 단계마다 네 줄이 다시 읽힌다. */}
        <p className="sr-only" aria-live="polite">
          {failed
            ? `${currentStep.label} 단계에서 실패했습니다.`
            : done
              ? "거래를 모두 불러왔습니다."
              : progress.stepIndex === SCAN_STEP_INDEX
                ? // 조회 단계에서는 "몇 번째 체인인지"가 곧 진척이다. 단계 이름만 읽으면 멈춘 것처럼 들린다.
                  `${currentStep.label} — 체인 ${chains.length}곳 중 ${progress.scannedChainCount}곳 완료`
                : `${currentStep.label} — ${currentStep.runningText}`}
        </p>

        {slow ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
            거래가 많아 시간이 걸리고 있습니다. 기다리지 않아도 되며, 완료되면 대시보드에 자동으로 표시됩니다.
          </p>
        ) : null}

        {failed ? (
          <>
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">
              불러온 만큼만 대시보드에 표시됩니다. 다시 시도하면 남은 거래를 이어서 가져옵니다.
            </p>
            {onRetry ? (
              <button
                className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
                onClick={onRetry}
                type="button"
              >
                다시 시도
              </button>
            ) : null}
            <button
              className="mt-2 w-full rounded-xl py-3 text-sm font-semibold text-zinc-500"
              onClick={onBackground}
              type="button"
            >
              불러온 거래만 보기
            </button>
          </>
        ) : done ? (
          // 끝난 뒤에도 "계속됩니다"가 남으면 화면이 사실과 다른 말을 한다. 남은 일은 비켜나는 것뿐이다.
          <p className="mt-4 text-center text-xs leading-5 text-zinc-400">대시보드로 이동합니다.</p>
        ) : (
          <>
            <p className="mt-4 text-center text-xs leading-5 text-zinc-400">창을 닫아도 불러오기는 계속됩니다.</p>
            <button
              className="mt-2 w-full rounded-xl py-3 text-sm font-semibold text-primary-600"
              onClick={onBackground}
              type="button"
            >
              백그라운드에서 계속
            </button>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * 체인 한 줄의 조회 상태. 아이콘이 아니라 **글자**로 말한다 —
 * 체인 마크가 이미 옆에 있어서 표식을 또 그리면 두 원이 무엇을 뜻하는지 헷갈린다.
 */
function ChainScanMark({ state }: { state: ChainScanState }) {
  if (state === "done") return <span className="text-xs font-semibold text-primary-600">완료</span>;
  if (state === "failed") return <span className="text-xs font-semibold text-red-700">실패</span>;
  if (state === "scanning") return <span className="text-xs font-semibold text-zinc-600">조회 중</span>;
  return <span className="text-xs text-zinc-400">대기</span>;
}

/** 모달 머리의 큰 상태 표시. 진행·완료·실패를 모양으로 구분한다(색만으로 구분하지 않는다). */
function StatusMark({ failed, done }: { failed: boolean; done: boolean }) {
  if (failed) {
    return (
      <span className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5m0 3.5h.01" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
    );
  }
  if (done) {
    return (
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-primary-50" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-6 animate-spin text-primary-500" fill="none" stroke="currentColor" strokeWidth="2.4">
        <circle cx="12" cy="12" r="9" className="opacity-20" />
        <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 단계 앞의 작은 표식. 아이콘은 장식이고 상태는 옆 글자와 sr-only 텍스트가 말한다. */
function StepMark({ state }: { state: ReturnType<typeof stepState> }) {
  if (state === "done") {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.2">
          <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.2">
          <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-5 animate-spin text-primary-500" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="9" className="opacity-20" />
          <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <span className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-zinc-200" aria-hidden="true" />;
}
