import { describe, expect, it } from "vitest";
import { buildReportHtml, escapeHtml, reportDocumentTitle } from "@/lib/export/report-html";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentRow, TaxEstimate } from "@/lib/tax/types";

function event(id: string, wallet = "0x1111111111111111111111111111111111111111"): NormalizedEvent {
  return {
    id, tx_hash: "0xabc", chain_id: 1, log_index: 0,
    block_timestamp: "2027-06-01T00:00:00.000Z", wallet_address: wallet,
    direction: "OUT", asset_type: "NATIVE", asset_contract: null, asset_symbol: "ETH",
    asset_verified: true, asset_icon_url: null, token_id: null, decimals: 18,
    raw_amount: "1000000000000000000", counterparty: "0xcounter", gas_fee_native: "0.001",
    classification: "SEND", confidence: 0.9, user_override: null, value_override: null,
    price_status: "RESOLVED", fiat_value: "5000000.00", fiat_currency: "KRW",
    income_kind: null, group_id: null, swap_to_symbol: null, swap_to_icon_url: null,
    bridge_dest_chain_id: null, bridge_group_id: null,
  };
}

function gain(symbol: string, proceeds: string, cost: string, amount: string): JudgmentRow {
  return {
    eventId: `disp-${symbol}`, at: "2027-06-01T00:00:00.000Z", asset: `1:${symbol}`, symbol,
    quantity: "1", amount, amountKind: "gain", holdingDays: null, acquiredAt: null, lots: 1,
    leg: "single", inPeriod: true, group: "taxable", label: "과세 · 기타소득 20%",
    basis: "소득세법 제64조의3제2항", breakdown: { proceeds, cost, fee: "0" },
  };
}

const estimate: TaxEstimate = {
  country: "KR", countryLabel: "한국", currency: "KRW", taxYear: 2027,
  method: "거주자별 총평균법", status: "PARTIAL",
  lines: [
    { key: "basic_deduction", label: "기본공제", amount: "2500000", rate: "연 250만원" },
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%", basis: "소득세법 제64조의3제2항" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: { taxableGains: "833333.33", exemptGains: "0", incomeTotal: "0", taxableBase: "833333.33", estimatedCharge: "183333.34", effectiveRatePercent: "5.5" },
  lossCarryforward: "0", notes: [], limitations: [], openQuestions: [], requiredInputs: [],
  excludedEventIds: [], provenance: "mock",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [gain("ETH", "5000000", "2000000", "3000000")],
};

const meta = { generatedAt: "2027-05-01T00:00:00.000Z" };

describe("P2-F 신고 근거자료 보고서(PDF 인쇄본)", () => {
  it("값을 지어내지 않고 estimate의 신고 요약을 그대로 싣는다", () => {
    const html = buildReportHtml([event("disp-ETH")], estimate, meta, "2027-01-01_2028-01-01");

    // 표지 — 귀속연도·과세기간·방식은 estimate가 말한 것이어야 한다.
    expect(html).toContain("2027년 귀속 · 한국 · 거주자별 총평균법");
    // 과세기간은 반열린 구간의 끝을 하루 당겨 보인다(엔진의 to는 포함하지 않는 끝).
    expect(html).toContain("2027-01-01 ~ 2027-12-31");
    // 신고 요약 4줄. 총수입금액 = Σ양도가액, 예상 부담 = 소득세 + 지방소득세.
    expect(html).toContain("₩5,000,000");
    expect(html).toContain("₩183,333");
    expect(html).toContain("과세표준");
  });

  it("자산별 명세를 취득(2-1)·양도(2-2) 두 표로 나눠 A4 폭에 넣는다", () => {
    const html = buildReportHtml([event("disp-ETH")], estimate, meta);
    expect(html).toContain("2-1. 취득가액 산정");
    expect(html).toContain("2-2. 당기 양도와 손익");
    // 금액 단위를 표 머리로 빼고 칸에서는 통화 기호를 쓰지 않는다 — 여섯 칸에 기호까지 넣으면 폭이 넘친다.
    expect(html).toContain("(금액 단위: 원)");
    expect(html).toContain(">2,000,000<");
  });

  it("외부 문자열이 태그로 살아나지 않는다 — 같은 출처 문서라 이스케이프가 곧 보안 경계다", () => {
    const hostile = { ...estimate, judgments: [gain("<script>alert(1)</script>", "1", "1", "0")] };
    const html = buildReportHtml([event("e")], hostile, meta);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("시행 가정으로 계산했으면 금액 옆에 그 사실이 남는다", () => {
    const html = buildReportHtml([event("e")], estimate, { ...meta, assumeEffective: true, effectiveYear: 2027 });
    expect(html).toContain("시행 가정");
    expect(html).toContain("가정한");
  });

  it("estimate가 없어도(빈 지갑·계산 실패) 문서를 만들되 금액을 지어내지 않는다", () => {
    const html = buildReportHtml([event("a"), event("b")], null, meta);
    expect(html).toContain("계산할 거래 없음");
    expect(html).toContain("4. 계산 근거와 한계");
    // 신고 요약·자산별·예외는 근거가 없으면 아예 싣지 않는다.
    expect(html).not.toContain("1. 신고 요약");
    expect(html).not.toContain("2. 자산별");
  });

  it("예외가 없으면 없다고 말한다 — 빈 표로 있는 척하지 않는다", () => {
    const html = buildReportHtml([event("disp-ETH")], estimate, meta);
    expect(html).toContain("계산에서 제외되었거나 판단을 보류한 항목이 없습니다.");
  });

  it("대상 지갑은 파일에 실제로 들어간 거래에서만 읽는다", () => {
    const other = "0x2222222222222222222222222222222222222222";
    const html = buildReportHtml([event("a"), event("b", other)], estimate, meta);
    expect(html).toContain("0x1111111111111111111111111111111111111111");
    expect(html).toContain(other);
  });

  it("문서 제목이 곧 저장될 PDF 파일명이다", () => {
    expect(reportDocumentTitle(estimate, "2027-01-01_2028-01-01")).toBe(
      "verawallet-신고근거-2027년귀속-2027-01-01_2028-01-01",
    );
    expect(buildReportHtml([], estimate, meta, "2027")).toContain("<title>verawallet-신고근거-2027년귀속-2027</title>");
  });
});
