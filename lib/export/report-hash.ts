import { keccak256 } from "viem";
import type { Hex } from "viem";

import { createReportLedgerCsv } from "@/lib/export/report";
import { createReportXlsx } from "@/lib/export/report-workbook";
import type { ReportAnchorKind } from "@/lib/ports/report-anchor";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

/** 내려받기 한 번이 다루는 파일 하나. 바이트는 여기서 한 번만 만들고, 해시도 저장도 이 바이트로 한다. */
export type ReportFile = {
  kind: ReportAnchorKind;
  bytes: Uint8Array;
  mimeType: string;
  algorithm: "keccak256";
  hash: Hex;
};

/**
 * 파일 바이트의 해시. 컨트랙트 `bytes32`에 그대로 들어가도록 keccak256을 쓴다.
 * 알고리즘을 값으로 함께 돌려주는 이유는 계약(DTO)이 알고리즘 태그를 싣기 때문이다 —
 * BE/컨트랙트 요구가 sha256으로 바뀌면 이 함수와 DTO 태그만 갈아 끼운다.
 */
export function hashReportFile(bytes: Uint8Array): { algorithm: "keccak256"; hash: Hex } {
  return { algorithm: "keccak256", hash: keccak256(bytes) };
}

/**
 * 같은 estimate·같은 종류면 언제 만들어도 같은 바이트여야 한다.
 * CSV: `serializeCsv`(lib/export/report.ts:479)가 BOM(`﻿`) + CRLF + 고정 열 순서로 낸 문자열을 UTF-8로 인코딩한다.
 * XLSX: `XLSX.write`는 zip 엔트리 시각을 0(1980-00-00)으로 쓰고, `wb.Props`를 세우지 않으면
 *   `docProps/core.xml`에 `dcterms:created`를 넣지 않는다(xlsx 0.18.5 실측 2026-09-21).
 *   **`createReportWorkbook`에 `Props`를 넣지 말 것** — 넣는 순간 생성 시각이 파일에 박혀 해시가 매번 달라진다.
 * estimate가 null이어도(빈 지갑·계산 실패) 파일은 만들어진다 — 두 빌더가 그렇게 설계돼 있고, 게이트는 estimate 유무와 무관하다.
 */
export function buildReportFile(
  kind: ReportAnchorKind,
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): ReportFile {
  const bytes = kind === "csv"
    ? new TextEncoder().encode(createReportLedgerCsv(events, estimate))
    : new Uint8Array(createReportXlsx(events, estimate));
  const mimeType = kind === "csv"
    ? "text/csv;charset=utf-8"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return { kind, bytes, mimeType, ...hashReportFile(bytes) };
}
