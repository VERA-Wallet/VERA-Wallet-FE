import "client-only";

import * as XLSX from "xlsx";

import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";
import {
  ASSET_COST_COLUMNS,
  EXCEPTION_COLUMNS,
  FILING_SUMMARY_COLUMNS,
  LEDGER_COLUMNS,
  buildAssetCostDetail,
  buildExceptions,
  buildFilingSummary,
  buildLedgerDetail,
  type ReportRow,
} from "@/lib/export/report";

/** 이 파일만 보고 과세 여부를 확정하지 않도록 요약 시트 끝에 남기는 한계. */
const DISCLAIMER =
  "이 리포트는 계산 보조용이며 확정 판단이 아닙니다. 거주국 룰셋·의제취득가액 등에 따라 실제 신고 값은 달라질 수 있습니다.";

/** Excel 셀 하나의 문자열 한도. 넘기면 `XLSX.write`가 "Text length must not exceed 32767 characters"를 던진다. */
export const XLSX_CELL_TEXT_LIMIT = 32_767;
const CLIP_SUFFIX = " …(잘림)";

/**
 * 어떤 셀도 한도를 넘지 않게 자른다 — 파일이 안 만들어지는 것보다 셀 하나가 잘리는 쪽이 낫다.
 * 자르는 규칙이 결정적이라 같은 입력이면 같은 바이트, 같은 해시다. 원천(`report.ts`)이 긴 값을
 * 애초에 만들지 않는 것이 1차 방어이고, 여기는 안전망이다.
 */
function clipCell(value: string | number): string | number {
  if (typeof value !== "string" || value.length <= XLSX_CELL_TEXT_LIMIT) return value;
  return `${value.slice(0, XLSX_CELL_TEXT_LIMIT - CLIP_SUFFIX.length)}${CLIP_SUFFIX}`;
}

function sheet(columns: readonly string[], rows: ReportRow[]): XLSX.WorkSheet {
  const clipped = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clipCell(value)])));
  return XLSX.utils.json_to_sheet(clipped, { header: [...columns] });
}

/**
 * 신고 근거자료 워크북 — CSV 복사본이 아니라 A~D 4시트 분리 구조(요약·자산별·원장·예외).
 *
 * estimate가 없으면(빈 지갑·계산 실패) 요약·자산별·예외는 헤더만, 원장은 온체인 값으로 채운 행을 낸다 —
 * 파일은 언제나 만들 수 있어야 하고, 없는 값을 지어내지 않는다.
 *
 * **`workbook.Props`를 세우지 말 것.** `Props`를 안 세우면 `XLSX.write`가 zip 엔트리 시각을 0(1980-00-00)으로
 * 쓰고 `docProps/core.xml`에 `dcterms:created`를 넣지 않아 바이트가 결정적이다(xlsx 0.18.5 실측 2026-09-21).
 * `Props`를 세우는 순간 생성 시각이 파일에 박혀 매번 다른 바이트가 나오고, `lib/export/report-hash.ts`의
 * 해시가 실행마다 달라진다 — 온체인에 등록한 해시를 재현할 수 없게 된다.
 */
export function createReportWorkbook(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): XLSX.WorkBook {
  const filingRows: ReportRow[] = estimate ? buildFilingSummary(estimate) : [];
  filingRows.push({ 기입란: "주의", 금액: "", 근거: DISCLAIMER });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet(FILING_SUMMARY_COLUMNS, filingRows), "요약");
  XLSX.utils.book_append_sheet(workbook, sheet(ASSET_COST_COLUMNS, estimate ? buildAssetCostDetail(estimate) : []), "자산별");
  XLSX.utils.book_append_sheet(workbook, sheet(LEDGER_COLUMNS, buildLedgerDetail(events, estimate)), "원장");
  XLSX.utils.book_append_sheet(workbook, sheet(EXCEPTION_COLUMNS, buildExceptions(events, estimate)), "예외");
  return workbook;
}

export function createReportXlsx(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): ArrayBuffer {
  return XLSX.write(createReportWorkbook(events, estimate), { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
