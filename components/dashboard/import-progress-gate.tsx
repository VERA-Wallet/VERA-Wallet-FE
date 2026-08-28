"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImportProgressModal, useMockImportProgress } from "@/components/wallet/import-progress-modal";
import { chainLabel } from "@/lib/format";
import {
  EVM_CHAIN_IDS,
  IMPORT_DONE_HOLD_MS,
  IMPORT_STEPS,
  type ImportProgress,
  type ScanChain,
} from "@/lib/wallet/import-progress";
import { runImportSync, type ImportSyncResult } from "@/lib/wallet/import-sync";

/**
 * 시작 시점의 스캔 대상. BE 인덱서는 지원 체인 전체를 스캔하므로 목록도 전체를 보여준다 —
 * "자산이 있는 체인만"은 응답이 오기 전에는 알 수 없는 사실이라 미리 주장하지 않는다.
 */
const INITIAL_CHAINS: ScanChain[] = EVM_CHAIN_IDS.map((chainId) => ({ chainId, chainName: chainLabel(chainId) }));

type SyncState =
  | { status: "pending" }
  | { status: "done"; result: ImportSyncResult }
  | { status: "failed" };

/**
 * `/dashboard?importing=1`로 들어왔을 때만 불러오기 모달을 띄우고, 끝나면 스스로 걷어낸다.
 *
 * 단계 애니메이션은 연출(타이머)이지만 **완료·실패는 실제 `POST /api/events/resync` 응답에서만 나온다.**
 * 타이머가 먼저 끝나면 마지막 단계에서 응답을 기다리고, 응답이 먼저 오면 타이머가 끝나는 대로 완료를 표시한다.
 * 응답의 체인별 수집 건수(`chains`)가 목록의 최종 사실이다.
 *
 * 모달 상태를 `DashboardView`에 넣지 않는 이유: 대시보드 본문은 불러오기와 아무 관계가 없고,
 * 거기에 라우터 의존을 심으면 대시보드를 렌더하는 모든 테스트가 라우터 컨텍스트를 요구하게 된다.
 * 진입 여부는 서버(`app/dashboard/page.tsx`)가 `searchParams`로 판정해 이 컴포넌트를 아예 렌더하지 않으므로,
 * 여기서는 `useSearchParams`를 쓰지 않는다 — Suspense 경계도 필요 없다.
 *
 * 닫을 때 `replace`로 쿼리를 지운다. `push`면 뒤로가기가 방금 끝난 불러오기 화면을 되살린다.
 * `returnTo`가 닫힘 목적지다 — 온보딩은 대시보드, 지갑 탭 추가는 왔던 지갑 탭으로 돌아가야 한다.
 */
export function ImportProgressGate({ walletAddress, returnTo = "/dashboard" }: { walletAddress: string; returnTo?: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: "pending" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // pending 재설정을 여기서 하지 않는다 — effect 본문의 동기 setState는 연쇄 렌더를 만든다.
    // 초기값이 이미 pending이고, 재시도는 onRetry가 attempt 증가와 함께 pending으로 되돌린다.
    runImportSync().then(
      (result) => { if (!cancelled) setSync({ status: "done", result }); },
      () => { if (!cancelled) setSync({ status: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  // 응답이 오면 체인 목록이 사실(수집 건수)로 바뀐다. 그 전에는 지원 체인 전체를 건수 없이 보여준다.
  const chains = useMemo<ScanChain[]>(() => {
    if (sync.status !== "done") return INITIAL_CHAINS;
    return sync.result.chains.map((chain) => ({ chainId: chain.chainId, chainName: chainLabel(chain.chainId), txCount: chain.fetched }));
  }, [sync]);

  // 연출 타이머. 완료 판정은 아래 합성에서 실제 응답과 AND로 묶인다.
  const timer = useMockImportProgress(!dismissed, chains.length);
  const progress: ImportProgress = useMemo(() => {
    // 실패는 실제 응답에서만 나온다 — 타이머는 실패를 만들 수 없다.
    if (sync.status === "failed") {
      return { ...timer, phase: "failed", stepIndex: Math.min(timer.stepIndex, IMPORT_STEPS.length - 1) };
    }
    // 타이머가 먼저 끝났는데 동기화가 진행 중이면 마지막 단계에서 기다린다. 완료를 연기하는 것이지 속이는 것이 아니다.
    if (sync.status === "pending" && timer.phase === "done") {
      return { phase: "running", stepIndex: IMPORT_STEPS.length - 1, elapsedMs: timer.elapsedMs, scannedChainCount: chains.length };
    }
    return timer;
  }, [sync.status, timer, chains.length]);

  // 완료 표시를 잠깐 보여준 뒤 스스로 닫는다. 사용자가 버튼을 눌러야 사라지면
  // 자리를 비운 사이 끝난 불러오기가 대시보드를 계속 가린다.
  useEffect(() => {
    if (dismissed || progress.phase !== "done") return;
    const timeout = window.setTimeout(() => {
      setDismissed(true);
      router.replace(returnTo);
    }, IMPORT_DONE_HOLD_MS);
    return () => window.clearTimeout(timeout);
  }, [dismissed, progress.phase, router, returnTo]);

  return (
    <ImportProgressModal
      open={!dismissed}
      progress={progress}
      walletAddress={walletAddress}
      chains={chains}
      onBackground={() => {
        setDismissed(true);
        router.replace(returnTo);
      }}
      onRetry={() => {
        // 재시도는 실패 표시를 즉시 걷고 pending으로 돌아가야 한다. effect가 아니라 사용자
        // 이벤트에서 상태를 바꾸므로 연쇄 렌더가 생기지 않는다.
        setSync({ status: "pending" });
        setAttempt((previous) => previous + 1);
      }}
    />
  );
}
