import { ZERO, abs, add, clampPositive, gt, isNegative, lt, mul, percentOf, sub, sum } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, IncomeRow, JudgmentVerdict, RuleContext, RuleSetDefinition, TaxEstimate } from "@/lib/tax/types";
import { defaultIncomeVerdict } from "@/lib/tax/judgment";

/** 연대부가세(Solidaritätszuschlag) 5.5% 가산 계수. */
const SOLI = "1.055";
/** §23 매매 면세한계(Freigrenze) — 초과 시 전액 과세(차감형 아님). */
const TRADE_FREIGRENZE = "1000";
/** §22 Nr.3 기타소득 면세한계. */
const OTHER_INCOME_FREIGRENZE = "256";
function isLongHeld(row: { holdingDays: number | null }): boolean {
  return row.holdingDays !== null && row.holdingDays > 365;
}
 

export const germany: RuleSetDefinition = {
  code: "DE",
  label: "독일",
  currency: "EUR",
  cost_basis: "FIFO",
  badge_label: "DE FIFO",
  demoPriority: 1,
  status: "CONFIRMED",
  profileFields: ["marginalRatePercent", "carriedLosses"],
  aggregateAdjustment: "offset",
  ledger: {
    method: "FIFO",
    scope: "WALLET",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "§23 (1) Nr.2 EStG + BMF 2022.5.10 / 개정 2025.3.6", note: "1년 초과 보유 후 처분은 금액 무관 전액 비과세" },
    { topic: "STAKING", status: "CONFIRMED", basis: "§22 Nr.3 EStG, BMF 2025.3.6", note: "스테이킹해도 원본 코인의 1년 시계는 연장되지 않음" },
    { topic: "AIRDROP", status: "CONFIRMED", basis: "§22 Nr.3 EStG (행위 대가 시)" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "§23 EStG (교환도 처분)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "§23 (3) EStG", note: "§23 손실은 §23 이익과만 상계, 이월 가능" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, _context: RuleContext, estimate: TaxEstimate): JudgmentVerdict {
    if (isLongHeld(row)) {
      return { group: "exempt", label: "비과세 · 1년 초과", basis: "§23 (1) Nr.2 EStG" };
    }
    if (isNegative(row.gain)) return { group: "carry", label: "손실 · 상계 대상", basis: "§23 (3) EStG" };
    // 이익 행이라도 기간 전체가 Freigrenze 미만이면 실제 부담은 0이다.
    // 그때까지 "과세 대상"이라고만 찍으면 화면이 계산과 다른 말을 한다.
    // 그룹(§23 과세 범주)은 사실이므로 유지하고, 결과를 라벨로 밝힌다.
    // 총액이 정확히 0인 경우는 상계이므로 buildJudgments의 offset 강등이 맡는다.
    const belowFreigrenze =
      gt(estimate.totals.taxableGains, ZERO) && lt(estimate.totals.taxableGains, TRADE_FREIGRENZE);
    return {
      group: "taxable",
      label: belowFreigrenze ? `과세 대상 · 면세한계(€${TRADE_FREIGRENZE}) 미만이라 부담 없음` : "과세 대상",
      basis: belowFreigrenze ? "§23 (3) EStG" : "§23 (1) Nr.2 EStG",
    };
  },
  judgeIncome(row: IncomeRow, _context: RuleContext, estimate: TaxEstimate): JudgmentVerdict {
    // 수령 종류마다 근거 조문이 다르다 — 에어드랍에 스테이킹 조문을 달면 근거가 거짓이 된다.
    const verdict = defaultIncomeVerdict(row, germany);
    const below =
      gt(estimate.totals.incomeTotal, ZERO) && lt(estimate.totals.incomeTotal, OTHER_INCOME_FREIGRENZE);
    return below
      ? { ...verdict, label: `소득 · 면세한계(€${OTHER_INCOME_FREIGRENZE}) 미만이라 부담 없음` }
      : verdict;
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const shortRows = ledger.gains.filter((row) => !isLongHeld(row));
    const longRows = ledger.gains.filter(isLongHeld);
    const shortNet = sum(shortRows.map((row) => row.gain));
    const exemptGains = sum(longRows.map((row) => row.gain));
    const afterCarry = sub(shortNet, profile.carriedLosses);
    const taxableGains = clampPositive(afterCarry);
    const incomeTotal = sum(ledger.income.map((row) => row.amount));

    // Freigrenze는 차감형 공제가 아니다 — 한계 미만이면 0, 넘으면 전액이 과세된다.
    const gainsCharge = lt(taxableGains, TRADE_FREIGRENZE) ? ZERO : mul(percentOf(taxableGains, profile.marginalRatePercent), SOLI);
    const incomeCharge = lt(incomeTotal, OTHER_INCOME_FREIGRENZE) ? ZERO : mul(percentOf(incomeTotal, profile.marginalRatePercent), SOLI);

    return finalizeEstimate({
      country: "DE",
      countryLabel: "독일",
      currency: "EUR",
      taxYear,
      method: "FIFO (지갑별)",
      status: "CONFIRMED",
      taxableGains,
      exemptGains,
      incomeTotal,
      taxableBase: add(taxableGains, incomeTotal),
      estimatedCharge: add(gainsCharge, incomeCharge),
      lossCarryforward: isNegative(afterCarry) ? abs(afterCarry) : ZERO,
      lines: [
        { key: "short_gains", label: "1년 이내 처분 손익", amount: shortNet, basis: "§23 (1) Nr.2 EStG" },
        { key: "exempt_gains", label: "1년 초과 보유 비과세분", amount: exemptGains, rate: "0%", basis: "§23 (1) Nr.2 EStG" },
        { key: "trade_freigrenze", label: `매매 면세한계 판정 (€${TRADE_FREIGRENZE})`, amount: lt(taxableGains, TRADE_FREIGRENZE) ? ZERO : taxableGains, rate: "전액 과세형" },
        { key: "other_income", label: "기타소득 (스테이킹·에어드랍)", amount: incomeTotal, basis: "§22 Nr.3 EStG" },
        { key: "income_freigrenze", label: `기타소득 면세한계 판정 (€${OTHER_INCOME_FREIGRENZE})`, amount: lt(incomeTotal, OTHER_INCOME_FREIGRENZE) ? ZERO : incomeTotal, rate: "전액 과세형" },
        { key: "gains_charge", label: "양도분 예상 부담", amount: gainsCharge, rate: `${profile.marginalRatePercent}% + Soli 5.5%` },
        { key: "income_charge", label: "기타소득 예상 부담", amount: incomeCharge, rate: `${profile.marginalRatePercent}% + Soli 5.5%` },
      ],
      notes: [
        "1년 초과 보유 후 처분은 금액과 무관하게 전액 비과세입니다.",
        "스테이킹 보상 토큰은 수령일부터 새로 1년 보유기간이 시작됩니다(BMF 2025.3.6 재확인).",
        "면세한계는 차감형 공제가 아니라 초과 시 전액 과세되는 구조입니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이 LP·일드파밍에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
        { topic: "WRAPPING", status: "UNDETERMINED", reason: "랩핑의 처분 해당 여부에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["종합소득세 한계세율 (지갑 외 소득 포함, 14~45%)"],
      excludedEventIds,
    });
  },
};
