import { ZERO, add, div, gt, isZero, mul, round } from "@/lib/tax/decimal";
import { EXCLUDED_ID_SUFFIX, limitationOf, sortLimitations } from "@/lib/tax/limitations";
import type { Decimal } from "@/lib/tax/decimal";
import type {
  CountryCode,
  ConfirmationStatus,
  Limitation,
  OpenQuestion,
  TaxEstimate,
  TaxLine,
} from "@/lib/tax/types";

export type EstimateDraft = {
  country: CountryCode;
  countryLabel: string;
  currency: string;
  taxYear: number;
  method: string;
  status: ConfirmationStatus;
  lines: TaxLine[];
  taxableGains: Decimal;
  exemptGains: Decimal;
  incomeTotal: Decimal;
  taxableBase: Decimal;
  estimatedCharge: Decimal;
  lossCarryforward?: Decimal;
  notes?: string[];
  openQuestions?: OpenQuestion[];
  requiredInputs?: string[];
  excludedEventIds?: string[];
  /** 원장·파생이 구조로 낸 한계. notes에서 추측하지 않는다. */
  limitations?: Limitation[];
};

/**
 * 사유를 아는 생산자가 이미 낸 제외는 그대로 두고,
 * 아무도 말하지 않은 제외 id만 채운다. 둘 다 내면 같은 사실을 두 번 말한다.
 */
function withExclusions(limitations: Limitation[], excludedEventIds: string[]): Limitation[] {
  const covered = new Set(limitations.flatMap((row) => row.eventIds));
  const uncovered = excludedEventIds.filter((id) => !covered.has(id));
  return [
    ...limitations,
    ...uncovered.map((id) => limitationOf(`${id}:${EXCLUDED_ID_SUFFIX}`, [id])),
  ];
}

/** 룰셋 계산 결과를 공통 형태로 마감한다(반올림·실효세율 산출 지점을 한 곳으로 고정). */
export function finalizeEstimate(draft: EstimateDraft): TaxEstimate {
  const denominator = add(draft.taxableGains, draft.incomeTotal);
  const effectiveRatePercent = isZero(denominator) || !gt(draft.estimatedCharge, ZERO)
    ? ZERO
    : round(mul(div(draft.estimatedCharge, denominator), "100"), 2);

  return {
    country: draft.country,
    countryLabel: draft.countryLabel,
    currency: draft.currency,
    taxYear: draft.taxYear,
    method: draft.method,
    status: draft.status,
    lines: draft.lines.map((line) => ({ ...line, amount: round(line.amount, 2) })),
    totals: {
      taxableGains: round(draft.taxableGains, 2),
      exemptGains: round(draft.exemptGains, 2),
      incomeTotal: round(draft.incomeTotal, 2),
      taxableBase: round(draft.taxableBase, 2),
      estimatedCharge: round(draft.estimatedCharge, 2),
      effectiveRatePercent,
    },
    lossCarryforward: round(draft.lossCarryforward ?? ZERO, 2),
    notes: draft.notes ?? [],
    limitations: sortLimitations(withExclusions(draft.limitations ?? [], draft.excludedEventIds ?? [])),
    openQuestions: draft.openQuestions ?? [],
    requiredInputs: draft.requiredInputs ?? [],
    excludedEventIds: draft.excludedEventIds ?? [],
    provenance: "mock",
    // 과세기간과 건별 판정은 룰셋 밖(computeTaxEstimate)에서 채운다.
    period: { from: "", to: "" },
    judgments: [],
  };
}
