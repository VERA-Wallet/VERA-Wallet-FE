"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { eventQueryKey, eventSummaryQueryKey } from "@/lib/queries/events";
import { holdingsQueryKey } from "@/lib/queries/holdings";
import { IMPORT_TICK_MS } from "@/lib/wallet/import-progress";
import {
  IDLE_IMPORT_TRACKER_STATE,
  clearStoredImportJob,
  isPartialImport,
  readStoredImportJob,
  writeStoredImportJob,
  type ImportTrackerState,
} from "@/lib/wallet/import-tracker";
import { ImportSyncError, resumeImportSync, runImportSync, type ImportSyncJob } from "@/lib/wallet/import-sync";

/**
 * 불러오기 폴링을 **앱 껍데기가 소유한다.** 모달·칩·시트·토스트는 여기 상태를 구독만 한다.
 *
 * 이전에는 모달 컴포넌트가 `runImportSync`를 effect에서 돌렸다. "백그라운드에서 계속"으로 모달을 걷으면
 * effect 정리가 폴링을 끊었고, 완료 시점에만 할 수 있는 캐시 무효화가 영영 일어나지 않았다 —
 * BE는 새 거래를 다 넣어 뒀는데 대시보드는 staleTime(1분) 동안 옛 원장을 보여줬다.
 *
 * 그래서 화면이 닫히는 것은 **폴링을 멈출 이유가 아니다.** 멈추는 경우는 셋뿐이다:
 * 프로바이더 언마운트(앱이 사라짐), 재시도(옛 작업을 버리고 새로 접수), 명시적 `clear`.
 */

/** 결과는 왔지만 일부가 빠진 상태. BE 오류 코드가 아니라 이 화면이 붙이는 이름이다. */
export const PARTIAL_IMPORT_CODE = "partial_sync";

/** "새로 들어온 거래" 마커가 의미를 갖는 화면. 여기를 떠나는 순간이 마커를 걷는 경계다. */
const LEDGER_PATH = "/transactions";

export type ImportTracker = {
  state: ImportTrackerState;
  /** 지갑 등록 직후 불러오기를 접수한다. 이미 돌고 있으면 아무 일도 하지 않는다. */
  start: (walletAddress: string) => void;
  /** 실패·유실에서 새 작업을 접수한다. 옛 작업은 버린다. */
  retry: () => void;
  /** 완료 토스트만 걷는다. "새로 들어온 거래" 마커는 살아남는다. */
  dismissToast: () => void;
  /** 마커를 해제한다. 사용자가 원장을 한 번 본 뒤에는 더 이상 새 거래가 아니다. */
  acknowledgeNew: () => void;
  /** 어떤 상태든 처음으로 되돌린다. */
  clear: () => void;
  /** 불러오기 모달이 떠 있는가. 떠 있으면 같은 사실을 칩으로 겹쳐 말하지 않는다. */
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
};

const NOOP_TRACKER: ImportTracker = {
  state: IDLE_IMPORT_TRACKER_STATE,
  start: () => undefined,
  retry: () => undefined,
  dismissToast: () => undefined,
  acknowledgeNew: () => undefined,
  clear: () => undefined,
  modalOpen: false,
  setModalOpen: () => undefined,
};

/**
 * 프로바이더가 없으면 **아무 불러오기도 진행 중이 아닌** 상태로 읽힌다. 던지지 않는 이유:
 * 대시보드·거래 목록은 불러오기와 무관하게 혼자 렌더될 수 있어야 하고,
 * "트래커가 없다"는 것은 오류가 아니라 진행 중인 작업이 없다는 뜻이기 때문이다.
 */
const ImportTrackerContext = createContext<ImportTracker>(NOOP_TRACKER);

export function useImportTracker(): ImportTracker {
  return useContext(ImportTrackerContext);
}

/** 취소는 실패가 아니다 — 프로바이더가 사라지는 중이라 그 상태를 볼 화면도 없다. */
function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

/**
 * 지금 캐시에 성공적으로 담겨 있는 원장의 이벤트 id.
 *
 * 실패했거나 한 번도 받지 못한 조회는 세지 않는다 — 못 받은 목록을 빈 원장으로 읽으면
 * 끝난 뒤에 "아무 것도 새로 오지 않았다"고 단정하게 된다. 그런 경우 null을 돌려주고 판단을 미룬다.
 */
function snapshotEventIds(queryClient: QueryClient): string[] | null {
  const entries = queryClient.getQueryCache().findAll({ queryKey: eventQueryKey });
  const ids: string[] = [];
  let loaded = false;
  for (const entry of entries) {
    const data = entry.state.data as { items?: { event: { id: string } }[] } | undefined;
    if (entry.state.status !== "success" || !data?.items) continue;
    loaded = true;
    for (const item of data.items) ids.push(item.event.id);
  }
  return loaded ? ids : null;
}

export function ImportTrackerProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ImportTrackerState>(IDLE_IMPORT_TRACKER_STATE);
  const [modalOpen, setModalOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** 폴링 루프가 지금 돌고 있는가. start를 두 번 불러도 작업을 두 번 접수하지 않게 하는 자물쇠다. */
  const activeRef = useRef(false);
  /** 세대. 재시도로 버린 옛 작업의 응답이 뒤늦게 도착해 화면을 되돌리는 일을 막는다. */
  const generationRef = useRef(0);
  const walletRef = useRef<string | null>(null);
  /** 시작 시점의 원장. 끝난 뒤 다시 받은 목록에서 이 집합에 없는 것이 새 거래다. */
  const knownIdsRef = useRef<Set<string>>(new Set());

  /**
   * 무엇이 새로 들어왔는지를 **다시 받은 목록에서** 센다.
   *
   * 작업이 보고한 건수를 쓰지 않는 이유: 읽기 경로의 첫 동기화가 이미 원장을 채운 뒤 우리 resync가 돌면
   * 작업은 0건을 돌려준다. 그 숫자를 믿으면 화면에 수십 줄이 보이는데도 "새로 불러온 거래가 없어요"라고 말한다.
   *
   * `type: "all"`로 다시 받는 이유: 사용자가 모달을 걷고 다른 탭에 가 있으면 원장 조회에 구독자가 없어
   * 무효화만으로는 아무것도 다시 받지 않는다 — 그러면 끝난 뒤에도 옛 목록과 비교하게 된다.
   */
  const countNewEvents = useCallback(
    async (generation: number) => {
      const known = knownIdsRef.current;
      let ids: string[] | null = null;
      try {
        await queryClient.refetchQueries({ queryKey: eventQueryKey, type: "all" });
        ids = snapshotEventIds(queryClient);
      } catch {
        // 목록을 못 받았다. 세지 못했다는 사실을 null로 남기면 토스트가 작업의 숫자로 물러난다.
        ids = null;
      }
      if (generationRef.current !== generation) return;
      setState((previous) => ({
        ...previous,
        countingNew: false,
        newEventIds: ids === null ? null : [...new Set(ids)].filter((id) => !known.has(id)),
      }));
    },
    [queryClient],
  );

  const begin = useCallback(
    (walletAddress: string, resume: { jobId: string; startedAt: number } | null) => {
      // 루프는 하나뿐이다. 모달과 지갑 탭이 동시에 start를 불러도 인덱서를 두 번 돌리지 않는다.
      if (activeRef.current) return;
      activeRef.current = true;
      generationRef.current += 1;
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      const controller = new AbortController();
      abortRef.current = controller;
      walletRef.current = walletAddress;
      const startedAt = resume?.startedAt ?? Date.now();
      // **시작 시점의** 원장을 찍는다. 끝난 뒤에 찍으면 이미 새 거래가 섞여 들어와 무엇이 원래 있던 것인지 알 수 없다.
      // 목록을 본 적이 없으면 빈 원장으로 본다 — 첫 지갑에서는 그 뒤에 나타나는 모든 거래가 실제로 새 거래다.
      const knownEventIds = snapshotEventIds(queryClient) ?? [];
      knownIdsRef.current = new Set(knownEventIds);

      setState({
        ...IDLE_IMPORT_TRACKER_STATE,
        status: "running",
        walletAddress,
        startedAt,
        jobId: resume?.jobId ?? null,
        knownEventIds,
      });

      const onJob = (job: ImportSyncJob) => {
        if (!isCurrent()) return;
        // jobId를 처음 아는 지점. 여기서 남겨야 새로고침이 같은 작업을 이어받는다 — 다시 접수하면 작업이 하나 더 생긴다.
        writeStoredImportJob({ jobId: job.jobId, startedAt, walletAddress });
        setState((previous) => (previous.status === "running" ? { ...previous, jobId: job.jobId, job } : previous));
      };

      const settled = resume
        ? resumeImportSync(resume.jobId, { signal: controller.signal, onJob })
        : runImportSync({ signal: controller.signal, onJob });

      settled.then(
        (result) => {
          activeRef.current = false;
          if (!isCurrent()) return;
          clearStoredImportJob();
          const partial = isPartialImport(result);
          setState((previous) => ({
            ...previous,
            status: partial ? "failed" : "done",
            result,
            errorCode: partial ? PARTIAL_IMPORT_CODE : null,
            completedAt: Date.now(),
            newEventIds: null,
            countingNew: true,
            toastDismissed: false,
          }));
          // 새 거래가 들어왔다는 사실은 여기서만 안다. 캐시(staleTime)에 맡기면 화면이 1분 동안 옛 원장을 보인다.
          // 부분 실패에서도 갱신한다 — 들어온 만큼은 진짜로 원장에 남았다.
          // 원장만 `refetchType: "none"`인 이유: 바로 아래에서 한 번 다시 받으므로, 여기서 또 받으면 왕복이 두 번이 된다.
          void queryClient.invalidateQueries({ queryKey: eventQueryKey, refetchType: "none" });
          void queryClient.invalidateQueries({ queryKey: eventSummaryQueryKey });
          void queryClient.invalidateQueries({ queryKey: ["tax", "estimate"] });
          // 원장이 바뀌면 보유 자산의 취득원가도 바뀐다. 잔액 자체는 온체인 사실이라 그대로지만 costStatus가 partial → ready로 갈 수 있다.
          void queryClient.invalidateQueries({ queryKey: holdingsQueryKey });
          void countNewEvents(generation);
        },
        (error: unknown) => {
          activeRef.current = false;
          if (!isCurrent() || isAbort(error)) return;
          clearStoredImportJob();
          const code = error instanceof ImportSyncError ? error.code : "sync_failed";
          // 로그아웃(401)은 실패가 아니라 이 세션에 더 물어볼 것이 없다는 뜻이다 — 조용히 접는다.
          if (code === "http_401") {
            setState(IDLE_IMPORT_TRACKER_STATE);
            return;
          }
          setState((previous) => ({
            ...previous,
            // 작업이 사라진 것(BE 재시작)은 실패와 다르다 — 무엇이 됐는지 모른다는 뜻이라 문구도 달라야 한다.
            status: code === "job_lost" ? "lost" : "failed",
            errorCode: code,
            completedAt: Date.now(),
          }));
        },
      );
    },
    [countNewEvents, queryClient],
  );

  const start = useCallback((walletAddress: string) => begin(walletAddress, null), [begin]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    // 동기로 푼다. 정리 직후 새 작업을 시작할 수 있어야 하는데, 거절 콜백은 마이크로태스크 뒤에 온다.
    activeRef.current = false;
    generationRef.current += 1;
  }, []);

  const retry = useCallback(() => {
    const walletAddress = walletRef.current;
    if (walletAddress === null) return;
    stop();
    clearStoredImportJob();
    begin(walletAddress, null);
  }, [begin, stop]);

  const clear = useCallback(() => {
    stop();
    clearStoredImportJob();
    setState(IDLE_IMPORT_TRACKER_STATE);
  }, [stop]);

  const dismissToast = useCallback(() => {
    setState((previous) => (previous.toastDismissed ? previous : { ...previous, toastDismissed: true }));
  }, []);

  const acknowledgeNew = useCallback(() => {
    setState((previous) =>
      previous.newEventIds === null && previous.knownEventIds === null
        ? previous
        : { ...previous, newEventIds: null, knownEventIds: null },
    );
  }, []);

  /**
   * 원장을 한 번 보고 나면 더 이상 "새로 들어온" 거래가 아니다. 그 경계는 **원장을 떠나는 순간**이다.
   *
   * 이 판단을 대시보드의 effect 정리(cleanup)에 두면 안 된다: 개발 모드의 StrictMode는 첫 마운트를
   * 마운트 → 정리 → 마운트로 돌리므로, 정리가 곧바로 실행돼 화면에 닿기도 전에 마커가 지워진다.
   * "떠났다"는 사실은 컴포넌트 수명이 아니라 **경로 변화**에만 있다.
   *
   * effect가 아니라 렌더 중에 맞춘다 — effect 본문에서 상태를 바꾸면 연쇄 렌더가 생기고,
   * 마커를 단 한 프레임이라도 늦게 걷으면 떠나는 화면에 그 사실이 잠깐 남는다.
   * 같은 경로로 다시 렌더되는 것은(StrictMode 이중 실행 포함) 이동이 아니라 아무 일도 아니다.
   */
  const pathname = usePathname();
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (trackedPath !== pathname) {
    setTrackedPath(pathname);
    const leftLedger =
      trackedPath !== null && trackedPath.startsWith(LEDGER_PATH) && !(pathname ?? "").startsWith(LEDGER_PATH);
    if (leftLedger) acknowledgeNew();
  }

  // 새로고침·탭 전환으로 화면이 갈아엎혀도 진행 중이던 작업을 되찾는다. 접수를 다시 하지 않는 것이 핵심이다.
  useEffect(() => {
    const stored = readStoredImportJob();
    if (stored === null) return;
    begin(stored.walletAddress, { jobId: stored.jobId, startedAt: stored.startedAt });
  }, [begin]);

  // 폴링이 저절로 끝나는 유일한 경로. 앱이 사라지는 순간이라 더 물어볼 곳도, 알려줄 화면도 없다.
  useEffect(() => stop, [stop]);

  const value = useMemo<ImportTracker>(
    () => ({ state, start, retry, dismissToast, acknowledgeNew, clear, modalOpen, setModalOpen }),
    [state, start, retry, dismissToast, acknowledgeNew, clear, modalOpen],
  );

  return <ImportTrackerContext.Provider value={value}>{children}</ImportTrackerContext.Provider>;
}

/**
 * 시작 시각에서 흐르는 경과 시간. 컴포넌트마다 자기 틱을 도는 이유:
 * 경과를 트래커 상태에 넣으면 100ms마다 앱 전체가 다시 렌더된다 — 불러오기와 무관한 화면까지.
 */
export function useImportElapsed(startedAt: number | null, tickMs: number = IMPORT_TICK_MS): number {
  const [now, setNow] = useState(startedAt ?? 0);
  // 시작 시각이 바뀌면 새 불러오기다(재시도 포함). effect에서 맞추면 한 프레임 동안 옛 경과가 그려지므로
  // 렌더 중에 되돌린다 — 이전 진행을 물려받은 재시도는 중간부터 시작한 것처럼 보인다.
  const [tracked, setTracked] = useState(startedAt);
  if (tracked !== startedAt) {
    setTracked(startedAt);
    setNow(startedAt ?? 0);
  }

  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [startedAt, tickMs]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
