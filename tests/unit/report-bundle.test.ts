import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vector from "@/tests/fixtures/report-bundle-vector.json";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import { REPORT_FIXTURE_EVENTS } from "@/tests/fixtures/report-events";
import { buildReportBundle } from "@/lib/export/report-bundle";
import { buildEvidenceDocument } from "@/lib/tax/evidence";

/** 벡터를 의도적으로 갱신할 때만: `UPDATE_REPORT_BUNDLE_VECTOR=1 pnpm test report-bundle`. */
const VECTOR_PATH = "tests/fixtures/report-bundle-vector.json";

describe("리포트 묶음 문서", () => {
  it("잎 순서가 [header, ...judgments, file:csv, file:xlsx]다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    const base = buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE);

    expect(bundle.leaves).toHaveLength(base.leaves.length + 2);
    expect(bundle.leaves.slice(0, base.leaves.length)).toEqual(base.leaves);
    expect(bundle.leaves[base.leaves.length]).toMatchObject({ kind: "file", file: "csv" });
    expect(bundle.leaves[base.leaves.length + 1]).toMatchObject({ kind: "file", file: "xlsx" });
  });

  it("판정 잎 수 + 3(헤더 1 + 파일 2)이다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    expect(bundle.leaves).toHaveLength(EVIDENCE_FIXTURE_ESTIMATE.judgments.length + 3);
  });

  it("파일 잎의 해시·크기가 만들어진 파일 바이트와 같다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    const [csvLeaf, xlsxLeaf] = bundle.leaves.slice(-2);

    expect(csvLeaf).toEqual({
      kind: "file",
      file: "csv",
      algorithm: bundle.files.csv.algorithm,
      hash: bundle.files.csv.hash,
      byteLength: bundle.files.csv.bytes.byteLength,
    });
    expect(xlsxLeaf).toEqual({
      kind: "file",
      file: "xlsx",
      algorithm: bundle.files.xlsx.algorithm,
      hash: bundle.files.xlsx.hash,
      byteLength: bundle.files.xlsx.bytes.byteLength,
    });
  });

  it("같은 estimate·events면 루트가 같다", () => {
    const first = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    const second = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    expect(second.merkleRoot).toBe(first.merkleRoot);
  });

  it("CSV 파일 한 바이트가 달라지면(estimate 변경) 루트가 달라진다", () => {
    const [first, ...rest] = EVIDENCE_FIXTURE_ESTIMATE.judgments;
    const tampered = { ...EVIDENCE_FIXTURE_ESTIMATE, judgments: [{ ...first, amount: "12000001" }, ...rest] };

    const base = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    const changed = buildReportBundle(tampered, REPORT_FIXTURE_EVENTS);
    expect(changed.merkleRoot).not.toBe(base.merkleRoot);
  });

  it("buildEvidenceDocument의 루트와는 다르다 — 파일 잎이 더해져 같은 계산도 다른 루트를 낸다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    const base = buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE);
    expect(bundle.merkleRoot).not.toBe(base.merkleRoot);
  });

  it("version은 1 그대로다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);
    expect(bundle.version).toBe(1);
  });

  it("체크인된 루트 벡터와 일치한다 — 드리프트는 여기서 먼저 잡힌다", () => {
    const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS);

    if (process.env.UPDATE_REPORT_BUNDLE_VECTOR) {
      writeFileSync(
        VECTOR_PATH,
        `${JSON.stringify(
          {
            note: "buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, REPORT_FIXTURE_EVENTS)의 고정 루트. 파일 잎 둘을 포함한 묶음 루트다 — evidence-vector.json(계산 근거만)과는 다른 값이다.",
            fixture: "EVIDENCE_FIXTURE_ESTIMATE + REPORT_FIXTURE_EVENTS",
            merkleRoot: bundle.merkleRoot,
            leafCount: bundle.leaves.length,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      // 갱신은 갱신만 한다 — 검증은 다음 평범한 실행의 몫이다(report-file-hash.test.ts와 같은 관용구).
      return;
    }

    expect(bundle.merkleRoot).toBe(vector.merkleRoot);
    expect(bundle.leaves).toHaveLength(vector.leafCount);
  });
});
