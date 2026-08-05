import { ZERO, sum } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { JudgmentVerdict, RuleSetDefinition } from "@/lib/tax/types";

/**
 * 한국은 룰이 확정되지 않아 금액을 산출하지 않는다.
 * 대신 확정 시 즉시 이식할 수 있도록 스위칭 벤치마크(어느 국가 모델을 복제할지)를 함께 노출한다.
 * 원장 집계 자체는 다른 국가와 동일하게 수행하므로, 고시가 나오면 compute만 교체하면 된다.
 */
export const korea: RuleSetDefinition = {
  code: "KR",
  label: "한국",
  currency: "KRW",
  cost_basis: "per_address",
  badge_label: "KR 이동평균/FIFO",
  demoPriority: null,
  status: "UNDETERMINED",
  profileFields: [],
  // 규칙 미확정이라 과세분을 산출하지 않는다 — 조정이라 부를 것이 없다.
  aggregateAdjustment: "none",
  ledger: {
    method: "FIFO",
    scope: "WALLET",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "UNDETERMINED", basis: "시행 시기·과세 방식 미확정" },
    { topic: "STAKING", status: "UNDETERMINED", basis: "수령 시 과세 / 매도 시 일괄 과세 여부 미확정" },
    { topic: "AIRDROP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "CRYPTO_TO_CRYPTO", status: "UNDETERMINED", basis: "교환의 처분 해당 여부 미확정" },
    { topic: "LOSS_OFFSET", status: "UNDETERMINED", basis: "손실 상계·이월 허용 여부 미확정" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(): JudgmentVerdict {
    return { group: "pending", label: "판정 보류 · 규칙 미확정", basis: "시행 시기·과세 방식 미확정" };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "pending", label: "판정 보류 · 규칙 미확정", basis: "수령 시 과세 / 매도 시 일괄 과세 여부 미확정" };
  },

  compute({ ledger, taxYear, excludedEventIds }) {
    const grossGains = sum(ledger.gains.map((row) => row.gain));
    const incomeTotal = sum(ledger.income.map((row) => row.amount));

    return finalizeEstimate({
      country: "KR",
      countryLabel: "한국",
      currency: "KRW",
      taxYear,
      method: "원장 집계만 수행 (과세 규칙 미확정)",
      status: "UNDETERMINED",
      // 규칙이 없으므로 과세 대상 금액을 확정하지 않는다.
      taxableGains: ZERO,
      exemptGains: ZERO,
      incomeTotal: ZERO,
      taxableBase: ZERO,
      estimatedCharge: ZERO,
      lines: [
        { key: "ledger_gains", label: "원장 기준 처분 손익 (판정 전)", amount: grossGains },
        { key: "ledger_income", label: "원장 기준 수령분 FMV (판정 전)", amount: incomeTotal },
        { key: "disposal_count", label: "처분 건수", amount: String(ledger.gains.length) , unit: "count" as const },
        { key: "income_count", label: "수령 건수", amount: String(ledger.income.length) , unit: "count" as const },
      ],
      notes: [
        "한국 규칙이 확정되지 않아 부담 추정치를 산출하지 않고 원장 집계만 제공합니다.",
        "확정 시 교체 지점은 이 룰셋의 compute 하나이며, 원장·이벤트 파이프라인은 그대로 재사용합니다.",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "CAPITAL_GAINS", status: "UNDETERMINED", reason: "과세 방식(분리/종합)과 시행 시기가 확정되지 않았습니다.", affectedEventIds: ledger.gains.map((row) => row.eventId), benchmark: "flat 분리과세로 확정되면 인도·포르투갈 아키텍처를 그대로 이식합니다." },
        { topic: "STAKING", status: "UNDETERMINED", reason: "수령 시 과세인지 매도 시 일괄 과세인지 확정되지 않았습니다.", affectedEventIds: ledger.income.map((row) => row.eventId), benchmark: "수령 시 과세면 독일·미국 모델, 매도 시 일괄 과세면 포르투갈 장기면세 모델을 이식합니다." },
        { topic: "LOSS_OFFSET", status: "UNDETERMINED", reason: "손실 상계·이월 허용 여부가 확정되지 않았습니다.", affectedEventIds: [], benchmark: "상계를 불허하면 인도 모델(ignored), 허용하면 포르투갈·독일의 이월 구조를 씁니다." },
      ],
      requiredInputs: ["국세청 고시 확정 (과세 방식·세율·공제·상계 규칙)"],
      excludedEventIds,
    });
  },
};
