import { ZERO, add, clampPositive, isNegative, lte, mul, percentOf, sum } from "@/lib/tax/decimal";
import { incrementalCharge } from "@/lib/tax/brackets";
import type { Bracket } from "@/lib/tax/brackets";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** 국세 누진 7구간. */
const NATIONAL_BRACKETS: Bracket[] = [
  { upTo: "1950000", ratePercent: "5" },
  { upTo: "3300000", ratePercent: "10" },
  { upTo: "6950000", ratePercent: "20" },
  { upTo: "9000000", ratePercent: "23" },
  { upTo: "18000000", ratePercent: "33" },
  { upTo: "40000000", ratePercent: "40" },
  { upTo: null, ratePercent: "45" },
];

/** 부흥특별소득세 2.1% 가산 계수. */
const RECONSTRUCTION = "1.021";
/** 주민세 10%. */
const RESIDENT_RATE = "10";
/** 급여소득자 확정신고 면제 기준. */
const SALARIED_THRESHOLD = "200000";

export const japan: RuleSetDefinition = {
  code: "JP",
  label: "일본",
  currency: "JPY",
  cost_basis: "total_average",
  badge_label: "JP 잡소득 종합과세",
  demoPriority: null,
  status: "CONFIRMED",
  profileFields: ["otherIncome"],
  aggregateAdjustment: "offset",
  ledger: {
    // 총평균법(기본값). 이동평균법은 신고 후 고정 선택.
    method: "PERIOD_AVERAGE",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "소득세법 잡소득 + NTA 가이드", note: "크립토→크립토 스왑도 과세" },
    { topic: "STAKING", status: "CONFIRMED", basis: "NTA 가이드 (수령 시 FMV 잡소득)" },
    { topic: "AIRDROP", status: "CONFIRMED", basis: "NTA 가이드" },
    { topic: "DEFI_LP", status: "CONFIRMED", basis: "NTA 가이드 (잡소득)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "소득세법", note: "같은 해 잡소득 내 상계만, 이월 불가" },
  ],
  judgeGain(row: GainRow): JudgmentVerdict {
    return isNegative(row.gain)
      ? { group: "carry", label: "손실 · 당해 상계만(이월 불가)", basis: "소득세법 (같은 해 잡소득 내 상계만, 이월 불가)" }
      : { group: "taxable", label: "과세 · 잡소득", basis: "소득세법 잡소득 + NTA 가이드" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "NTA 가이드" };
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const gainsNet = sum(ledger.gains.map((row) => row.gain));
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    // 매매·스왑·스테이킹·디파이가 모두 잡소득으로 합산된다(같은 해 내 상계만 가능).
    const misc = clampPositive(add(gainsNet, incomeTotal));
    const nationalCharge = mul(incrementalCharge(profile.otherIncome, misc, NATIONAL_BRACKETS), RECONSTRUCTION);
    const residentCharge = percentOf(misc, RESIDENT_RATE);
    const salariedExempt = lte(misc, SALARIED_THRESHOLD);

    return finalizeEstimate({
      country: "JP",
      countryLabel: "일본",
      currency: "JPY",
      taxYear,
      method: "총평균법 (이동평균법 선택 가능)",
      status: "CONFIRMED",
      taxableGains: clampPositive(gainsNet),
      exemptGains: ZERO,
      incomeTotal,
      taxableBase: misc,
      estimatedCharge: add(nationalCharge, residentCharge),
      lossCarryforward: ZERO,
      lines: [
        { key: "trade_gains", label: "매매·스왑 손익", amount: gainsNet, basis: "잡소득" },
        { key: "income", label: "스테이킹·렌딩·디파이·에어드랍", amount: incomeTotal, basis: "NTA 가이드" },
        { key: "misc_total", label: "잡소득 합계", amount: misc, rate: "종합과세" },
        { key: "national_charge", label: "국세 예상 부담 (부흥세 포함)", amount: nationalCharge, rate: "5~45% + 2.1%" },
        { key: "resident_charge", label: "주민세 예상 부담", amount: residentCharge, rate: `${RESIDENT_RATE}%` },
      ],
      notes: [
        "매매·스왑·스테이킹·디파이가 전부 잡소득으로 종합과세되며 최고 약 55.945%입니다.",
        "손실은 같은 해 잡소득 내에서만 상계되고 이월할 수 없습니다.",
        salariedExempt ? `급여소득자는 잡소득이 ${SALARIED_THRESHOLD}엔 이하이면 확정 절차가 면제됩니다.` : "잡소득이 급여소득자 면제 기준을 초과합니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "CAPITAL_GAINS", status: "UNDETERMINED", reason: "20.315% 분리과세 개혁은 FIEA 개정 절차 중이며 개인 적용은 2028.1.1 전망입니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["지갑 외 과세소득 (종합과세 누진구간 판정)"],
      excludedEventIds,
    });
  },
};
