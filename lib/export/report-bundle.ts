import { buildReportFile, type ReportFile } from "@/lib/export/report-hash";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { buildEvidenceDocument, merkleRoot } from "@/lib/tax/evidence";
import type { EvidenceDocument, EvidenceFileLeaf, EvidenceLeaf } from "@/lib/tax/evidence";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 계산 근거 + 이번에 내보낼 파일 둘을 한 루트로 묶는다.
 *
 * 잎 순서는 `[header, ...judgments, file:csv, file:xlsx]`로 **고정**한다. 머클루트는 순서에 의존하고
 * BE는 받은 배열 그대로 다시 계산하므로(`evidence.service.ts`), 두 구현이 같은 순서를 내야 한다.
 * 파일 잎을 판정 뒤에 두는 이유: 헤더가 0번이어야 한다는 BE 계약(`leaves[0].kind === "header"`)을
 * 지키면서, 기존 `buildEvidenceDocument`의 잎 배열을 **그대로 앞에 두어** 계산 근거 부분의 루트 규칙을
 * 한 글자도 건드리지 않기 위해서다.
 *
 * `version`은 **1 그대로**다 — 잎 종류가 느는 것은 문서 구조의 확장이지 규칙 변경이 아니다.
 * `compareJudgmentLeaves`는 판정 잎만 정렬한다 — 파일 잎은 정렬에 참여하지 않고 고정 순서로 뒤에 붙는다.
 */
export function buildReportBundle(
  estimate: TaxEstimate,
  events: readonly NormalizedEvent[],
): EvidenceDocument & { files: { csv: ReportFile; xlsx: ReportFile } } {
  const base = buildEvidenceDocument(estimate);
  const csv = buildReportFile("csv", events, estimate);
  const xlsx = buildReportFile("xlsx", events, estimate);
  const fileLeaf = (file: ReportFile): EvidenceFileLeaf => ({
    kind: "file",
    file: file.kind,
    algorithm: file.algorithm,
    hash: file.hash,
    byteLength: file.bytes.byteLength,
  });
  const leaves: EvidenceLeaf[] = [...base.leaves, fileLeaf(csv), fileLeaf(xlsx)];
  return {
    version: base.version,
    merkleRoot: merkleRoot(leaves),
    leaves,
    files: { csv, xlsx },
  };
}
