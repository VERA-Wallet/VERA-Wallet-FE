import { ZERO, abs, add, clampPositive, isNegative, isPositive, isZero, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import { incrementalCharge } from "@/lib/tax/brackets";
import type { Bracket } from "@/lib/tax/brackets";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** 연간 면세 한도(AEA) — 차감형 공제. */
const ANNUAL_EXEMPT_AMOUNT = "3000";
const PERSONAL_ALLOWANCE = "12570";
/** 기본세율 밴드 폭. 소득세 과세표준을 먼저 채우고 남은 만큼만 CGT 18%가 적용된다. */
const BASIC_BAND = "37700";
const CGT_BASIC_RATE = "18";
const CGT_HIGHER_RATE = "24";

const INCOME_BRACKETS: Bracket[] = [
  { upTo: PERSONAL_ALLOWANCE, ratePercent: "0" },
  { upTo: "50270", ratePercent: "20" },
  { upTo: "125140", ratePercent: "40" },
  { upTo: null, ratePercent: "45" },
];

export const unitedKingdom: RuleSetDefinition = {
  code: "GB",
  label: "영국",
  currency: "GBP",
  cost_basis: "share_pooling",
  badge_label: "UK share pooling",
  demoPriority: 3,
  status: "CONFIRMED",
  profileFields: ["otherIncome", "defiOwnershipTransferred", "carriedLosses"],
  aggregateAdjustment: "allowance",
  ledger: {
    method: "SECTION_104",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "TCGA 1992 + HMRC Cryptoassets Manual", note: "same-day → 30일 → Section 104 풀 순서" },
    { topic: "STAKING", status: "CONFIRMED", basis: "HMRC Cryptoassets Manual (income)" },
    { topic: "AIRDROP", status: "CONFIRMED", basis: "HMRC Cryptoassets Manual" },
    { topic: "DEFI_LP", status: "PARTIAL", basis: "HMRC CRYPTO60000+ (beneficial ownership 기준)", note: "사실관계 판정 입력 필요" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "TCGA 1992", note: "손실 무기한 이월(4년 내 신고)" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "디파이 NGNL 신규 규정 입법 미완" },
  ],

  /** 영국 과세연도: 4/6 ~ 다음해 4/5. */
  taxPeriod: (taxYear: number) => ({ from: `${taxYear}-04-06T00:00:00.000Z`, to: `${taxYear + 1}-04-06T00:00:00.000Z` }),
  judgeGain(row: GainRow, _context, estimate): JudgmentVerdict {
    if (isNegative(row.gain)) return { group: "carry", label: "손실 · 상계 대상", basis: "TCGA 1992" };
    // 법정 건별 배분 규칙이 없어 연간 집계 적용분을 특정 행에 배분하지 않는다.
    return isPositive(row.gain) && isZero(estimate.totals.taxableGains)
      ? isZero(estimate.totals.exemptGains)
        // 면세 한도가 쓰이지 않았다면 상계·전년 결손 등 다른 집계 연산으로 사라진 것이다.
        // 어느 쪽인지 totals만으로는 단정할 수 없으므로 사유를 특정하지 않는다.
        ? { group: "offset", label: "과세분 없음 · 연간 집계 적용", basis: "TCGA 1992" }
        : { group: "exempt", label: "비과세 · 연간 면세 한도 내", basis: "TCGA 1992 (AEA)" }
      : { group: "taxable", label: "과세 · 연간 면세 한도 적용 전", basis: "TCGA 1992 (AEA 연간 집계 적용)" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "HMRC Cryptoassets Manual (income)" };
  },
  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const net = sub(sum(ledger.gains.map((row) => row.gain)), profile.carriedLosses);
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const taxableGains = clampPositive(sub(clampPositive(net), ANNUAL_EXEMPT_AMOUNT));

    const incomeCharge = incrementalCharge(profile.otherIncome, incomeTotal, INCOME_BRACKETS);
    // CGT 밴드 판정: 소득세 과세표준이 먼저 기본세율 밴드를 소진한다.
    const taxableIncome = clampPositive(sub(add(profile.otherIncome, incomeTotal), PERSONAL_ALLOWANCE));
    const basicRemaining = clampPositive(sub(BASIC_BAND, taxableIncome));
    const atBasic = min(taxableGains, basicRemaining);
    const atHigher = sub(taxableGains, atBasic);
    const gainsCharge = add(percentOf(atBasic, CGT_BASIC_RATE), percentOf(atHigher, CGT_HIGHER_RATE));

    const defiQuestion = profile.defiOwnershipTransferred
      ? "beneficial ownership 이전으로 선언되어 디파이 예치를 처분으로 계산했습니다."
      : "디파이 예치의 beneficial ownership 이전 여부가 선언되지 않아 처분으로 계산하지 않았습니다.";

    return finalizeEstimate({
      country: "GB",
      countryLabel: "영국",
      currency: "GBP",
      taxYear,
      method: "same-day → 30일 → Section 104 풀",
      status: "CONFIRMED",
      taxableGains,
      exemptGains: min(clampPositive(net), ANNUAL_EXEMPT_AMOUNT),
      incomeTotal,
      taxableBase: add(taxableGains, incomeTotal),
      estimatedCharge: add(gainsCharge, incomeCharge),
      lossCarryforward: isNegative(net) ? abs(net) : ZERO,
      lines: [
        { key: "net_gains", label: "순 양도손익 (매칭 순서 적용)", amount: net, basis: "TCGA 1992" },
        { key: "aea", label: "연간 면세 한도 (AEA, 차감형)", amount: min(clampPositive(net), ANNUAL_EXEMPT_AMOUNT), rate: `£${ANNUAL_EXEMPT_AMOUNT}` },
        { key: "cgt_basic", label: "기본세율 구간 양도분", amount: atBasic, rate: `${CGT_BASIC_RATE}%` },
        { key: "cgt_higher", label: "고세율 구간 양도분", amount: atHigher, rate: `${CGT_HIGHER_RATE}%` },
        { key: "income", label: "스테이킹·에어드랍 소득", amount: incomeTotal, rate: "20/40/45%" },
        { key: "gains_charge", label: "양도분 예상 부담", amount: gainsCharge },
        { key: "income_charge", label: "소득분 예상 부담", amount: incomeCharge },
      ],
      notes: [
        "매칭 순서는 법정입니다: 당일 → 30일 내 재매수(bed & breakfast) → Section 104 풀 평균원가.",
        "AEA는 차감형 공제로, 초과분에만 세율이 적용됩니다.",
        defiQuestion,
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "DEFI_LP", status: "PARTIAL", reason: "beneficial ownership 판정이 사실관계 의존적이라 사용자 선언이 필요합니다.", affectedEventIds: [] },
        { topic: "WRAPPING", status: "UNDETERMINED", reason: "디파이 NGNL 신규 규정은 협의만 종료되고 입법·시행일이 미정입니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["지갑 외 과세소득", "디파이 예치의 beneficial ownership 이전 여부"],
      excludedEventIds,
    });
  },
};
