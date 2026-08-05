import { ZERO, add, clampPositive, isNegative, min, mul, sub, sum } from "@/lib/tax/decimal";
import { incrementalCharge } from "@/lib/tax/brackets";
import type { Bracket } from "@/lib/tax/brackets";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleContext, RuleSetDefinition } from "@/lib/tax/types";

/** 거주자 한계세율 (2024-25). */
const RESIDENT_BRACKETS: Bracket[] = [
  { upTo: "18200", ratePercent: "0" },
  { upTo: "45000", ratePercent: "16" },
  { upTo: "135000", ratePercent: "30" },
  { upTo: "190000", ratePercent: "37" },
  { upTo: null, ratePercent: "45" },
];

/** 12개월 초과 보유분 CGT 할인율. */
const CGT_DISCOUNT = "0.5";
/**
 * CGT 50% 할인은 "12개월 초과 보유"다 — 일수 365가 아니라 **달력 12개월**이 기준이다.
 * 비윤년/윤년에 따라 12개월이 365일이거나 366일이라, 일수로 재면 같은 날짜 1년 보유가
 * 어떤 해에는 적격, 어떤 해에는 비적격이 된다.
 */
function heldOverTwelveMonths(row: GainRow): boolean {
  if (row.acquiredAt === null) return false;
  const acquired = new Date(row.acquiredAt);
  const year = acquired.getUTCFullYear() + 1;
  const month = acquired.getUTCMonth();
  // 2/29 취득의 다음 해 기념일은 2/28이다. setUTCFullYear에 맡기면 3/1로 밀려
  // 3/1 처분이 비적격으로 잘못 판정된다.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const anniversary = Date.UTC(
    year,
    month,
    Math.min(acquired.getUTCDate(), lastDay),
    acquired.getUTCHours(),
    acquired.getUTCMinutes(),
    acquired.getUTCSeconds(),
    acquired.getUTCMilliseconds(),
  );
  return Date.parse(row.at) > anniversary;
}

function isDiscountEligible(row: GainRow): boolean {
  return !isNegative(row.gain) && heldOverTwelveMonths(row);
}


export const australia: RuleSetDefinition = {
  code: "AU",
  label: "호주",
  currency: "AUD",
  cost_basis: "FIFO",
  badge_label: "AU CGT 50% 할인",
  demoPriority: 3,
  status: "CONFIRMED",
  profileFields: ["otherIncome", "isBusiness", "carriedLosses"],
  aggregateAdjustment: "discount",
  ledger: {
    method: "FIFO",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    // initial allocation 에어드랍은 수령 시 비과세 · 취득원가 0.
    zeroBasisIncomeKinds: ["AIRDROP_INITIAL"],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "ITAA 1997 s.115-100", note: "12개월 초과분 50% 할인" },
    { topic: "STAKING", status: "CONFIRMED", basis: "ATO 공식 가이드" },
    { topic: "AIRDROP", status: "CONFIRMED", basis: "ATO 공식 가이드", note: "initial allocation은 수령 비과세·원가 0" },
    { topic: "DEFI_LP", status: "CONFIRMED", basis: "ATO \"DeFi and wrapping crypto\" 가이드", note: "예치·제거가 CGT event" },
    { topic: "WRAPPING", status: "PARTIAL", basis: "ATO 사적 유권해석 (비공식)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "ITAA 1997", note: "손실 차감이 할인보다 먼저" },
  ],

  /** 호주 과세연도: 7/1 ~ 다음해 6/30. */
  taxPeriod: (taxYear: number) => ({ from: `${taxYear}-07-01T00:00:00.000Z`, to: `${taxYear + 1}-07-01T00:00:00.000Z` }),
  judgeGain(row: GainRow, context: RuleContext): JudgmentVerdict {
    if (isNegative(row.gain)) {
      return { group: "carry", label: "손실 · 상계 대상", basis: "ITAA 1997" };
    }

    // 사업자(거래소득)로 선언하면 자본이득이 아니라 사업소득이라 50% 할인이 없다.
    if (context.profile.isBusiness) {
      return { group: "taxable", label: "과세 · 사업소득(할인 없음)", basis: "ITAA 1997 s.6-5" };
    }

    if (isDiscountEligible(row)) {
      return { group: "taxable", label: "과세 · 50% 할인 적격", basis: "ITAA 1997 s.115-100" };
    }

    return { group: "taxable", label: "과세 · 할인 비적격", basis: "ITAA 1997" };
  },
  judgeIncome(): JudgmentVerdict {
    // 에어드랍이든 스테이킹이든 호주는 수령 시 시가로 소득 인식한다 — 근거가 갈리지 않는다.
    return { group: "income", label: "소득 · 과세", basis: "ATO 공식 가이드" };
  },
  compute({ events, ledger, profile, taxYear, excludedEventIds }) {
    // 사업자 선언 시 CGT 할인 자체가 없다 — 전부 비적격으로 다룬다.
    const discountable = (row: GainRow) => !profile.isBusiness && isDiscountEligible(row);
    const eligible = sum(ledger.gains.filter(discountable).map((row) => clampPositive(row.gain)));
    const nonEligible = sum(
      ledger.gains.filter((row) => !isNegative(row.gain) && !discountable(row)).map((row) => clampPositive(row.gain)),
    );
    const currentLosses = sum(ledger.gains.filter((row) => isNegative(row.gain)).map((row) => clampPositive(sub(ZERO, row.gain))));
    const losses = add(currentLosses, profile.carriedLosses);

    // 법정 순서: 손실을 먼저 차감하되 비할인 이익부터 상계하고, 남은 할인적격 이익에만 50% 할인.
    const appliedToNonEligible = min(losses, nonEligible);
    const remainingLosses = sub(losses, appliedToNonEligible);
    const appliedToEligible = min(remainingLosses, eligible);
    const nonEligibleAfter = sub(nonEligible, appliedToNonEligible);
    const eligibleAfter = sub(eligible, appliedToEligible);
    const discounted = mul(eligibleAfter, CGT_DISCOUNT);
    const netCapitalGain = add(nonEligibleAfter, discounted);

    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const charge = incrementalCharge(profile.otherIncome, add(incomeTotal, netCapitalGain), RESIDENT_BRACKETS);
    const initialAllocations = events.filter((event) => event.kind === "INCOME" && event.incomeKind === "AIRDROP_INITIAL").length;

    return finalizeEstimate({
      country: "AU",
      countryLabel: "호주",
      currency: "AUD",
      taxYear,
      method: "FIFO + 12개월 초과 50% 할인",
      status: "CONFIRMED",
      taxableGains: netCapitalGain,
      exemptGains: sub(eligibleAfter, discounted),
      incomeTotal,
      taxableBase: add(netCapitalGain, incomeTotal),
      estimatedCharge: charge,
      lossCarryforward: sub(remainingLosses, appliedToEligible),
      lines: [
        { key: "non_eligible", label: "할인 비적격 이익 (12개월 이하)", amount: nonEligible },
        { key: "eligible", label: "할인 적격 이익 (12개월 초과)", amount: eligible },
        { key: "losses", label: "차감된 손실 (할인보다 먼저 적용)", amount: add(appliedToNonEligible, appliedToEligible) },
        { key: "discount", label: "50% 할인액", amount: sub(eligibleAfter, discounted), rate: "50%", basis: "ITAA 1997 s.115-100" },
        { key: "net_capital_gain", label: "순 자본이득 (과세소득 합산분)", amount: netCapitalGain },
        { key: "income", label: "스테이킹·에어드랍 소득", amount: incomeTotal },
        { key: "charge", label: "예상 부담 (한계세율 적용)", amount: charge, rate: "0~45% 누진" },
      ],
      notes: [
        "손실 차감이 50% 할인보다 먼저입니다(역순 적용 시 과소 산출).",
        "손실은 비할인 이익부터 상계하고, 이월분은 오래된 것부터 사용합니다.",
        initialAllocations > 0 ? "initial allocation 에어드랍은 수령 시 비과세이며 취득원가 0으로 처리했습니다." : "initial allocation 에어드랍은 확인되지 않았습니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "WRAPPING", status: "PARTIAL", reason: "랩핑의 CGT event 해당 여부는 사적 유권해석(비공식) 수준입니다.", affectedEventIds: [] },
        { topic: "CAPITAL_GAINS", status: "UNDETERMINED", reason: "2027 CGT 개편(할인 폐지 → 지수화 + 30% 최저세)은 예산안 발표 단계입니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["지갑 외 과세소득", "투자자/사업자 구분 선언"],
      excludedEventIds,
    });
  },
};
