import "server-only";

import { keccak256, toBytes } from "viem";

import type { ReportAnchorInput, ReportAnchorKey, ReportAnchorRecord } from "@/lib/ports/report-anchor";

/**
 * 내보내기 = 파일 해시 온체인 등록 게이트의 OFF(FE mock) 저장소.
 *
 * `tax-evidence`(`lib/mock/evidence-store.ts`)와 저장소 구조는 같다(globalThis 고정 `Map`,
 * `userKey`를 뺀 view()). 단 **전이(pending → anchored / failed)·실패·재시도는 여기서 처음 만든다** —
 * `evidence-store.ts`는 등록 즉시 `anchored`로 못 박아 그 경로가 없다(계획 §0-F2).
 *
 * 키는 다섯 값을 잇는다: `(userKey, fileHash, kind, countryCode, taxYear)`. 해시 하나로는 레코드를
 * 특정할 수 없다 — estimate가 없는 기간의 리포트는 국가·연도가 달라도 파일 바이트가 같다(계획 §0-F6).
 * 같은 해시가 다른 메타로 오는 것은 충돌이 아니라 **별개 레코드**다.
 */
type Stored = {
  userKey: string;
  fileHash: string;
  kind: ReportAnchorInput["kind"];
  countryCode: string;
  taxYear: number;
  algorithm: ReportAnchorInput["algorithm"];
  byteLength: number;
  recordedAt: string;
  /** 몇 번째 시도인가. 첫 등록이 1. 재제출(failed → pending)마다 오른다. */
  attempt: number;
  /** 이번 시도가 향할 결말. 등록/재제출 시점에 실패 스위치를 읽어 못 박는다. */
  outcome: "ok" | "failed";
  /** 이 시도가 확정되는 시각(epoch ms). 그 전까지는 outcome과 무관하게 pending이다. */
  anchorsAt: number;
  /**
   * **지난 시도들**의 마지막 실패 사유·시각. 이번 시도의 실패는 여기 없다 — 정착한 뒤에 `viewOf()`가
   * 파생한다. 등록 시점에 못 박으면 pending 뷰가 아직 오지 않은 실패 시각을 달고 나간다.
   * 새 시도를 열 때 직전 시도의 실패(그때는 이미 확정된 과거다)를 여기로 옮겨 담고, 지우지는 않는다.
   */
  failureReason: string | null;
  lastFailureAt: string | null;
};

const globalStore = globalThis as typeof globalThis & {
  __verawalletReportAnchors?: Map<string, Stored>;
  __verawalletReportAnchorFailing?: boolean;
};
const records = (globalStore.__verawalletReportAnchors ??= new Map<string, Stored>());

/** 체인 확정까지 걸리는 시간을 흉내 낸다. 화면의 폴링(1.5초 간격)이 최소 한 번은 pending을 보도록 잡는다. */
const ANCHOR_DELAY_MS = 1_200;
const FAILURE_REASON = "Mock anchor node rejected the transaction.";

// 구분자 때문에 서로 다른 키가 같은 문자열이 되지 않도록 countryCode는 대문자로, fileHash는 소문자로 정규화한다.
// 값에 `:`가 못 들어오는 것(hash는 hex, kind는 열거형, taxYear는 정수, countryCode는 ISO 코드)은 라우트 검증이 보장한다.
const key = (userKey: string, k: ReportAnchorKey) =>
  `${userKey}:${k.fileHash.toLowerCase()}:${k.kind}:${k.countryCode.toUpperCase()}:${k.taxYear}`;

function isFailing(): boolean {
  return globalStore.__verawalletReportAnchorFailing === true;
}

export function setMockReportAnchorFailure(failing: boolean): void {
  globalStore.__verawalletReportAnchorFailing = failing;
}

export function mockReportAnchorFailing(): boolean {
  return isFailing();
}

export function mockReportAnchorCount(): number {
  return records.size;
}

/**
 * 저장소 전체를 비운다 — **사용자별이 아니다.** 단일 프로세스·단일 사용자 데모용 저장소이고
 * 호출자가 e2e 제어 라우트 하나뿐이라 그 범위로 충분하지만, 여러 사용자로 돌리는 수동 QA 중에
 * 부르면 남의 기록도 함께 사라진다는 뜻이다.
 */
export function resetMockReportAnchors(): void {
  records.clear();
  // 스위치도 함께 내린다. 기록만 지우면 "초기화했는데 다음 등록이 또 실패하는" 저장소가 남는다.
  // 제어 라우트는 reset 뒤에 `failing`을 읽으므로 명시적으로 켜 달라는 요청은 그대로 통한다.
  setMockReportAnchorFailure(false);
}

/**
 * 체인이 없으므로 결정적으로 파생한다(`evidence-store.ts:34`와 같은 규칙).
 * preimage = 레코드 키 + attempt — 키가 다르면(사용자 포함) 트랜잭션도 달라야 하고, 재시도도 다른
 * 트랜잭션이어야 한다. 블록 번호도 같은 preimage에서 파생한다 — 체인이 없으니 카운터 대신 해시에서 뽑는다.
 */
function deriveChainFacts(stored: Stored): { txHash: `0x${string}`; blockNumber: string } {
  const k: ReportAnchorKey = { fileHash: stored.fileHash, kind: stored.kind, countryCode: stored.countryCode, taxYear: stored.taxYear };
  const txHash = keccak256(toBytes(`vw-mock-report-anchor:${key(stored.userKey, k)}:${stored.attempt}`));
  const blockNumber = String(BigInt(txHash) % BigInt(1_000_000));
  return { txHash, blockNumber };
}

/** 상태는 읽는 시점에 파생한다 — 저장은 시도의 사실만 담는다. */
function viewOf(stored: Stored, now: number): ReportAnchorRecord {
  const settled = now >= stored.anchorsAt;
  const anchorStatus = !settled ? "pending" : stored.outcome === "failed" ? "failed" : "anchored";
  const anchored = anchorStatus === "anchored";
  const chain = anchored ? deriveChainFacts(stored) : null;
  // 이번 시도의 실패는 정착한 뒤에야 사실이다. 정착 전에는 지난 시도의 실패만 말한다 —
  // 그러지 않으면 pending 뷰가 미래 시각(anchorsAt)의 실패를 달고 나간다.
  const justFailed = anchorStatus === "failed";
  return {
    fileHash: stored.fileHash,
    algorithm: stored.algorithm,
    kind: stored.kind,
    countryCode: stored.countryCode,
    taxYear: stored.taxYear,
    byteLength: stored.byteLength,
    recordedAt: stored.recordedAt,
    anchorStatus,
    attempt: stored.attempt,
    txHash: chain?.txHash ?? null,
    blockNumber: chain?.blockNumber ?? null,
    anchoredAt: anchored ? new Date(stored.anchorsAt).toISOString() : null,
    // OmniOne 스테이지에는 블록 탐색기가 없다 — null이 정상이다(`lib/ports/tax-evidence.ts:28` 주석과 같은 사실).
    explorerUrl: null,
    failureReason: justFailed ? FAILURE_REASON : stored.failureReason,
    lastFailureAt: justFailed ? new Date(stored.anchorsAt).toISOString() : stored.lastFailureAt,
  };
}

/**
 * 해시를 등록한다. 멱등 판정은 `(userKey, fileHash, kind, countryCode, taxYear)` 전부로 한다.
 * - 진행 중이거나(pending) 이미 확정된(anchored) 시도는 그대로 돌려준다(중복 트랜잭션 금지·멱등).
 * - `failed`면 새 시도를 연다: `attempt++`, `anchorsAt`를 다시 잡고, 실패 스위치를 다시 읽어 outcome을 정한다.
 */
export function registerMockReportAnchor(userKey: string, input: ReportAnchorInput): ReportAnchorRecord {
  const k: ReportAnchorKey = { fileHash: input.fileHash, kind: input.kind, countryCode: input.countryCode, taxYear: input.taxYear };
  const mapKey = key(userKey, k);
  const now = Date.now();
  const existing = records.get(mapKey);

  if (!existing) {
    const anchorsAt = now + ANCHOR_DELAY_MS;
    const stored: Stored = {
      userKey,
      fileHash: input.fileHash.toLowerCase(),
      kind: input.kind,
      countryCode: input.countryCode.toUpperCase(),
      taxYear: input.taxYear,
      algorithm: input.algorithm,
      byteLength: input.byteLength,
      recordedAt: new Date(now).toISOString(),
      attempt: 1,
      outcome: isFailing() ? "failed" : "ok",
      anchorsAt,
      // 첫 시도에는 지난 실패가 없다. 이번 시도가 실패로 정착하면 `viewOf()`가 그때 말한다.
      failureReason: null,
      lastFailureAt: null,
    };
    records.set(mapKey, stored);
    return viewOf(stored, now);
  }

  const current = viewOf(existing, now);
  if (current.anchorStatus === "anchored" || current.anchorStatus === "pending") {
    return current;
  }

  // failed → 새 시도를 연다. 직전 실패는 이미 확정된 과거이므로 여기서 사실로 옮겨 담는다 —
  // 이번 시도의 결말은 정착할 때 `viewOf()`가 파생한다.
  existing.failureReason = current.failureReason;
  existing.lastFailureAt = current.lastFailureAt;
  existing.attempt += 1;
  existing.anchorsAt = now + ANCHOR_DELAY_MS;
  existing.outcome = isFailing() ? "failed" : "ok";
  return viewOf(existing, now);
}

/** 그 키의 내 기록. 없거나 남의 것이면 null — 화면이 "아직 등록 안 함"을 말할 근거이자 폴링의 읽기 경로다. */
export function getMockReportAnchor(userKey: string, k: ReportAnchorKey): ReportAnchorRecord | null {
  const stored = records.get(key(userKey, k));
  return stored ? viewOf(stored, Date.now()) : null;
}
