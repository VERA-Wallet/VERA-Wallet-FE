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

function sheet(columns: readonly string[], rows: ReportRow[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows, { header: [...columns] });
}

/**
 * 신고 근거자료 워크북 — CSV 복사본이 아니라 A~D 4시트 분리 구조(요약·자산별·원장·예외).
 *
 * estimate가 없으면(빈 지갑·계산 실패) 요약·자산별·예외는 헤더만, 원장은 온체인 값으로 채운 행을 낸다 —
 * 파일은 언제나 만들 수 있어야 하고, 없는 값을 지어내지 않는다.
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
