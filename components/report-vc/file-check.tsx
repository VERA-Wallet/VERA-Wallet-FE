"use client";

import { useRef, useState } from "react";
import { keccak256 } from "viem";
import type { Hex } from "viem";

import { CopyValue, Notice, SECONDARY_BUTTON, Spinner } from "@/components/report-vc/primitives";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { describeError } from "@/lib/report-vc/messages";
import type { FileCheckResult, ReportVcCapabilities, VerifiableFileFormat } from "@/lib/report-vc/types";
import { verifyProof } from "@/lib/tax/evidence";

/**
 * 제출된 리포트 파일이 검증된 증명서의 근거에 포함됐는지 확인한다.
 *
 * 파일은 서버로 보내지 않는다. 브라우저가 바이트의 keccak256을 계산해 해시만 보낸다
 * (`lib/export/report-hash.ts`와 같은 알고리즘, 컨트랙트 `bytes32`와 같은 값).
 *
 * 성공은 두 조건이 다 맞을 때만이다: 서버가 `included`라고 답했고, 함께 준 머클 증명을
 * 브라우저가 `verifyProof`로 다시 계산해 근거 루트에 닿는다. VC 루트와 체인 값이 같다는 것만으로는
 * 파일 검증 성공이 아니다. PDF는 인쇄물이라 근거에 바이트 해시가 없어 검증할 수 없다.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "hashing"; name: string }
  | { kind: "checking"; name: string; hash: string }
  | { kind: "unsupported"; name: string; reason: string }
  | { kind: "error"; name: string; message: string }
  | { kind: "result"; name: string; hash: string; result: FileCheckResult; localProof: "passed" | "failed" | "missing" };

function detectFormat(file: File): VerifiableFileFormat | "pdf" | "unknown" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") return "csv";
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  return "unknown";
}

export function FileCheck({ client, verificationId, capabilities, evidenceRoot }: { client: ReportVcClient; verificationId: string; capabilities: ReportVcCapabilities; evidenceRoot: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const gen = ++generation.current;
    const format = detectFormat(file);
    if (format === "pdf") {
      setPhase({ kind: "unsupported", name: file.name, reason: "PDF 보고서는 인쇄물이라 근거에 파일 해시가 없어 검증할 수 없습니다. CSV 또는 XLSX 파일을 선택해 주세요." });
      return;
    }
    if (format === "unknown" || !capabilities.fileFormats.includes(format)) {
      setPhase({ kind: "unsupported", name: file.name, reason: `이 형식은 검증을 지원하지 않습니다. 지원 형식: ${capabilities.fileFormats.map((entry) => entry.toUpperCase()).join(", ")}` });
      return;
    }
    setPhase({ kind: "hashing", name: file.name });
    let hash: Hex;
    let byteLength: number;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      byteLength = bytes.byteLength;
      hash = keccak256(bytes);
    } catch {
      if (generation.current === gen) setPhase({ kind: "error", name: file.name, message: "파일을 읽지 못했습니다." });
      return;
    }
    if (generation.current !== gen) return;
    setPhase({ kind: "checking", name: file.name, hash });
    try {
      const { data, provenance } = await client.checkFile(verificationId, { format, algorithm: "keccak256", hash, byteLength });
      if (generation.current !== gen) return;
      let localProof: "passed" | "failed" | "missing" = "missing";
      if (data.status === "included" && data.leaf && data.proof) {
        localProof = verifyProof(
          { ...data.leaf, hash: data.leaf.hash },
          data.proof.map((step) => ({ side: step.side, hash: step.hash as Hex })),
          evidenceRoot as Hex,
        ) && provenance !== "mock" && data.evidenceRoot.toLowerCase() === evidenceRoot.toLowerCase() && data.leaf.file === format && data.leaf.byteLength === byteLength && data.leaf.hash.toLowerCase() === hash.toLowerCase() ? "passed" : "failed";
      }
      setPhase({ kind: "result", name: file.name, hash, result: data, localProof });
    } catch (error) {
      if (generation.current !== gen) return;
      setPhase({ kind: "error", name: file.name, message: describeError(error) });
    }
  }

  const busy = phase.kind === "hashing" || phase.kind === "checking";

  return (
    <div data-surface="report-vc-file-check" className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-900">받은 파일 대조</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          리포트 보유자에게 받은 CSV·XLSX 파일이 이 증명서의 근거로 만든 파일인지 확인합니다. 파일은 업로드되지 않으며, 브라우저에서 계산한 해시만 검증 서버로 보냅니다.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
        className="sr-only"
        aria-label="대조할 파일 선택"
        disabled={busy}
        onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }}
      />
      <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => inputRef.current?.click()}>
        파일 선택
      </button>

      {phase.kind === "hashing" && <Spinner label={`${phase.name}의 해시를 계산하고 있습니다...`} />}
      {phase.kind === "checking" && <Spinner label="근거 포함 여부를 확인하고 있습니다..." />}
      {phase.kind === "unsupported" && <Notice tone="warn" surface="report-vc-file-unsupported"><span className="block font-semibold">{phase.name}</span>{phase.reason}</Notice>}
      {phase.kind === "error" && <Notice tone="error"><span className="block font-semibold">{phase.name}</span>{phase.message}</Notice>}

      {phase.kind === "result" && (() => {
        const { result, localProof } = phase;
        const success = result.status === "included" && localProof === "passed";
        if (success) {
          return (
            <Notice tone="success" surface="report-vc-file-included">
              <span className="block font-semibold">{phase.name}</span>
              이 파일의 해시가 증명서 근거에 포함되어 있습니다. 서버의 머클 증명을 브라우저에서 다시 계산해 근거 루트와 맞는 것을 확인했습니다.
              <div className="mt-2"><CopyValue label="파일 해시" value={phase.hash} /></div>
            </Notice>
          );
        }
        if (result.status === "included") {
          // 서버는 포함이라 했지만 브라우저가 증명을 다시 셀 수 없거나 셌더니 맞지 않는다. 성공으로 표시하지 않는다.
          return (
            <Notice tone={localProof === "failed" ? "error" : "warn"} surface="report-vc-file-unverified">
              <span className="block font-semibold">{phase.name}</span>
              {localProof === "failed"
                ? "브라우저에서 재계산한 검증값이 증명서의 근거와 일치하지 않아 파일 검증에 실패했습니다."
                : "파일을 대조하는 데 필요한 증명 자료가 없어 검증을 완료하지 못했습니다."}
            </Notice>
          );
        }
        if (result.status === "not_included") {
          return (
            <Notice tone="error" surface="report-vc-file-not-included">
              <span className="block font-semibold">{phase.name}</span>
              이 파일의 해시는 증명서 근거에 없습니다. 다른 계산으로 만든 파일이거나 내용이 바뀐 파일입니다.
              <div className="mt-2"><CopyValue label="파일 해시" value={phase.hash} /></div>
            </Notice>
          );
        }
        return (
          <Notice tone="warn" surface={`report-vc-file-${result.status}`}>
            <span className="block font-semibold">{phase.name}</span>
            {result.status === "unsupported" ? "해당 파일 형식은 검증을 지원하지 않습니다." : "근거 잎 정보를 읽을 수 없어 포함 여부를 판단하지 못했습니다."}
          </Notice>
        );
      })()}
    </div>
  );
}
