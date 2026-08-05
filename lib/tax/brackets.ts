import { ZERO, add, clampPositive, gt, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";

/** 누진구간. `upTo`는 구간 상한(포함), null은 최상위 구간. */
export type Bracket = { upTo: Decimal | null; ratePercent: Decimal };

export function progressiveCharge(taxable: Decimal, brackets: Bracket[]): Decimal {
  const base = clampPositive(taxable);
  const parts: Decimal[] = [];
  let consumed = ZERO;
  for (const bracket of brackets) {
    const ceiling = bracket.upTo === null ? base : min(bracket.upTo, base);
    const slice = clampPositive(sub(ceiling, consumed));
    if (gt(slice, ZERO)) parts.push(percentOf(slice, bracket.ratePercent));
    consumed = add(consumed, slice);
    if (bracket.upTo !== null && gt(base, bracket.upTo)) continue;
    break;
  }
  return sum(parts);
}

/**
 * 지갑 밖 소득 위에 얹히는 증분만 산출한다(종합과세 국가).
 * tax(other + addition) - tax(other) — 누진구간 이중계산을 막는 유일한 방법.
 */
export function incrementalCharge(otherIncome: Decimal, addition: Decimal, brackets: Bracket[]): Decimal {
  return clampPositive(sub(progressiveCharge(add(otherIncome, addition), brackets), progressiveCharge(otherIncome, brackets)));
}

/** 해당 과세소득 수준에서의 한계세율(%). */
export function marginalRatePercent(income: Decimal, brackets: Bracket[]): Decimal {
  const base = clampPositive(income);
  for (const bracket of brackets) {
    if (bracket.upTo === null || !gt(base, bracket.upTo)) return bracket.ratePercent;
  }
  return brackets.at(-1)?.ratePercent ?? ZERO;
}

/** 구간별 정률(장기양도 우대세율처럼 소득수준으로 단일세율이 정해지는 경우). */
export function flatRateForIncome(income: Decimal, brackets: Bracket[]): Decimal {
  return marginalRatePercent(income, brackets);
}
