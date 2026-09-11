import "client-only";

import { chainLabel } from "@/lib/format";
import {
  EVM_CHAIN_IDS,
  IMPORT_STEPS,
  mockProgressAt,
  type ImportProgress,
  type ScanChain,
} from "@/lib/wallet/import-progress";
import type { ImportSyncJob, ImportSyncResult } from "@/lib/wallet/import-sync";

/**
 * 앱 전체가 공유하는 "지갑 거래 불러오기" 상태의 모델.
 *
 * **왜 앱 수준인가.** 불러오기는 지갑 등록이 시작시킨 서버 작업이지 한 화면의 사정이 아니다.
 * 폴링을 모달 컴포넌트가 쥐고 있으면 "백그라운드에서 계속"으로 모달을 걷는 순간 폴링이 끊기고,
 * 완료 시점에만 할 수 있는 일(원장·요약·세금 캐시 무효화)이 영영 일어나지 않는다.
 * 그러면 BE는 새 거래를 다 넣어 뒀는데 화면은 staleTime(1분) 동안 옛 원장을 보여준다.
 *
 * 그래서 진행은 **껍데기가 소유하고**(`ImportTrackerProvider`), 모달·칩·시트·토스트는 구독만 한다.
 * 화면이 닫히는 것은 폴링을 멈출 이유가 아니다 — 멈추는 것은 앱이 통째로 사라질 때뿐이다.
 *
 * 이 파일은 그 상태의 **모양과 파생값**만 정의한다(리액트 없음). 실제 폴링·저장은 프로바이더가 한다.
 */

/** 진행 중인 작업을 새로고침 너머로 잇는 자리. 탭을 닫으면 지워져야 하므로 local이 아니라 session이다. */
export const IMPORT_JOB_STORAGE_KEY = "verawallet.import-job";

/** 새로고침 뒤 이어받기에 필요한 최소 사실. 결과·진행은 다시 폴링해서 받으면 된다. */
export type StoredImportJob = {
  jobId: string;
  /** epoch ms. 경과 시간을 저장하지 않는 이유: 저장한 순간부터 거짓이 된다. */
  startedAt: number;
  walletAddress: string;
};

export type ImportTrackerStatus = "idle" | "running" | "done" | "failed" | "lost";

export type ImportTrackerState = {
  status: ImportTrackerStatus;
  /** 접수 응답이 오기 전에는 null이다 — 아직 작업 번호가 없다는 사실을 그대로 둔다. */
  jobId: string | null;
  startedAt: number | null;
  walletAddress: string | null;
  /** 마지막 작업 스냅샷. 진행 중 BE가 주는 사실은 이것뿐이다. */
  job: ImportSyncJob | null;
  /** 수집 결과. 부분 실패(skipped)여도 들어온 만큼은 사실이라 남긴다. */
  result: ImportSyncResult | null;
  /** BE `error.code` 또는 전송 상태(`http_503`·`job_lost`). */
  errorCode: string | null;
  completedAt: number | null;
  /**
   * 불러오기를 **시작할 때** 원장에 있던 이벤트 id. 시작 시점에 목록을 본 적이 없으면 빈 배열이다 —
   * 첫 지갑에서는 그 뒤에 나타나는 모든 거래가 실제로 새 거래이기 때문이다.
   */
  knownEventIds: string[] | null;
  /**
   * 끝난 뒤 다시 받은 원장에서 **처음 보는** id. 이것이 "무엇이 새로 들어왔는가"의 유일한 답이다.
   *
   * 작업이 보고한 건수를 쓰지 않는 이유: 읽기 경로의 첫 동기화가 이미 원장을 채운 뒤 우리 resync가 돌면
   * 작업은 `normalized: 0`을 돌려준다. 그 숫자를 믿으면 화면에 41줄이 보이는데도 "새로 불러온 거래가 없어요"라고 말한다.
   * 목록을 다시 받지 못했으면 null — 모른다는 뜻이고, 그때만 작업의 숫자로 물러난다.
   */
  newEventIds: string[] | null;
  /** 다시 받은 목록을 기다리는 중인가. 세는 동안 토스트를 띄우면 0건이라 말한 뒤 41건으로 뒤집힌다. */
  countingNew: boolean;
  /** 완료 토스트를 이미 걷었는가. 상태는 done으로 남겨 "새로 들어온 거래" 마커가 살아 있게 한다. */
  toastDismissed: boolean;
};

export const IDLE_IMPORT_TRACKER_STATE: ImportTrackerState = {
  status: "idle",
  jobId: null,
  startedAt: null,
  walletAddress: null,
  job: null,
  result: null,
  errorCode: null,
  completedAt: null,
  knownEventIds: null,
  newEventIds: null,
  countingNew: false,
  toastDismissed: false,
};

/**
 * 칩이 "오래 걸린다"고 먼저 말하기 시작하는 지점.
 * 모달(30초)보다 이른 이유: 칩은 한 줄뿐이라 같은 침묵이 더 길게 느껴진다.
 */
export const SLOW_IMPORT_CHIP_MS = 20_000;

export function readStoredImportJob(): StoredImportJob | null {
  try {
    const raw = window.sessionStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredImportJob> | null;
    if (typeof parsed?.jobId !== "string" || parsed.jobId === "") return null;
    if (typeof parsed.startedAt !== "number" || !Number.isFinite(parsed.startedAt)) return null;
    if (typeof parsed.walletAddress !== "string") return null;
    return { jobId: parsed.jobId, startedAt: parsed.startedAt, walletAddress: parsed.walletAddress };
  } catch {
    // 프라이빗 모드·차단된 스토리지에서는 접근 자체가 던진다. 이어받기를 잃을 뿐 불러오기를 막지는 않는다.
    return null;
  }
}

export function writeStoredImportJob(job: StoredImportJob): void {
  try {
    window.sessionStorage.setItem(IMPORT_JOB_STORAGE_KEY, JSON.stringify(job));
  } catch {
    // 저장 실패는 이어받기만 잃는다.
  }
}

export function clearStoredImportJob(): void {
  try {
    window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  } catch {
    // 위와 같다.
  }
}

/** 시작 시점의 스캔 대상. BE 인덱서는 지원 체인 전체를 훑으므로 목록도 전체를 보여준다. */
const INITIAL_SCAN_CHAINS: ScanChain[] = EVM_CHAIN_IDS.map((chainId) => ({ chainId, chainName: chainLabel(chainId) }));

/**
 * 화면이 그릴 체인 목록. 응답이 오면 체인별 수집 건수가 사실로 붙고, 그 전에는 건수 없이 대상만 보여준다 —
 * 모르는 건수를 0으로 그리면 "이 체인엔 아무것도 없다"로 읽힌다.
 */
export function importScanChains(result: ImportSyncResult | null): ScanChain[] {
  if (result === null) return INITIAL_SCAN_CHAINS;
  return result.chains.map((chain) => ({ chainId: chain.chainId, chainName: chainLabel(chain.chainId), txCount: chain.fetched }));
}

/** BE가 실제로 알려준 체인별 진척. `null`은 "0곳 끝났다"가 아니라 **모른다**는 뜻이다. */
export type ImportScanProgress = {
  scannedChainCount: number;
  totalChainCount: number;
  /** 지금 조회 중인 체인. 모든 체인이 끝났으면 null. */
  currentChain: ScanChain | null;
};

/**
 * 진행 중인 작업이 스스로 밝힌 체인별 진척.
 *
 * **지금 BE 계약에서는 대개 null이다** — 진행 중(`running`) 응답에는 체인 정보가 없고,
 * `chains`는 완료 결과에만 실린다. 그래서 칩·시트는 "몇 곳 끝났다"를 말할 근거가 없으며,
 * 근거 없이 0곳을 그리면 화면이 멈춘 것처럼 보이고 타이머로 지어내면 끝나지 않은 조회를 완료라 부른다.
 * 둘 다 거짓이므로, 모를 때는 **모른다고 말하는 표시**(무한 회전·조회 중)를 쓴다.
 *
 * BE가 나중에 진행 중 응답에도 체인별 사실을 실어 주면, 그 순간부터 이 함수가 값을 돌려주고
 * 화면은 고칠 것 없이 확정 표시로 바뀐다.
 */
export function reportedScanProgress(state: ImportTrackerState): ImportScanProgress | null {
  // 완료 결과(state.result)는 이미 끝난 사실이라 "진행"이 아니다. 진행은 작업 스냅샷만 말할 수 있다.
  const reported = state.job?.result ?? null;
  if (reported === null) return null;
  const totalChainCount = EVM_CHAIN_IDS.length;
  const scannedChainCount = Math.min(reported.chains.length, totalChainCount);
  const next = INITIAL_SCAN_CHAINS[scannedChainCount];
  return { scannedChainCount, totalChainCount, currentChain: next ?? null };
}

/**
 * 트래커 상태 + 경과 시간으로 만든 진행. 단계 애니메이션은 연출(타이머)이지만
 * **완료·실패는 실제 응답에서만** 나온다 — 타이머가 먼저 끝나면 마지막 단계에서 기다린다.
 *
 * 이 연출은 모달 전용이다. 칩·시트는 이 값을 쓰지 않는다 — 한 줄짜리 표시에서
 * 타이머가 만든 "완료"는 사용자가 사실로 읽는다.
 */
export function importProgressFrom(status: ImportTrackerStatus, elapsedMs: number, chainCount: number): ImportProgress {
  const timer = mockProgressAt(elapsedMs, chainCount);
  // 실패는 실제 응답에서만 나온다 — 타이머는 실패를 만들 수 없다.
  if (status === "failed" || status === "lost") {
    return { ...timer, phase: "failed", stepIndex: Math.min(timer.stepIndex, IMPORT_STEPS.length - 1) };
  }
  // 타이머가 먼저 끝났는데 작업이 진행 중이면 마지막 단계에서 기다린다. 완료를 연기하는 것이지 속이는 것이 아니다.
  if (status !== "done" && timer.phase === "done") {
    return { phase: "running", stepIndex: IMPORT_STEPS.length - 1, elapsedMs, scannedChainCount: chainCount };
  }
  return timer;
}

/** 못 불러온 체인. 체인을 모르는 skip(바인딩 단위 실패)은 빠진다 — 이름 없이 "어딘가 실패"라고 말할 수 없어서다. */
export function skippedChainIds(result: ImportSyncResult | null): number[] {
  if (result === null) return [];
  const ids = result.skipped.map((entry) => entry.chainId).filter((chainId): chainId is number => chainId !== undefined);
  return [...new Set(ids)];
}

/** 부분 실패인가 — 결과는 왔지만 일부가 빠졌다. 들어온 만큼은 진짜로 원장에 남았다. */
export function isPartialImport(result: ImportSyncResult | null): boolean {
  return result !== null && result.skipped.length > 0;
}

/** 작업이 스스로 보고한 수집 건수. "무엇이 새로 들어왔는가"가 아니라 **이번 작업이 무엇을 가져왔는가**의 답이다. */
export function reportedEventCount(result: ImportSyncResult | null): number {
  return result?.normalized ?? 0;
}

/**
 * 완료 토스트가 말하는 건수. 다시 받은 원장과의 차이가 사실이고,
 * 목록을 다시 받지 못했을 때만 작업이 보고한 수로 물러난다 — 아무 숫자도 못 말하는 것보다는 낫기 때문이다.
 */
export function importedEventCount(state: ImportTrackerState): number {
  if (state.newEventIds !== null) return state.newEventIds.length;
  return reportedEventCount(state.result);
}

/** 마커를 붙일 이벤트인가. 시작 시점 원장에 없다가 끝난 뒤 나타난 id만 "새로 들어온 거래"다. */
export function isNewlyImportedEvent(state: ImportTrackerState, eventId: string): boolean {
  if (state.newEventIds === null) return false;
  return state.newEventIds.includes(eventId);
}

/**
 * "시작 3분 전". 1분이 안 됐으면 분을 말하지 않는다 — "0분 전"은 아무 사실도 주지 않는다.
 * 시각이 아니라 **경과**를 받는 이유: 화면이 렌더 도중 시계를 읽으면 같은 상태가 매번 다른 결과를 낸다.
 */
export function importStartedLabel(elapsedMs: number | null): string | null {
  if (elapsedMs === null) return null;
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  return minutes < 1 ? "방금 시작" : `시작 ${minutes}분 전`;
}
