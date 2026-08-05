import "client-only";

import * as XLSX from "xlsx";

import { EXPORT_COLUMNS, eventToRow } from "@/lib/export/schema";
import type { SummaryDTO } from "@/lib/http/dto";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const SUMMARY_COLUMNS = [
  "periodPnl",
  "computableEventCount",
  "taxableEventCount",
  "pendingReviewCount",
  "currency",
  "period",
  "limitation",
] as const;

/** 이 파일만 보고 과세 여부를 확정하지 않도록 한계를 함께 남긴다. */
const SUMMARY_LIMITATION =
  "이 건수는 가격·분류가 확정된 거래 수이며, 거주국 룰셋에 따라 과세 여부는 달라집니다. 계산 보조용이며 확정 판단이 아닙니다.";

export function createExportWorkbook(events: readonly NormalizedEvent[], summary: SummaryDTO): XLSX.WorkBook {
  const detailSheet = XLSX.utils.json_to_sheet(events.map(eventToRow), { header: [...EXPORT_COLUMNS] });
  const summarySheet = XLSX.utils.json_to_sheet(
    [{
      periodPnl: summary.periodPnl,
      computableEventCount: summary.computableEventCount,
      taxableEventCount: summary.taxableEventCount,
      pendingReviewCount: summary.pendingReviewCount,
      currency: summary.currency,
      period: JSON.stringify(summary.period),
      limitation: SUMMARY_LIMITATION,
    }],
    { header: [...SUMMARY_COLUMNS] },
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, detailSheet, "상세");
  XLSX.utils.book_append_sheet(workbook, summarySheet, "요약");
  return workbook;
}

export function createExportXlsx(events: readonly NormalizedEvent[], summary: SummaryDTO): ArrayBuffer {
  return XLSX.write(createExportWorkbook(events, summary), { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
