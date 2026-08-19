import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { createExportWorkbook } from "@/lib/export/xlsx";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";

const summary = { periodPnl: "123.45", computableEventCount: 3, taxableEventCount: 7, pendingReviewCount: 2, currency: "KRW", period: { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" } };

describe("XLSX export summary", () => {
  it("passes SummaryDTO values through without recalculation", () => {
    const workbook = createExportWorkbook(createNormalizedEventFixtures().slice(0, 2), summary);
    expect(workbook.SheetNames).toEqual(["상세", "요약"]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.요약, { defval: "" });
    expect(rows).toHaveLength(1);
    // 숫자·기간은 재계산 없이 그대로 통과한다.
    expect(rows[0]).toMatchObject({ ...summary, period: JSON.stringify(summary.period) });
    // 이 파일만 보고 과세 여부를 확정하지 않도록 한계를 함께 남긴다.
    expect(String(rows[0].limitation)).toContain("확정 판단이 아닙니다");
  });
});
