import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { XLSX_CELL_TEXT_LIMIT, createReportWorkbook, createReportXlsx } from "@/lib/export/report-workbook";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

function event(id: string): NormalizedEvent {
  return {
    id,
    tx_hash: "0xabc",
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2027-06-01T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "OUT",
    asset_type: "NATIVE",
    asset_contract: null,
    asset_symbol: "ETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "1000000000000000000",
    counterparty: "0xcounter",
    gas_fee_native: "0.001",
    classification: "SEND",
    confidence: 0.9,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "5000000.00",
    fiat_currency: "KRW",
    income_kind: null,
    group_id: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
  };
}

const estimate: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2027,
  method: "거주자별 총평균법",
  status: "PARTIAL",
  lines: [
    { key: "basic_deduction", label: "기본공제", amount: "2500000", rate: "연 250만원" },
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: { taxableGains: "833333.33", exemptGains: "0", incomeTotal: "0", taxableBase: "833333.33", estimatedCharge: "183333.34", effectiveRatePercent: "5.5" },
  lossCarryforward: "0",
  notes: [],
  limitations: [{ kind: "zero_basis", message: "원장에 없는 수량을 취득가액 0으로 계산했습니다.", eventIds: [] }],
  openQuestions: [],
  requiredInputs: [],
  excludedEventIds: [],
  provenance: "mock",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "disp",
      at: "2027-06-01T00:00:00.000Z",
      asset: "1:native",
      symbol: "ETH",
      quantity: "1",
      amount: "3000000",
      amountKind: "gain",
      holdingDays: null,
      acquiredAt: null,
      lots: 1,
      leg: "single",
      inPeriod: true,
      group: "taxable",
      label: "과세 · 기타소득 20%",
      basis: "소득세법 제64조의3제2항",
      breakdown: { proceeds: "5000000", cost: "2000000", fee: "0" },
    },
  ],
};

describe("P2-E 신고 근거자료 워크북", () => {
  it("CSV 복사본이 아니라 요약·자산별·원장·예외 4시트로 분리한다", () => {
    const workbook = createReportWorkbook([event("disp")], estimate);
    expect(workbook.SheetNames).toEqual(["요약", "자산별", "원장", "예외"]);
  });

  it("원장 시트에 user_override JSON 통짜 칸이 없다", () => {
    const workbook = createReportWorkbook([event("disp")], estimate);
    const header = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.원장)[0] ?? {};
    expect(Object.keys(header)).not.toContain("user_override");
    expect(Object.keys(header)).toContain("과세판정");
  });

  it("estimate가 없어도(빈 지갑) 4시트를 만든다 — 원장은 온체인 값으로 채운다", () => {
    const workbook = createReportWorkbook([event("disp")], null);
    expect(workbook.SheetNames).toEqual(["요약", "자산별", "원장", "예외"]);
    const ledger = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.원장);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].계산엔진여부).toBe("제외");
  });

  it("어떤 셀이 Excel 한도(32,767자)를 넘어도 파일은 만들어지고, 그 셀만 결정적으로 잘린다", () => {
    // 원천(report.ts)이 긴 값을 만들지 않는 것이 1차 방어다. 여기는 그 방어가 뚫렸을 때의 안전망을 본다.
    const huge = "x".repeat(XLSX_CELL_TEXT_LIMIT + 5_000);
    const wide: TaxEstimate = { ...estimate, openQuestions: [{ topic: "STAKING", status: "UNDETERMINED", reason: huge, affectedEventIds: [] }] };
    const first = createReportXlsx([event("e1")], wide);
    const second = createReportXlsx([event("e1")], wide);
    expect(first.byteLength).toBeGreaterThan(0);
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(createReportWorkbook([event("e1")], wide).Sheets.예외);
    const cell = String(rows.find((row) => String(row.구분).includes("판단보류"))?.내용);
    expect(cell.length).toBeLessThanOrEqual(XLSX_CELL_TEXT_LIMIT);
    expect(cell.endsWith("…(잘림)")).toBe(true);
  });
});
