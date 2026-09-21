import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 근거 정본·머클루트를 고정하는 estimate.
 *
 * FE와 BE가 **같은 루트**를 내는지 보는 공유 벡터의 입력이다(`evidence-vector.json`).
 * 값을 바꾸면 벡터의 루트도 바뀌므로, 규칙을 의도적으로 고칠 때만 함께 갱신한다.
 */
export const EVIDENCE_FIXTURE_ESTIMATE: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2027,
  method: "거주자별 총평균법",
  status: "PARTIAL",
  lines: [
    { key: "basic_deduction", label: "기본공제", amount: "2500000", rate: "연 250만원" },
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%", basis: "소득세법 제64조의3제2항" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: {
    taxableGains: "833333.33",
    exemptGains: "0",
    incomeTotal: "1200000",
    taxableBase: "833333.33",
    estimatedCharge: "183333.34",
    effectiveRatePercent: "5.5",
  },
  lossCarryforward: "0",
  notes: ["산문 메모는 루트에 넣지 않는다 — 근거가 아니라 설명이다."],
  limitations: [],
  openQuestions: [],
  requiredInputs: [],
  excludedEventIds: ["evt-excluded"],
  provenance: "mock",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "evt-dispose", at: "2027-06-01T02:30:00.000Z", asset: "1:native", symbol: "ETH",
      quantity: "3.5", amount: "12000000", amountKind: "gain", holdingDays: 420,
      acquiredAt: "2026-04-01T00:00:00.000Z", lots: 2, leg: "single", inPeriod: true,
      group: "taxable", label: "과세 · 기타소득 20%", basis: "소득세법 제21조제1항제27호",
      breakdown: { proceeds: "21000000", cost: "8800000", fee: "200000" },
    },
    {
      eventId: "evt-acquire", at: "2026-04-01T00:00:00.000Z", asset: "1:native", symbol: "ETH",
      quantity: "5", amount: "9000000", amountKind: "cost", holdingDays: null,
      acquiredAt: null, lots: 1, leg: "single", inPeriod: false,
      group: "acquire", label: "취득 · 원가 추적", basis: "소득세법 제37조",
    },
    {
      eventId: "evt-income", at: "2027-02-02T00:00:00.000Z", asset: "42161:0x912c", symbol: "ARB",
      quantity: "800", amount: "1200000", amountKind: "fmv", holdingDays: null,
      acquiredAt: null, lots: 0, leg: "single", inPeriod: true,
      group: "income", label: "소득 · 수령 시점 FMV", basis: "소득세법 제21조",
    },
    {
      eventId: "evt-swap", at: "2027-08-08T10:00:00.000Z", asset: "1:0xa0b8", symbol: "USDC",
      quantity: "12000", amount: "4500000", amountKind: "gain", holdingDays: 90,
      acquiredAt: "2027-04-12T00:00:00.000Z", lots: 1, leg: "dispose", inPeriod: true,
      group: "taxable", label: "과세 · 기타소득 20%", basis: "소득세법 제21조제1항제27호",
      breakdown: { proceeds: "16500000", cost: "11900000", fee: "100000" },
    },
    {
      eventId: "evt-swap", at: "2027-08-08T10:00:00.000Z", asset: "1:native", symbol: "ETH",
      quantity: "2.4", amount: "16500000", amountKind: "cost", holdingDays: null,
      acquiredAt: null, lots: 1, leg: "receive", inPeriod: true,
      group: "acquire", label: "취득 · 교환 수취", basis: "소득세법 제37조",
    },
  ],
};
