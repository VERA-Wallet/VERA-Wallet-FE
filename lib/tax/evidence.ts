import { concat, keccak256, toBytes, toHex } from "viem";
import type { Hex } from "viem";

import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 계산 근거의 **정본(canonical)** — OmniOne 체인에 올릴 머클루트를 만드는 한 곳.
 *
 * 체인에는 해시만 올라간다(`AnchorRecord`에 userId가 없다는 BE 불변식과 같은 이유). 그래서 나중에
 * "그때 이 거래를 이렇게 판정했다"를 증명하려면, 그 판정이 루트에 **어떻게** 들어갔는지가 한 글자도
 * 흔들리지 않아야 한다. 이 파일은 그 규칙을 정의하고, BE의 같은 규칙(`evidence.merkle.ts`)과
 * 공유 테스트 벡터(`tests/fixtures/evidence-vector.json`)로 맞춘다 — 두 구현이 갈리면 그 픽스처가 먼저 깨진다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────────
 * 1. 정본 JSON: 키는 오름차순, 공백 없음, `undefined`·`null` 값의 키는 **버린다**.
 *    수는 정수만 허용한다 — 금액은 전부 Decimal 문자열이라 부동소수 표기 차이가 끼어들 자리가 없다.
 * 2. 잎 해시 = keccak256("VW-EVIDENCE-LEAF-v1:" ++ 정본JSON)
 * 3. 노드 해시 = keccak256("VW-EVIDENCE-NODE-v1:" ++ 왼쪽 ++ 오른쪽) — 태그가 달라 잎을 노드로 위장할 수 없다.
 * 4. 홀수 노드는 **그대로 올린다**(복제하지 않는다). 복제는 서로 다른 잎 집합이 같은 루트를 내는 길을 연다.
 * 5. 잎 0번은 **헤더**(귀속연도·국가·룰셋 산출 totals)다. 판정만 묶으면 같은 판정을 다른 해에 붙여도
 *    루트가 같아진다 — 헤더를 루트 안에 넣어야 "2026년 한국 계산"이라는 사실까지 봉인된다.
 */

export const EVIDENCE_VERSION = 1;

const LEAF_TAG = "VW-EVIDENCE-LEAF-v1:";
const NODE_TAG = "VW-EVIDENCE-NODE-v1:";
/** 판정이 하나도 없는 해에도 루트는 있어야 한다 — 빈 트리의 루트를 못 박는다. */
const EMPTY_TAG = "VW-EVIDENCE-EMPTY-v1";

// ─────────────────────────────────────────────────────────────────────────────
// 정본 직렬화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 구현이 **바이트까지 같은** 문자열을 내게 하는 직렬화.
 *
 * `JSON.stringify`를 그대로 쓰지 않는 이유는 키 순서다 — 객체 리터럴의 선언 순서가 그대로 나가므로,
 * 같은 값을 FE와 BE가 다른 순서로 만들면 해시가 갈린다. 비ASCII는 두 런타임 모두 escape 없이
 * UTF-8로 내보내므로(명세상 lone surrogate만 escape) 한글 라벨은 그대로 둔다.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  if (typeof value === "number") {
    // 0.1 + 0.2가 런타임마다 다르게 찍히는 세계를 아예 만들지 않는다. 금액은 Decimal 문자열이다.
    if (!Number.isInteger(value)) throw new Error(`정본 문서의 수는 정수만 허용합니다: ${value}`);
    return String(value);
  }
  return JSON.stringify(value) ?? "null";
}

// ─────────────────────────────────────────────────────────────────────────────
// 잎
// ─────────────────────────────────────────────────────────────────────────────

/** 헤더 잎 — 이 계산이 **무엇에 대한 계산인지**. */
export type EvidenceHeaderLeaf = {
  kind: "header";
  version: number;
  country: string;
  countryLabel: string;
  currency: string;
  taxYear: number;
  method: string;
  status: string;
  period: { from: string; to: string };
  lines: { key: string; label: string; amount: string; rate?: string; basis?: string }[];
  totals: Record<string, string>;
  lossCarryforward: string;
  judgmentCount: number;
};

/** 판정 잎 — 거래 하나(정확히는 판정 행 하나)에 대한 결론과 그 근거. */
export type EvidenceJudgmentLeaf = {
  kind: "judgment";
  eventId: string;
  at: string;
  asset: string;
  symbol: string;
  quantity: string;
  amount: string;
  amountKind: string;
  group: string;
  label: string;
  basis: string;
  leg: string;
  lots: number;
  inPeriod: boolean;
  holdingDays?: number;
  acquiredAt?: string;
  breakdown?: { proceeds: string; cost: string; fee: string };
};

export type EvidenceLeaf = EvidenceHeaderLeaf | EvidenceJudgmentLeaf;

export type EvidenceDocument = {
  version: number;
  merkleRoot: Hex;
  leaves: EvidenceLeaf[];
};

/**
 * 판정 행 하나를 잎으로. **필드를 하나씩 적는다** — `{...row}`로 펼치면 `JudgmentRow`에 칸이 하나
 * 늘어나는 날 조용히 모든 루트가 바뀌어, 어제 앵커한 근거를 오늘 다시 만들 수 없게 된다.
 */
function judgmentLeaf(row: TaxEstimate["judgments"][number]): EvidenceJudgmentLeaf {
  return {
    kind: "judgment",
    eventId: row.eventId,
    at: row.at,
    asset: row.asset,
    symbol: row.symbol,
    quantity: row.quantity,
    amount: row.amount,
    amountKind: row.amountKind,
    group: row.group,
    label: row.label,
    basis: row.basis,
    leg: row.leg,
    lots: row.lots,
    inPeriod: row.inPeriod,
    // null·undefined는 정본 직렬화가 키째 버리므로 그대로 넘긴다(보유일수 미상 = 그 칸이 없음).
    ...(row.holdingDays !== null ? { holdingDays: row.holdingDays } : {}),
    ...(row.acquiredAt !== null ? { acquiredAt: row.acquiredAt } : {}),
    ...(row.breakdown ? { breakdown: row.breakdown } : {}),
  };
}

/**
 * 판정 잎의 전순서. 엔진이 `at` 오름차순으로 주지만 같은 시각에 여러 행이 있을 수 있어,
 * 마지막에는 정본 JSON으로 묶는다 — 어떤 입력에도 순서가 하나로 정해져야 루트가 재현된다.
 */
function compareJudgmentLeaves(left: EvidenceJudgmentLeaf, right: EvidenceJudgmentLeaf): number {
  for (const key of ["at", "eventId", "amountKind", "leg"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  const [a, b] = [canonicalJson(left), canonicalJson(right)];
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 머클트리
// ─────────────────────────────────────────────────────────────────────────────

export function leafHash(leaf: EvidenceLeaf): Hex {
  return keccak256(toBytes(LEAF_TAG + canonicalJson(leaf)));
}

export function nodeHash(left: Hex, right: Hex): Hex {
  return keccak256(concat([toHex(toBytes(NODE_TAG)), left, right]));
}

/** 잎 해시 목록에서 루트까지. 홀수로 남은 노드는 복제하지 않고 그대로 다음 층으로 올린다. */
export function rootOfHashes(hashes: readonly Hex[]): Hex {
  if (hashes.length === 0) return keccak256(toBytes(EMPTY_TAG));
  let level = [...hashes];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(index + 1 < level.length ? nodeHash(level[index], level[index + 1]) : level[index]);
    }
    level = next;
  }
  return level[0];
}

export function merkleRoot(leaves: readonly EvidenceLeaf[]): Hex {
  return rootOfHashes(leaves.map(leafHash));
}

export type ProofStep = { side: "left" | "right"; hash: Hex };

/**
 * 잎 하나가 루트에 들어 있음을 보이는 최소 경로.
 *
 * 이것이 "건별 판정 머클루트"를 고른 이유다 — 나중에 거래 한 건만 골라 그 판정을 증명할 때,
 * 나머지 거래를 전부 보여 줄 필요가 없다.
 */
export function merkleProof(leaves: readonly EvidenceLeaf[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new Error(`잎 번호가 범위를 벗어났습니다: ${index}`);
  const steps: ProofStep[] = [];
  let level = leaves.map(leafHash);
  let position = index;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const [left, right] = [level[cursor], level[cursor + 1]];
      if (right === undefined) {
        // 그대로 올라가는 노드는 짝이 없으므로 증명에 보탤 형제도 없다.
        next.push(left);
        continue;
      }
      if (cursor === position) steps.push({ side: "right", hash: right });
      else if (cursor + 1 === position) steps.push({ side: "left", hash: left });
      next.push(nodeHash(left, right));
    }
    position = Math.floor(position / 2);
    level = next;
  }
  return steps;
}

export function verifyProof(leaf: EvidenceLeaf, steps: readonly ProofStep[], root: Hex): boolean {
  let hash = leafHash(leaf);
  for (const step of steps) hash = step.side === "left" ? nodeHash(step.hash, hash) : nodeHash(hash, step.hash);
  return hash.toLowerCase() === root.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 문서
// ─────────────────────────────────────────────────────────────────────────────

/**
 * estimate 하나에서 정본 근거 문서를 만든다. **값은 estimate에서만 읽는다** — 여기서 룰셋 조건을
 * 다시 쓰면 체인에 올라간 근거와 화면·리포트가 서로 다른 답을 말하게 된다.
 */
export function buildEvidenceDocument(estimate: TaxEstimate): EvidenceDocument {
  const judgments = estimate.judgments.map(judgmentLeaf).sort(compareJudgmentLeaves);
  const header: EvidenceHeaderLeaf = {
    kind: "header",
    version: EVIDENCE_VERSION,
    country: estimate.country,
    countryLabel: estimate.countryLabel,
    currency: estimate.currency,
    taxYear: estimate.taxYear,
    method: estimate.method,
    status: estimate.status,
    period: { from: estimate.period.from, to: estimate.period.to },
    lines: estimate.lines.map((line) => ({
      key: line.key,
      label: line.label,
      amount: line.amount,
      ...(line.rate !== undefined ? { rate: line.rate } : {}),
      ...(line.basis !== undefined ? { basis: line.basis } : {}),
    })),
    totals: { ...estimate.totals },
    lossCarryforward: estimate.lossCarryforward,
    judgmentCount: judgments.length,
  };
  const leaves: EvidenceLeaf[] = [header, ...judgments];
  return { version: EVIDENCE_VERSION, merkleRoot: merkleRoot(leaves), leaves };
}
