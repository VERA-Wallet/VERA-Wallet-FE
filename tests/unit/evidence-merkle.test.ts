import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vector from "@/tests/fixtures/evidence-vector.json";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import {
  buildEvidenceDocument,
  canonicalJson,
  leafHash,
  merkleProof,
  merkleRoot,
  verifyProof,
} from "@/lib/tax/evidence";
import type { EvidenceLeaf } from "@/lib/tax/evidence";

/** 벡터를 의도적으로 갱신할 때만: `UPDATE_EVIDENCE_VECTOR=1 pnpm test evidence-merkle`. */
const VECTOR_PATH = "tests/fixtures/evidence-vector.json";

describe("계산 근거 정본 직렬화", () => {
  it("키를 오름차순으로 세우고 공백을 남기지 않는다", () => {
    expect(canonicalJson({ b: "2", a: "1", c: { z: "z", y: "y" } })).toBe('{"a":"1","b":"2","c":{"y":"y","z":"z"}}');
  });

  it("null·undefined 칸은 키째 버린다 — 두 구현이 '없음'을 다르게 적지 않게", () => {
    expect(canonicalJson({ a: "1", b: null, c: undefined })).toBe('{"a":"1"}');
  });

  it("정수가 아닌 수는 거부한다 — 금액은 Decimal 문자열이어야 한다", () => {
    expect(() => canonicalJson({ amount: 0.1 })).toThrow(/정수만/);
    expect(canonicalJson({ lots: 2 })).toBe('{"lots":2}');
  });

  it("한글 라벨을 escape 없이 그대로 싣는다", () => {
    expect(canonicalJson({ label: "과세 · 기타소득 20%" })).toBe('{"label":"과세 · 기타소득 20%"}');
  });
});

describe("계산 근거 머클트리", () => {
  const document = buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE);

  it("판정 순서가 뒤섞여 들어와도 같은 루트를 낸다", () => {
    const shuffled = { ...EVIDENCE_FIXTURE_ESTIMATE, judgments: [...EVIDENCE_FIXTURE_ESTIMATE.judgments].reverse() };
    expect(buildEvidenceDocument(shuffled).merkleRoot).toBe(document.merkleRoot);
  });

  it("판정 금액이 한 자리만 달라져도 루트가 달라진다", () => {
    const [first, ...rest] = EVIDENCE_FIXTURE_ESTIMATE.judgments;
    const tampered = { ...EVIDENCE_FIXTURE_ESTIMATE, judgments: [{ ...first, amount: "12000001" }, ...rest] };
    expect(buildEvidenceDocument(tampered).merkleRoot).not.toBe(document.merkleRoot);
  });

  it("헤더가 루트 안에 있다 — 같은 판정을 다른 해에 붙이면 루트가 달라진다", () => {
    const otherYear = { ...EVIDENCE_FIXTURE_ESTIMATE, taxYear: 2028 };
    expect(buildEvidenceDocument(otherYear).merkleRoot).not.toBe(document.merkleRoot);
    expect(document.leaves[0].kind).toBe("header");
  });

  it("산문 메모·한계는 루트에 들어가지 않는다 — 근거가 아니라 설명이다", () => {
    const otherNotes = { ...EVIDENCE_FIXTURE_ESTIMATE, notes: ["다른 메모"] };
    expect(buildEvidenceDocument(otherNotes).merkleRoot).toBe(document.merkleRoot);
  });

  it("잎마다 최소 경로로 루트를 다시 만들 수 있다", () => {
    document.leaves.forEach((leaf, index) => {
      expect(verifyProof(leaf, merkleProof(document.leaves, index), document.merkleRoot)).toBe(true);
    });
  });

  it("다른 잎으로는 그 경로가 맞지 않는다", () => {
    const proof = merkleProof(document.leaves, 1);
    expect(verifyProof(document.leaves[2], proof, document.merkleRoot)).toBe(false);
  });

  it("잎이 홀수여도(마지막 노드 승격) 경로가 성립한다", () => {
    const odd = document.leaves.slice(0, 3);
    const root = merkleRoot(odd);
    odd.forEach((leaf, index) => expect(verifyProof(leaf, merkleProof(odd, index), root)).toBe(true));
  });

  it("판정이 없는 해에도 루트가 있다", () => {
    const empty = buildEvidenceDocument({ ...EVIDENCE_FIXTURE_ESTIMATE, judgments: [] });
    expect(empty.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(empty.leaves).toHaveLength(1);
  });

  it("BE와 공유하는 고정 벡터의 루트를 그대로 낸다", () => {
    if (process.env.UPDATE_EVIDENCE_VECTOR) {
      writeFileSync(
        VECTOR_PATH,
        `${JSON.stringify(
          {
            note: "FE lib/tax/evidence.ts와 BE src/evidence/evidence.merkle.ts가 같은 루트를 내는지 고정하는 벡터. 두 곳 모두 이 파일을 읽는다.",
            merkleRoot: document.merkleRoot,
            leafHashes: document.leaves.map(leafHash),
            leaves: document.leaves,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    expect(document.merkleRoot).toBe(vector.merkleRoot);
    expect(document.leaves).toEqual(vector.leaves as EvidenceLeaf[]);
    expect(document.leaves.map(leafHash)).toEqual(vector.leafHashes);
  });
});
