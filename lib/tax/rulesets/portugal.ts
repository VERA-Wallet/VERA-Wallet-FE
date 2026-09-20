import { ZERO, abs, add, clampPositive, isNegative, percentOf, sub, sum } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** Categoria G(단기 양도) / Categoria E(자본소득) 모두 flat 28%. */
const CATEGORY_G_RATE = "28";
const CATEGORY_E_RATE = "28";
// 포르투갈은 독일과 달리 정확히 365일 보유도 장기 보유로 본다.
function isLongHeld(row: { holdingDays: number | null }): boolean {
  return row.holdingDays !== null && row.holdingDays >= 365;
}
 

export const portugal: RuleSetDefinition = {
  code: "PT",
  label: "포르투갈",
  currency: "EUR",
  cost_basis: "FIFO",
  badge_label: "PT 365일 이분법",
  demoPriority: 2,
  status: "CONFIRMED",
  profileFields: ["carriedLosses"],
  aggregateAdjustment: "offset",
  ledger: {
    method: "FIFO",
    scope: "WALLET",
    // 크립토→크립토는 비과세, 보유기간 승계(다수설 — 1차 확인 필요).
    cryptoToCryptoTaxable: false,
    carryHoldingPeriod: true,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "CIRS Categoria G (2023 국가예산법)", note: "365일 이상 보유 시 전액 면세" },
    { topic: "STAKING", status: "CONFIRMED", basis: "CIRS Categoria E", note: "365일 면세 미적용" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "CIRS", note: "보유기간 승계는 출처 상충. 1차 확인 필요" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "CIRS", note: "단기 손실만 동종 이익과 상계" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow): JudgmentVerdict {
    if (isLongHeld(row)) {
      return { group: "exempt", label: "비과세 · 365일 이상", basis: "CIRS Cat. G" };
    }
    if (isNegative(row.gain)) return { group: "carry", label: "손실 · 상계 대상", basis: "CIRS" };
    // 부분 상계 표기는 buildJudgments의 공통 안전망이 12개 룰셋 전부에 붙인다.
    return { group: "taxable", label: "과세 · 365일 미만", basis: "CIRS Cat. G" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "CIRS Cat. E" };
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const shortRows = ledger.gains.filter((row) => !isLongHeld(row));
    const longRows = ledger.gains.filter(isLongHeld);
    const shortNet = sub(sum(shortRows.map((row) => row.gain)), profile.carriedLosses);
    const exemptGains = sum(longRows.map((row) => row.gain));
    const taxableGains = clampPositive(shortNet);
    const incomeTotal = sum(ledger.income.map((row) => row.amount));

    const gainsCharge = percentOf(taxableGains, CATEGORY_G_RATE);
    const incomeCharge = percentOf(incomeTotal, CATEGORY_E_RATE);

    return finalizeEstimate({
      country: "PT",
      countryLabel: "포르투갈",
      currency: "EUR",
      taxYear,
      method: "FIFO (지갑·플랫폼별)",
      status: "CONFIRMED",
      taxableGains,
      exemptGains,
      incomeTotal,
      taxableBase: add(taxableGains, incomeTotal),
      estimatedCharge: add(gainsCharge, incomeCharge),
      lossCarryforward: isNegative(shortNet) ? abs(shortNet) : ZERO,
      lines: [
        { key: "short_gains", label: "365일 미만 보유 손익", amount: sum(shortRows.map((row) => row.gain)), rate: `${CATEGORY_G_RATE}%`, basis: "CIRS Cat. G" },
        { key: "exempt_gains", label: "365일 이상 보유 면세분", amount: exemptGains, rate: "0%", basis: "CIRS Cat. G" },
        { key: "income", label: "스테이킹·렌딩 수익", amount: incomeTotal, rate: `${CATEGORY_E_RATE}%`, basis: "CIRS Cat. E" },
        { key: "gains_charge", label: "양도분 예상 부담", amount: gainsCharge, rate: `${CATEGORY_G_RATE}%` },
        { key: "income_charge", label: "자본소득 예상 부담", amount: incomeCharge, rate: `${CATEGORY_E_RATE}%` },
        { key: "deferred_swaps", label: "비과세 교환으로 이연된 건수", amount: String(ledger.deferred.length), basis: "CIRS (크립토→크립토)" , unit: "count" as const },
      ],
      notes: [
        "365일 이상 보유 후 처분은 전액 면세입니다(증권형 토큰 제외).",
        "크립토→크립토 교환은 과세되지 않고 취득원가와 보유기간이 승계됩니다.",
        "스테이킹은 Categoria E로 별도 28%. 보유기간 면세가 적용되지 않습니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "CRYPTO_TO_CRYPTO", status: "PARTIAL", reason: "교환 시 보유기간 승계 여부는 출처가 상충합니다(다수설 기준 승계로 계산).", affectedEventIds: ledger.deferred.map((item) => item.eventId) },
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이 LP·랩핑에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: [],
      excludedEventIds,
    });
  },
};
