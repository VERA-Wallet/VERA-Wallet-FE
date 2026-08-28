import { describe, expect, it } from "vitest";
import { LEDGER_COLUMNS, buildLedgerDetail } from "@/lib/export/report";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentRow, TaxEstimate } from "@/lib/tax/types";

function event(over: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  return {
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
    ...over,
  };
}

function gainJudgment(eventId: string): JudgmentRow {
  return {
    eventId,
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
  };
}

function estimateWith(judgments: JudgmentRow[], excludedEventIds: string[]): TaxEstimate {
  return {
    country: "KR",
    countryLabel: "한국",
    currency: "KRW",
    taxYear: 2027,
    method: "거주자별 총평균법",
    status: "PARTIAL",
    lines: [],
    totals: { taxableGains: "0", exemptGains: "0", incomeTotal: "0", taxableBase: "0", estimatedCharge: "0", effectiveRatePercent: "0" },
    lossCarryforward: "0",
    notes: [],
    limitations: [],
    openQuestions: [],
    requiredInputs: [],
    excludedEventIds,
    provenance: "mock",
    period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
    judgments,
  };
}

describe("P2-C 거래 원장 부속명세", () => {
  const disposed = event({ id: "disp" });
  const overridden = event({
    id: "ovr",
    direction: "IN",
    classification: "RECEIVE",
    price_status: "UNKNOWN",
    fiat_value: null,
    value_override: {
      acquisition_cost: "1000000",
      disposal_value: null,
      incidental_cost: "5000",
      gas_fee: "1200",
      price_source: "업비트 2026-12-31 종가",
      evidence_url: "https://example.test/proof",
      deemed_expense_50: false,
      overridden_at: "2027-05-01T00:00:00.000Z",
    },
  });
  const reclassified = event({
    id: "recl",
    user_override: { classification: "SEND", reason: "본인 이체", overridden_at: "2027-05-02T00:00:00.000Z" },
  });
  const excluded = event({ id: "excl" });

  const estimate = estimateWith([gainJudgment("disp")], ["excl"]);
  const rows = buildLedgerDetail([disposed, overridden, reclassified, excluded], estimate);
  const rowFor = (id: string) => rows.find((row) => row.id === id)!;

  it("user_override JSON 통짜 칸이 없다 — 해석된 값만 싣는다", () => {
    expect(LEDGER_COLUMNS).not.toContain("user_override");
    expect(Object.keys(rowFor("disp"))).not.toContain("user_override");
  });

  it("처분 이벤트는 판정·손익·양도가액을 estimate에서 해석해 싣는다", () => {
    const row = rowFor("disp");
    expect(row.계산엔진여부).toBe("계산");
    expect(row.구분).toBe("계산대상");
    expect(row.원화양도가액).toBe("5000000");
    expect(row.원화취득가액).toBe("2000000");
    expect(row.손익).toBe("3000000");
    expect(row.과세판정).toBe("과세 · 기타소득 20%");
    expect(String(row.판정근거조문)).toContain("소득세법");
    expect(row.거래일시_KST).toContain("KST");
  });

  it("금액 override는 JSON이 아니라 해석된 값(취득가액·부대비용·가스비·출처·증빙)으로 나온다", () => {
    const row = rowFor("ovr");
    expect(row.원화취득가액).toBe("1000000");
    expect(row.부대비용).toBe("5000");
    expect(row.가스비_원).toBe("1200");
    expect(row.가격출처).toBe("업비트 2026-12-31 종가");
    expect(row.증빙링크).toBe("https://example.test/proof");
    expect(row.사용자수정여부).toBe("예");
  });

  it("분류만 고친 이벤트도 사용자수정여부를 '예'로, 미수정은 '아니오'로 해석한다", () => {
    expect(rowFor("recl").사용자수정여부).toBe("예");
    expect(rowFor("disp").사용자수정여부).toBe("아니오");
  });

  it("제외 이벤트는 계산 대상과 구분해 표시한다", () => {
    const row = rowFor("excl");
    expect(row.계산엔진여부).toBe("제외");
    expect(row.구분).toBe("제외");
    expect(row.과세판정).toBe("계산 제외");
  });
});
