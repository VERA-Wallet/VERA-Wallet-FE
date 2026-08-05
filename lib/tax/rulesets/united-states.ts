import { ZERO, abs, add, clampPositive, gt, isNegative, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { incrementalCharge } from "@/lib/tax/brackets";
import type { Bracket } from "@/lib/tax/brackets";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/** 2025 과세연도 일반세율 7구간. */
const ORDINARY: Record<"SINGLE" | "JOINT", Bracket[]> = {
  SINGLE: [
    { upTo: "11925", ratePercent: "10" },
    { upTo: "48475", ratePercent: "12" },
    { upTo: "103350", ratePercent: "22" },
    { upTo: "197300", ratePercent: "24" },
    { upTo: "250525", ratePercent: "32" },
    { upTo: "626350", ratePercent: "35" },
    { upTo: null, ratePercent: "37" },
  ],
  JOINT: [
    { upTo: "23850", ratePercent: "10" },
    { upTo: "96950", ratePercent: "12" },
    { upTo: "206700", ratePercent: "22" },
    { upTo: "394600", ratePercent: "24" },
    { upTo: "501050", ratePercent: "32" },
    { upTo: "751600", ratePercent: "35" },
    { upTo: null, ratePercent: "37" },
  ],
};

/** 2025 장기양도(LTCG) 우대세율 경계. */
const LTCG: Record<"SINGLE" | "JOINT", Bracket[]> = {
  SINGLE: [
    { upTo: "48350", ratePercent: "0" },
    { upTo: "533400", ratePercent: "15" },
    { upTo: null, ratePercent: "20" },
  ],
  JOINT: [
    { upTo: "96700", ratePercent: "0" },
    { upTo: "600050", ratePercent: "15" },
    { upTo: null, ratePercent: "20" },
  ],
};

const NIIT_THRESHOLD: Record<"SINGLE" | "JOINT", Decimal> = { SINGLE: "200000", JOINT: "250000" };
const NIIT_RATE = "3.8";
/** 자본손실의 일반소득 차감 한도(연). 잔여는 무기한 이월. */
const ORDINARY_LOSS_CAP = "3000";

export const unitedStates: RuleSetDefinition = {
  code: "US",
  label: "미국",
  currency: "USD",
  cost_basis: "FIFO",
  badge_label: "US FIFO",
  demoPriority: 1,
  status: "CONFIRMED",
  profileFields: ["otherIncome", "filingStatus", "carriedLosses"],
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
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "IRC §61·§1001·§1(h), Notice 2014-21" },
    { topic: "STAKING", status: "CONFIRMED", basis: "Rev. Rul. 2023-14", note: "dominion & control 획득 시점 FMV" },
    { topic: "AIRDROP", status: "CONFIRMED", basis: "Rev. Rul. 2019-24" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "IRC §1001 (재산 교환)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "IRC §1211(b)", note: "wash sale 미적용 (크립토는 증권 아님)" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "IRS 실체 과세 가이드라인 부재 (Notice 2024-57은 보고 유예만)" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow): JudgmentVerdict {
    if (isNegative(row.gain)) {
      return { group: "carry", label: "손실 · 상계 대상", basis: "IRC §1211(b)" };
    }

    return row.holdingDays !== null && row.holdingDays > 365
      ? { group: "taxable", label: "과세 · 장기", basis: "IRC §1(h) 장기 자본이득" }
      : { group: "taxable", label: "과세 · 단기", basis: "IRC §1001·§61" };
  },
  judgeIncome(row): JudgmentVerdict {
    const isAirdrop = row.incomeKind === "AIRDROP" || row.incomeKind === "AIRDROP_INITIAL";
    return { group: "income", label: "소득 · 과세", basis: isAirdrop ? "Rev. Rul. 2019-24" : "Rev. Rul. 2023-14" };
  },

  compute({ ledger, profile, taxYear, excludedEventIds }) {
    const status = profile.filingStatus;
    // 보유일수를 특정할 수 없는 행(이관 이력 누락)은 보수적으로 단기로 본다.
    const shortNet = sum(ledger.gains.filter((row) => row.holdingDays === null || row.holdingDays <= 365).map((row) => row.gain));
    const longNet = sum(ledger.gains.filter((row) => row.holdingDays !== null && row.holdingDays > 365).map((row) => row.gain));
    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    const combined = sub(add(shortNet, longNet), profile.carriedLosses);

    let taxableShort = ZERO;
    let taxableLong = ZERO;
    let ordinaryOffset = ZERO;
    let carryforward = ZERO;
    if (isNegative(combined)) {
      ordinaryOffset = min(ORDINARY_LOSS_CAP, abs(combined));
      carryforward = sub(abs(combined), ordinaryOffset);
    } else if (isNegative(shortNet)) {
      taxableLong = combined;
    } else if (isNegative(longNet)) {
      taxableShort = combined;
    } else {
      taxableShort = clampPositive(sub(shortNet, profile.carriedLosses));
      taxableLong = clampPositive(sub(combined, taxableShort));
    }

    const ordinaryBase = clampPositive(sub(profile.otherIncome, ordinaryOffset));
    const ordinaryAddition = add(incomeTotal, taxableShort);
    const ordinaryCharge = incrementalCharge(ordinaryBase, ordinaryAddition, ORDINARY[status]);
    // 장기 양도차익은 일반소득 **위에** 얹혀 0/15/20% 구간을 가로지른다.
    // 전액에 단일 세율을 곱하면 구간을 넘는 순간 답이 틀린다.
    const ltcgCharge = incrementalCharge(add(ordinaryBase, ordinaryAddition), taxableLong, LTCG[status]);

    const magi = add(add(profile.otherIncome, incomeTotal), add(taxableShort, taxableLong));
    const netInvestmentIncome = add(taxableShort, taxableLong);
    const niitBase = min(netInvestmentIncome, clampPositive(sub(magi, NIIT_THRESHOLD[status])));
    const niitCharge = gt(niitBase, ZERO) ? percentOf(niitBase, NIIT_RATE) : ZERO;

    return finalizeEstimate({
      country: "US",
      countryLabel: "미국",
      currency: "USD",
      taxYear,
      method: "FIFO (지갑별, Rev. Proc. 2024-28)",
      status: "CONFIRMED",
      taxableGains: add(taxableShort, taxableLong),
      exemptGains: ZERO,
      incomeTotal,
      taxableBase: add(add(taxableShort, taxableLong), incomeTotal),
      estimatedCharge: add(add(ordinaryCharge, ltcgCharge), niitCharge),
      lossCarryforward: carryforward,
      lines: [
        { key: "short_gains", label: "단기 양도손익 (1년 이하)", amount: shortNet, basis: "IRC §1222" },
        { key: "long_gains", label: "장기 양도손익 (1년 초과)", amount: longNet, basis: "IRC §1(h)" },
        { key: "income", label: "일반소득 (스테이킹·에어드랍)", amount: incomeTotal, basis: "Rev. Rul. 2023-14 / 2019-24" },
        { key: "ordinary_offset", label: "일반소득 상계 (연 $3,000 한도)", amount: ordinaryOffset, basis: "IRC §1211(b)" },
        { key: "ordinary_charge", label: "일반세율 적용분 예상 부담", amount: ordinaryCharge, rate: "10~37% 누진" },
        { key: "ltcg_charge", label: "장기 우대세율 적용분 예상 부담", amount: ltcgCharge, rate: "0/15/20% 구간" },
        { key: "niit_charge", label: "순투자소득 추가 부담 (NIIT)", amount: niitCharge, rate: `${NIIT_RATE}%` },
      ],
      notes: [
        "2025년부터 취득원가를 지갑별로 관리해야 합니다(Rev. Proc. 2024-28).",
        "크립토는 증권이 아니므로 wash sale 규정이 적용되지 않습니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이 예치·랩핑의 실체 과세 기준이 아직 제시되지 않았습니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["지갑 외 과세소득", "신고 구분 (단독/부부합산)"],
      excludedEventIds,
    });
  },
};
