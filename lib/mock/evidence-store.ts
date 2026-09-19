import "server-only";

import { keccak256, toBytes } from "viem";

import { merkleRoot } from "@/lib/tax/evidence";
import type { EvidenceLeaf } from "@/lib/tax/evidence";
import type { EvidenceChainCheck, EvidenceRecord } from "@/lib/ports/tax-evidence";

/**
 * OFF(FE mock) 모드의 계산 근거 저장소.
 *
 * ON 모드에서는 이 경로가 `proxy.ts`로 BE에 넘어가고, BE가 루트를 다시 계산해 **실제 OmniOne 체인**에 올린다.
 * 여기서는 체인이 없으므로 결정적인 가짜 영수증을 만든다 — 대신 루트만은 **진짜와 같은 규칙**으로 계산한다
 * (`lib/tax/evidence.ts`). 그래야 OFF에서 본 루트가 ON에서 올라가는 루트와 같다.
 *
 * mock 저장소 수명주기는 이벤트·인증 저장소와 같다(globalThis 고정, 단일 프로세스 전용).
 */
type Stored = EvidenceRecord & { userKey: string };

const globalStore = globalThis as typeof globalThis & { __verawalletEvidence?: Map<string, Stored> };
const records = (globalStore.__verawalletEvidence ??= new Map<string, Stored>());

const key = (userKey: string, root: string) => `${userKey}:${root.toLowerCase()}`;

export function recordMockEvidence(userKey: string, leaves: readonly EvidenceLeaf[]): EvidenceRecord {
  const header = leaves[0];
  if (!header || header.kind !== "header") throw new Error("첫 잎은 헤더여야 합니다.");
  const root = merkleRoot(leaves);
  const existing = records.get(key(userKey, root));
  if (existing) return view(existing);

  // 체인이 없으므로 루트에서 결정적으로 파생한다 — 같은 근거는 언제 봐도 같은 영수증을 낸다.
  const txHash = keccak256(toBytes(`vw-mock-anchor:${root}`));
  const stored: Stored = {
    userKey,
    merkleRoot: root,
    countryCode: header.country,
    taxYear: header.taxYear,
    leafCount: leaves.length,
    recordedAt: new Date().toISOString(),
    anchorStatus: "anchored",
    txHash,
    blockNumber: String(records.size + 1),
    anchoredAt: new Date().toISOString(),
    // OmniOne 스테이지에는 블록 탐색기가 없다. ON 모드 BE도 null을 주므로 mock도 같은 사실을 말한다.
    explorerUrl: null,
  };
  records.set(key(userKey, root), stored);
  return view(stored);
}

export function latestMockEvidence(userKey: string, country: string, taxYear: number): EvidenceRecord | null {
  const matches = [...records.values()]
    .filter((record) => record.userKey === userKey && record.countryCode === country && record.taxYear === taxYear)
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  return matches[0] ? view(matches[0]) : null;
}

/** 저장소 키(userKey)는 응답에 싣지 않는다 — 화면이 알 필요도, 알아서도 안 되는 값이다. */
/** OFF 모드의 체인 대조. 체인이 없으니 저장해 둔 사실을 그대로 답한다 — 없는 확인을 지어내지 않는다. */
export function inspectMockEvidence(userKey: string, merkleRoot: string): EvidenceChainCheck | null {
  const record = records.get(key(userKey, merkleRoot));
  if (!record) return null;
  return {
    merkleRoot: record.merkleRoot,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    readFromChain: true,
    success: record.anchorStatus === "anchored",
    anchoredPayloadHash: record.merkleRoot,
    matches: record.anchorStatus === "anchored",
    checkedAt: new Date().toISOString(),
  };
}

function view(record: Stored): EvidenceRecord {
  return {
    merkleRoot: record.merkleRoot,
    countryCode: record.countryCode,
    taxYear: record.taxYear,
    leafCount: record.leafCount,
    recordedAt: record.recordedAt,
    anchorStatus: record.anchorStatus,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    anchoredAt: record.anchoredAt,
    explorerUrl: record.explorerUrl,
  };
}
