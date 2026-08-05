import { ZERO, abs, add, clampPositive, isNegative, isPositive, isZero, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import { marginalRatePercent, progressiveCharge } from "@/lib/tax/brackets";
import type { Bracket } from "@/lib/tax/brackets";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** 저축소득 분리 누진(base del ahorro). 일반소득과 분리 계산한다. */
/** 순 자본손실은 다른 저축소득의 25%까지 상계할 수 있다(LIRPF 49). */
const LOSS_OFFSET_CAP_PERCENT = "25";

const SAVINGS_BRACKETS: Bracket[] = [
  { upTo: "6000", ratePercent: "19" },
  { upTo: "50000", ratePercent: "21" },
  { upTo: "200000", ratePercent: "23" },
  { upTo: "300000", ratePercent: "27" },
  { upTo: null, ratePercent: "30" },
];

export const spain: RuleSetDefinition = {
  code: "ES",
  label: "스페인",
  currency: "EUR",
  cost_basis: "FIFO",
  badge_label: "ES 저축소득 19~30%",
  demoPriority: null,
  status: "CONFIRMED",
  profileFields: ["carriedLosses"],
  aggregateAdjustment: "offset",
  ledger: {
    method: "FIFO",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "IRPF base del ahorro, AEAT 가이드" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "AEAT (물물교환 취급)" },
    { topic: "STAKING", status: "CONFIRMED", basis: "투자소득 → 저축베이스" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "IRPF", note: "4년 이월, 이후 다른 저축소득의 25%까지" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, _context, estimate): JudgmentVerdict {
    if (isNegative(row.gain)) return { group: "carry", label: "손실 · 상계 대상", basis: "IRPF" };
    // 법정 건별 배분 규칙이 없어 연간 상계 적용분을 특정 행에 배분하지 않는다.
    return isPositive(row.gain) && isZero(estimate.totals.taxableGains)
      ? { group: "offset", label: "상계로 소멸 · 과세분 없음", basis: "IRPF base del ahorro" }
      : { group: "taxable", label: "과세 · 연간 손익 상계 적용 전", basis: "IRPF base del ahorro" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "투자소득 → 저축베이스" };
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const net = sub(sum(ledger.gains.map((row) => row.gain)), profile.carriedLosses);
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const taxableGains = clampPositive(net);
    // 순 자본손실은 다른 저축소득의 25%까지 상계할 수 있다(LIRPF 49).
    // 선언만 하고 계산하지 않으면 손실이 있는 사람의 부담이 과대해진다.
    const netLoss = isNegative(net) ? abs(net) : ZERO;
    const offsetCap = percentOf(incomeTotal, LOSS_OFFSET_CAP_PERCENT);
    const appliedOffset = min(netLoss, offsetCap);
    const taxableIncome = sub(incomeTotal, appliedOffset);
    // 저축베이스는 양도차익과 투자소득을 합쳐 동일 누진표로 계산한다.
    const base = add(taxableGains, taxableIncome);
    const charge = progressiveCharge(base, SAVINGS_BRACKETS);

    return finalizeEstimate({
      country: "ES",
      countryLabel: "스페인",
      currency: "EUR",
      taxYear,
      method: "FIFO 강제",
      status: "CONFIRMED",
      taxableGains,
      exemptGains: ZERO,
      incomeTotal,
      taxableBase: base,
      estimatedCharge: charge,
      // 올해 소득 상계로 쓴 몫은 다음 기간으로 넘기지 않는다 — 넘기면 이중 공제가 된다.
      lossCarryforward: sub(netLoss, appliedOffset),
      lines: [
        { key: "loss_offset_applied", label: "손실의 저축소득 상계 적용분 (최대 25%)", amount: appliedOffset, basis: "LIRPF 49" },
        { key: "net_gains", label: "순 양도손익", amount: taxableGains, basis: "IRPF base del ahorro" },
        { key: "income", label: "스테이킹 (저축베이스 합산)", amount: incomeTotal },
        { key: "savings_base", label: "저축소득 과세표준", amount: base, rate: "19/21/23/27/30% 누진" },
        { key: "charge", label: "예상 부담", amount: charge, rate: `한계 ${marginalRatePercent(base, SAVINGS_BRACKETS)}%` },
      ],
      notes: [
        "저축소득은 일반소득과 분리해 계산합니다.",
        "예: €60,000 → 6,000×19% + 44,000×21% + 10,000×23%.",
        "손실은 유사 자본이득과 상계하고 4년간 이월할 수 있습니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이 LP·랩핑에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: [],
      excludedEventIds,
    });
  },
};
