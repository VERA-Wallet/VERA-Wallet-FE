/**
 * 지갑 연결 직후 "거래 불러오는 중" 화면의 진행 모델.
 *
 * 인덱서 동기화는 즉시 끝나지 않는데 지금 화면은 SIWE 서명 성공과 동시에 대시보드로 넘어간다.
 * 그 사이를 무엇으로 채울지를 이 모듈이 정의한다 — 단계 목록, 각 단계가 무엇을 기다리는지,
 * 그리고 "오래 걸린다"고 말해야 하는 시점.
 *
 * **지금은 프론트 퍼블리싱 단계라 진행이 경과 시간에서 파생된다.**(`mockProgressAt`)
 * BE에 동기화 상태가 생기면 `ImportProgress`를 만드는 자리만 그 상태로 갈아끼우면 되고,
 * 화면(`ImportProgressModal`)은 건드리지 않는다 — 그래서 모달은 progress를 prop으로만 받는다.
 */

export type ImportStepId = "signature" | "scan" | "normalize" | "value";

export type ImportStep = {
  id: ImportStepId;
  label: string;
  /** 그 단계가 진행 중일 때만 붙는 한 줄. 지금 무엇을 기다리는 중인지 말한다. */
  runningText: string;
};

/**
 * 사용자가 이해하는 단위로 쪼갠 단계. 내부 파이프라인 이름(listOrSync·normalize·anchor)이 아니라
 * "내 거래에 무슨 일이 일어나는가"의 언어로 쓴다.
 */
export const IMPORT_STEPS: readonly ImportStep[] = [
  { id: "signature", label: "지갑 서명 확인", runningText: "지갑 소유권을 확인하는 중" },
  { id: "scan", label: "체인 거래 조회", runningText: "온체인 거래를 찾는 중" },
  { id: "normalize", label: "거래 정규화", runningText: "자산·수량·시각을 정리하는 중" },
  { id: "value", label: "손익 계산", runningText: "취득가와 처분가를 맞추는 중" },
];

/** 체인 거래 조회 단계의 인덱스. 체인별 진척은 이 단계 안에서만 흐른다. */
export const SCAN_STEP_INDEX = IMPORT_STEPS.findIndex((step) => step.id === "scan");

/**
 * 지금 인식하는 체인. **EVM만** 다루며, 목록에 없는 체인은 스캔 대상에서 뺀다.
 *
 * 여기 없는 체인은 `ChainIcon`도 마크를 모르고 `chainLabel`도 이름을 모른다 —
 * 화면이 "chain 999를 조회하는 중"이라고 말하게 두느니 아예 대상에서 제외한다.
 */
export const EVM_CHAIN_IDS: readonly number[] = [1, 10, 137, 8453, 42161];

export function isEvmChain(chainId: number): boolean {
  return EVM_CHAIN_IDS.includes(chainId);
}

/**
 * 불러오기 모달이 그리는 스캔 대상 체인 한 줄. BE는 지원 체인 전체를 스캔하므로 목록은 시작부터 안다.
 * `txCount`는 resync 응답이 온 뒤에만 안다 — 모르는 값을 0으로 꾸미지 않는다.
 */
export type ScanChain = { chainId: number; chainName: string; txCount?: number };

export type ImportPhase = "running" | "done" | "failed";

/**
 * `stepIndex`는 **현재 진행 중인 단계**의 인덱스다. 완료(`done`)일 때만 `IMPORT_STEPS.length`가 되어
 * 모든 단계가 뒤에 남는다 — 그래야 `stepState`가 분기 없이 완료를 표현한다.
 */
export type ImportProgress = {
  phase: ImportPhase;
  stepIndex: number;
  elapsedMs: number;
  /**
   * 조회를 마친 체인 수. 조회 단계의 실제 진척이며, BE 동기화 상태가 붙으면 그쪽이 주는 값이 그대로 들어온다.
   * 단계 인덱스와 따로 두는 이유: "체인 거래 조회 중"만으로는 5개 중 몇 번째인지 알 수 없다.
   */
  scannedChainCount: number;
};

export type ChainScanState = "pending" | "scanning" | "done" | "failed";

/**
 * 체인 하나의 조회 상태. 조회 단계를 지났으면 전부 끝난 것이고, 그 안에 있으면 `scannedChainCount`가 경계다.
 * 실패는 **지금 조회 중이던 체인**에만 붙는다 — 이미 끝낸 체인의 거래는 실제로 손에 있다.
 */
export function chainScanState(progress: ImportProgress, index: number): ChainScanState {
  if (progress.phase === "done" || progress.stepIndex > SCAN_STEP_INDEX) return "done";
  if (progress.stepIndex < SCAN_STEP_INDEX) return "pending";
  if (index < progress.scannedChainCount) return "done";
  if (index > progress.scannedChainCount) return "pending";
  return progress.phase === "failed" ? "failed" : "scanning";
}

export type StepState = "done" | "running" | "pending" | "failed";

export function stepState(progress: ImportProgress, index: number): StepState {
  if (index < progress.stepIndex) return "done";
  if (index > progress.stepIndex) return "pending";
  return progress.phase === "failed" ? "failed" : "running";
}

/** 진행 막대에 쓰는 백분율. **완료한 단계 수**에서 나온다 — 시간이 아니라 사실에서 파생돼야 실제 상태를 꽂아도 그대로 맞는다. */
export function importProgressPercent(progress: ImportProgress): number {
  return Math.round((Math.min(progress.stepIndex, IMPORT_STEPS.length) / IMPORT_STEPS.length) * 100);
}

/**
 * 사용자가 "멈췄나?"를 의심하기 시작하는 지점. 이때부터 화면이 먼저 오래 걸린다는 사실을 말한다.
 * 침묵하면 사용자는 새로고침하거나 창을 닫는다.
 */
export const SLOW_IMPORT_MS = 30_000;

/** 완료 체크를 보여주고 스스로 닫기까지 두는 시간. 즉시 사라지면 무엇이 끝났는지 읽을 틈이 없다. */
export const IMPORT_DONE_HOLD_MS = 900;

/** mock 진행 틱. 진행 막대가 끊겨 보이지 않을 만큼만 촘촘하다. */
export const IMPORT_TICK_MS = 120;

/** 퍼블리싱용 단계별 지속 시간. 실제 동기화 시간이 아니라 **화면을 검증하기 위한** 값이다. */
export const IMPORT_STEP_DURATIONS_MS: readonly number[] = [900, 2600, 1800, 1500];

/**
 * 경과 시간만으로 진행을 만든다. BE 동기화 상태가 생기면 이 함수를 호출하는 자리가 그 상태로 바뀐다.
 * 실패는 여기서 만들지 않는다 — 시간은 실패의 근거가 아니고, 실패는 실제 응답에서만 나와야 한다.
 *
 * `chainCount`는 조회 단계를 몇 등분할지를 정한다. 기본값을 두지 않는 이유: 체인 0개는
 * "스캔할 게 없다"는 뜻인데, 그 상태를 조용히 만들어내면 화면이 빈 목록을 진행 중이라고 말한다.
 */
export function mockProgressAt(elapsedMs: number, chainCount: number): ImportProgress {
  let boundary = 0;
  for (let index = 0; index < IMPORT_STEP_DURATIONS_MS.length; index += 1) {
    const stepStartedAt = boundary;
    boundary += IMPORT_STEP_DURATIONS_MS[index];
    if (elapsedMs >= boundary) continue;
    // 조회 단계 안에서만 체인이 하나씩 끝난다. 마지막 체인은 단계가 끝나야 done이 되므로 상한을 둔다.
    const scannedChainCount =
      index < SCAN_STEP_INDEX
        ? 0
        : index > SCAN_STEP_INDEX
          ? chainCount
          : Math.min(
              chainCount,
              Math.floor(((elapsedMs - stepStartedAt) / IMPORT_STEP_DURATIONS_MS[index]) * chainCount),
            );
    return { phase: "running", stepIndex: index, elapsedMs, scannedChainCount };
  }
  return { phase: "done", stepIndex: IMPORT_STEPS.length, elapsedMs, scannedChainCount: chainCount };
}
