import { ZERO, abs, add, clampPositive, isNegative, isPositive, isZero, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** 대체세(imposta sostitutiva). 2026.1.1 실현분부터 33%. */
const RATE_2025 = "26";
const RATE_2026 = "33";
/** 2025년까지만 유효한 €2,000 면세한계(2026년부터 폐지). */
const EXEMPTION_2025 = "2000";

export const italy: RuleSetDefinition = {
  code: "IT",
  label: "이탈리아",
  currency: "EUR",
  cost_basis: "FIFO",
  badge_label: "IT 대체세 26/33%",
  demoPriority: null,
  status: "CONFIRMED",
  profileFields: ["marginalRatePercent", "carriedLosses"],
  // 연간 면세한계는 2025년까지다(2026 폐지).
  aggregateAdjustment: ({ taxYear }) => (taxYear >= 2026 ? "offset" : "allowance"),
  ledger: {
    method: "FIFO",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "TUIR Art.67(1) c-sexies (Law 197/2022)" },
    { topic: "CAPITAL_GAINS", status: "SCHEDULED", basis: "Law 207/2024 Art.1 §24", note: "2026.1.1 실현분부터 33%" },
    { topic: "STAKING", status: "PARTIAL", basis: "수령 시 기타소득 처리 (IRPEF 누진 가능성)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "TUIR", note: "동종 소득 내 상계" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, _context, estimate): JudgmentVerdict {
    if (isNegative(row.gain)) return { group: "carry", label: "손실 · 상계 대상", basis: "TUIR Art.67(1) c-sexies" };
    // 법정 건별 배분 규칙이 없어 연간 집계 적용분을 특정 행에 배분하지 않는다.
    return isPositive(row.gain) && isZero(estimate.totals.taxableGains)
      ? isZero(estimate.totals.exemptGains)
        // 면세한계가 쓰이지 않았다면 상계·전년 결손 등 다른 집계 연산으로 사라진 것이다.
        // 어느 쪽인지 totals만으로는 단정할 수 없으므로 사유를 특정하지 않는다.
        ? { group: "offset", label: "과세분 없음 · 연간 집계 적용", basis: "TUIR Art.67(1) c-sexies" }
        : { group: "exempt", label: "비과세 · 연간 면세한계 내", basis: "TUIR Art.67(1) c-sexies" }
      : { group: "taxable", label: "과세 · 연간 면세한계 적용 전", basis: "TUIR Art.67(1) c-sexies" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "수령 시 기타소득 처리 (IRPEF 누진 가능성)" };
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const net = sub(sum(ledger.gains.map((row) => row.gain)), profile.carriedLosses);
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const rate = taxYear >= 2026 ? RATE_2026 : RATE_2025;
    const exemption = taxYear >= 2026 ? ZERO : EXEMPTION_2025;
    const positiveNet = clampPositive(net);
    const taxableGains = clampPositive(sub(positiveNet, exemption));
    const gainsCharge = percentOf(taxableGains, rate);
    // 스테이킹은 기타소득으로 IRPEF 누진 가능성 — 한계세율 입력을 그대로 적용한다.
    const incomeCharge = percentOf(incomeTotal, profile.marginalRatePercent);

    return finalizeEstimate({
      country: "IT",
      countryLabel: "이탈리아",
      currency: "EUR",
      taxYear,
      method: "FIFO (일관 기록 시 LIFO 가능)",
      status: "CONFIRMED",
      taxableGains,
      exemptGains: min(positiveNet, exemption),
      incomeTotal,
      taxableBase: add(taxableGains, incomeTotal),
      estimatedCharge: add(gainsCharge, incomeCharge),
      lossCarryforward: isNegative(net) ? abs(net) : ZERO,
      lines: [
        { key: "net_gains", label: "순 양도손익", amount: net, basis: "TUIR Art.67(1) c-sexies" },
        { key: "exemption", label: `면세한계 (${taxYear >= 2026 ? "폐지" : `€${EXEMPTION_2025}`})`, amount: min(positiveNet, exemption) },
        { key: "gains_charge", label: "양도분 예상 부담 (대체세)", amount: gainsCharge, rate: `${rate}%` },
        { key: "income", label: "스테이킹·마이닝·에어드랍 수령분", amount: incomeTotal },
        { key: "income_charge", label: "기타소득 예상 부담", amount: incomeCharge, rate: `${profile.marginalRatePercent}% (IRPEF 누진)` },
      ],
      notes: [
        taxYear >= 2026 ? "2026년부터 €1부터 전액 과세되며 세율이 33%입니다." : "2025년 실현분은 26% + €2,000 면세한계가 적용됩니다.",
        "유로 연동 스테이블코인(EMT)은 26%가 유지됩니다(Law 199/2025).",
        "2025.1.1 기준 자산가치의 18% 대체세로 취득원가 step-up을 선택할 수 있습니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "STAKING", status: "PARTIAL", reason: "스테이킹·마이닝 수령분의 소득 구분(기타소득/IRPEF 누진)이 확정적이지 않습니다.", affectedEventIds: ledger.income.map((row) => row.eventId) },
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["IRPEF 한계세율 (기타소득 적용)"],
      excludedEventIds,
    });
  },
};
