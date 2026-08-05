import { ZERO, add, clampPositive, isNegative, percentOf, sub, sum } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** §115BBH flat 30% + cess 4% = 실효 31.2%. */
const VDA_RATE = "30";
const CESS_RATE = "4";
/** §194S 원천징수 1%. */
const TDS_RATE = "1";

export const india: RuleSetDefinition = {
  code: "IN",
  label: "인도",
  currency: "INR",
  cost_basis: "per_disposal",
  badge_label: "IN VDA flat 30%",
  demoPriority: 2,
  status: "CONFIRMED",
  profileFields: [],
  // §115BBH는 상계 자체를 금지한다 — 줄어드는 게 아니라 손실이 무시된다.
  aggregateAdjustment: "ignored",
  ledger: {
    method: "FIFO",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    // §115BBH는 취득원가만 공제한다 — 수수료·가스비 불인정.
    feeDeductible: false,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "소득세법 §115BBH (Finance Act 2022)", note: "보유기간 구분 없음" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "§115BBH(2)", note: "손실 상계·이월 전면 금지" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "§115BBH (모든 VDA 이전)" },
    { topic: "STAKING", status: "PARTIAL", basis: "§115BBH 적용되나 취득원가 산정 지침 미비" },
    { topic: "AIRDROP", status: "PARTIAL", basis: "§115BBH 적용되나 취득원가 산정 지침 미비" },
    { topic: "DEFI_LP", status: "PARTIAL", basis: "VDA 이전으로 포섭되나 개별 지침 부재" },
  ],
  judgeGain(row: GainRow): JudgmentVerdict {
    return isNegative(row.gain)
      ? { group: "ignored", label: "상계 불가 · 무시", basis: "§115BBH(2)" }
      : { group: "taxable", label: "과세 · 보유기간 무관", basis: "§115BBH" };
  },
  judgeIncome(): JudgmentVerdict {
    // 인도는 수령 종류와 무관하게 §115BBH가 걸린다 — 근거가 갈리지 않는다.
    return {
      group: "income",
      label: "소득 · 분류 미확정",
      basis: "§115BBH 적용되나 취득원가 산정 지침 미비",
    };
  },

  compute({ ledger, taxYear, excludedEventIds }) {
    // 손실 전면 무시 — 건별 이득만 합산한다(음수 행은 0으로 절사).
    const positiveGains = sum(ledger.gains.map((row) => clampPositive(row.gain)));
    const ignoredLosses = sum(ledger.gains.map((row) => clampPositive(sub(ZERO, row.gain))));
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const grossProceeds = sum(ledger.gains.map((row) => row.proceeds));

    const base = add(positiveGains, incomeTotal);
    const charge = add(percentOf(base, VDA_RATE), percentOf(percentOf(base, VDA_RATE), CESS_RATE));
    const tds = percentOf(grossProceeds, TDS_RATE);

    return finalizeEstimate({
      country: "IN",
      countryLabel: "인도",
      currency: "INR",
      taxYear,
      method: "건별 취득원가 (손실 상계 불가)",
      status: "CONFIRMED",
      taxableGains: positiveGains,
      exemptGains: ZERO,
      incomeTotal,
      taxableBase: base,
      estimatedCharge: charge,
      lossCarryforward: ZERO,
      lines: [
        { key: "vda_gains", label: "VDA 양도이득 (건별 합산)", amount: positiveGains, basis: "§115BBH" },
        { key: "ignored_losses", label: "상계 불가로 무시된 손실", amount: ignoredLosses, rate: "0% 인정", basis: "§115BBH(2)" },
        { key: "income", label: "스테이킹·에어드랍 수령분", amount: incomeTotal, basis: "§115BBH (원가 지침 미비)" },
        { key: "charge", label: "예상 부담 (flat)", amount: charge, rate: "30% + cess 4% = 31.2%" },
        { key: "tds", label: "원천징수 예납액 (§194S)", amount: tds, rate: "양도가액의 1%" },
      ],
      notes: [
        "손실은 다른 VDA 이익과도, 다른 소득과도 상계·이월할 수 없습니다.",
        "수수료·가스비는 취득원가로 인정되지 않습니다.",
        "1% 원천징수분은 최종 부담액에서 조정됩니다(고소득 surcharge는 별도).",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "STAKING", status: "PARTIAL", reason: "스테이킹·에어드랍 수령분의 취득원가 산정 지침이 없습니다.", affectedEventIds: ledger.income.map((row) => row.eventId) },
      ],
      requiredInputs: [],
      excludedEventIds,
    });
  },
};
