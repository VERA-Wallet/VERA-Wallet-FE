import "server-only";

import { keccak256, toBytes } from "viem";

import { EVIDENCE_VERSION, merkleRoot } from "@/lib/tax/evidence";
import type { EvidenceLeaf } from "@/lib/tax/evidence";
import type { EvidenceChainCheck, EvidenceDetail, EvidenceRecord } from "@/lib/ports/tax-evidence";

/**
 * OFF(FE mock) 모드의 계산 근거 저장소.
 *
 * ON 모드에서는 이 경로가 `proxy.ts`로 BE에 넘어가고, BE가 루트를 다시 계산해 **실제 OmniOne 체인**에 올린다.
 * 여기서는 체인이 없으므로 결정적인 가짜 영수증을 만든다 — 대신 루트만은 **진짜와 같은 규칙**으로 계산한다
 * (`lib/tax/evidence.ts`). 그래야 OFF에서 본 루트가 ON에서 올라가는 루트와 같다.
 *
 * mock 저장소 수명주기는 이벤트·인증 저장소와 같다(globalThis 고정, 단일 프로세스 전용).
 *
 * **전이(pending → anchored/failed)·실패 스위치·재시도**는 rev 1~4의 파일별 `report-anchor-store` 설계를
 * 그대로 옮겨 왔다(계획 §0-F4). 다만 `EvidenceRecord`(BE `EvidenceView`)에는 `attempt`·`failureReason`이 없다
 * (계획 §0-F1) — `attempt`는 저장소 안에서만 tx 파생에 쓰고 응답에는 절대 싣지 않는다.
 */
// 잎을 함께 둔다 — 근거 화면이 "루트가 무엇을 덮는지"를 보이려면 원본이 있어야 한다(BE `TaxEvidence.document`와 같은 이유).
type Stored = {
  userKey: string;
  leaves: EvidenceLeaf[];
  merkleRoot: string;
  countryCode: string;
  taxYear: number;
  leafCount: number;
  recordedAt: string;
  /** 몇 번째 시도인가. 첫 등록이 1. 재제출(failed → pending)마다 오른다. 응답에는 싣지 않는다. */
  attempt: number;
  /** 이번 시도가 향할 결말. 등록/재제출 시점에 실패 스위치를 읽어 못 박는다. */
  outcome: "ok" | "failed";
  /** 이 시도가 확정되는 시각(epoch ms). 그 전까지는 outcome과 무관하게 pending이다. */
  anchorsAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __verawalletEvidence?: Map<string, Stored>;
  __verawalletEvidenceFailing?: boolean;
};
const records = (globalStore.__verawalletEvidence ??= new Map<string, Stored>());

/** 체인 확정까지 걸리는 시간을 흉내 낸다. 폴링(1.5초)이 최소 한 번은 pending을 보도록 잡는다. */
const ANCHOR_DELAY_MS = 2_500;

const key = (userKey: string, root: string) => `${userKey}:${root.toLowerCase()}`;

function isFailing(): boolean {
  return globalStore.__verawalletEvidenceFailing === true;
}

export function setMockEvidenceFailure(failing: boolean): void {
  globalStore.__verawalletEvidenceFailing = failing;
}

export function mockEvidenceFailing(): boolean {
  return isFailing();
}

export function mockEvidenceCount(): number {
  return records.size;
}

/**
 * 저장소 전체를 비운다 — **사용자별이 아니다.** 단일 프로세스·단일 사용자 데모용 저장소이고
 * 호출자가 e2e 제어 라우트 하나뿐이라 그 범위로 충분하지만, 여러 사용자로 돌리는 수동 QA 중에
 * 부르면 남의 기록도 함께 사라진다는 뜻이다. 스위치도 함께 내린다 — 기록만 지우면 "초기화했는데
 * 다음 등록이 또 실패하는" 저장소가 남는다.
 */
export function resetMockEvidence(): void {
  records.clear();
  setMockEvidenceFailure(false);
}

/**
 * 체인이 없으므로 결정적으로 파생한다(rev 1~4의 report-anchor-store와 같은 규칙).
 * preimage = `userKey` + 루트 + `attempt` — 사용자가 다르면 트랜잭션도 달라야 하고(사용자 간 tx 공유 금지),
 * 재시도도 다른 트랜잭션이어야 한다. 블록 번호도 같은 preimage에서 파생한다 — 체인이 없으니 카운터 대신 해시에서 뽑는다.
 */
function deriveChainFacts(stored: Stored): { txHash: `0x${string}`; blockNumber: string } {
  const txHash = keccak256(toBytes(`vw-mock-anchor:${stored.userKey}:${stored.merkleRoot}:${stored.attempt}`));
  const blockNumber = String(BigInt(txHash) % BigInt(1_000_000));
  return { txHash, blockNumber };
}

/** 상태는 읽는 시점에 파생한다 — 저장은 시도의 사실만 담는다. */
function view(record: Stored, now: number): EvidenceRecord {
  const settled = now >= record.anchorsAt;
  const anchorStatus = !settled ? "pending" : record.outcome === "failed" ? "failed" : "anchored";
  const anchored = anchorStatus === "anchored";
  const chain = anchored ? deriveChainFacts(record) : null;
  return {
    merkleRoot: record.merkleRoot,
    countryCode: record.countryCode,
    taxYear: record.taxYear,
    leafCount: record.leafCount,
    recordedAt: record.recordedAt,
    anchorStatus,
    txHash: chain?.txHash ?? null,
    blockNumber: chain?.blockNumber ?? null,
    anchoredAt: anchored ? new Date(record.anchorsAt).toISOString() : null,
    // OmniOne 스테이지에는 블록 탐색기가 없다. ON 모드 BE도 null을 주므로 mock도 같은 사실을 말한다.
    explorerUrl: null,
  };
}

/**
 * 문서를 등록한다. 멱등 판정은 `(userKey, merkleRoot)`로 한다.
 * - 진행 중이거나(pending) 이미 확정된(anchored) 시도는 그대로 돌려준다(중복 트랜잭션 금지·멱등, T5와 같은 의미).
 * - `failed`면 새 시도를 곧바로 `pending`으로 연다: `attempt++`, `anchorsAt`를 다시 잡고, 실패 스위치를 다시 읽어
 *   outcome을 정한다(T6과 같은 의미). "정착 직후 잠시 failed가 남는다"는 모양은 만들지 않는다 — 재제출한 순간부터
 *   읽는 쪽은 곧바로 pending을 본다.
 */
export function recordMockEvidence(userKey: string, leaves: readonly EvidenceLeaf[]): EvidenceRecord {
  const header = leaves[0];
  if (!header || header.kind !== "header") throw new Error("첫 잎은 헤더여야 합니다.");
  const root = merkleRoot(leaves);
  const mapKey = key(userKey, root);
  const now = Date.now();
  const existing = records.get(mapKey);

  if (!existing) {
    const stored: Stored = {
      userKey,
      leaves: [...leaves],
      merkleRoot: root,
      countryCode: header.country,
      taxYear: header.taxYear,
      leafCount: leaves.length,
      recordedAt: new Date(now).toISOString(),
      attempt: 1,
      outcome: isFailing() ? "failed" : "ok",
      anchorsAt: now + ANCHOR_DELAY_MS,
    };
    records.set(mapKey, stored);
    return view(stored, now);
  }

  const current = view(existing, now);
  if (current.anchorStatus === "anchored" || current.anchorStatus === "pending") {
    return current;
  }

  // failed → 새 시도를 연다.
  existing.attempt += 1;
  existing.anchorsAt = now + ANCHOR_DELAY_MS;
  existing.outcome = isFailing() ? "failed" : "ok";
  return view(existing, now);
}

export function latestMockEvidence(userKey: string, country: string, taxYear: number): EvidenceRecord | null {
  const now = Date.now();
  const matches = [...records.values()]
    .filter((record) => record.userKey === userKey && record.countryCode === country && record.taxYear === taxYear)
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  return matches[0] ? view(matches[0], now) : null;
}

/** 루트가 덮는 정본 문서 + 기록 정보. 내 기록이 아니면 null — 남의 근거를 열어 주지 않는다. */
export function documentMockEvidence(userKey: string, root: string): EvidenceDetail | null {
  const record = records.get(key(userKey, root));
  if (!record) return null;
  return { ...view(record, Date.now()), version: EVIDENCE_VERSION, leaves: [...record.leaves] };
}

/** OFF 모드의 체인 대조. 체인이 없으니 저장해 둔 사실을 그대로 답한다 — 없는 확인을 지어내지 않는다. */
export function inspectMockEvidence(userKey: string, root: string): EvidenceChainCheck | null {
  const record = records.get(key(userKey, root));
  if (!record) return null;
  const current = view(record, Date.now());
  return {
    merkleRoot: current.merkleRoot,
    txHash: current.txHash,
    blockNumber: current.blockNumber,
    readFromChain: true,
    success: current.anchorStatus === "anchored",
    anchoredPayloadHash: current.merkleRoot,
    matches: current.anchorStatus === "anchored",
    checkedAt: new Date().toISOString(),
  };
}
