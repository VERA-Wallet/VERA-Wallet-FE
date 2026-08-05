import { round, sub } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { buildJudgments } from "@/lib/tax/judgment";
import { runLedger } from "@/lib/tax/ledger";
import { getRuleSet } from "@/lib/tax/rulesets";
import type { CountryCode, LedgerResult, TaxEstimate, TaxEvent, TaxpayerProfile } from "@/lib/tax/types";

/** 지갑 데이터만으로 알 수 없는 입력의 기본값. 화면에서 사용자가 조정한다. */
export const DEFAULT_PROFILE: TaxpayerProfile = {
  marginalRatePercent: "35",
  otherIncome: "0",
  filingStatus: "SINGLE",
  isBusiness: false,
  defiOwnershipTransferred: false,
  carriedLosses: "0",
};

export type EstimateInput = {
  country: string;
  events: TaxEvent[];
  taxYear: number;
  profile?: Partial<TaxpayerProfile>;
  /** 가격 미확인 등으로 상위 파이프라인이 제외한 이벤트. 결과에 그대로 실어 보낸다. */
  excludedEventIds?: string[];
};

export class UnknownRuleSetError extends Error {
  constructor(code: string) {
    super(`Unknown ruleset: ${code}`);
    this.name = "UnknownRuleSetError";
  }
}

/** 한계 기여도 재계산 상한. 초과 요청은 계산하지 않고 거절한다. */
/**
 * 과세기간이 끝난 뒤에도 계산에 필요한 날 수.
 * 영국 30일 재매수 규칙과 캐나다 superficial loss 창이 기간 경계를 넘는다.
 */
const LOOKAHEAD_DAYS = 30;

export const MARGINAL_EVENT_LIMIT = 400;

export class MarginalBudgetError extends Error {
  constructor(
    readonly eventCount: number,
    readonly limit: number,
  ) {
    super(`Marginal contribution budget exceeded: ${eventCount} events (limit ${limit})`);
    this.name = "MarginalBudgetError";
  }
}

export function taxPeriodFor(country: CountryCode | string, taxYear: number): { from: string; to: string } {
  const ruleset = getRuleSet(String(country));
  return (
    ruleset?.taxPeriod?.(taxYear) ?? {
      from: `${taxYear}-01-01T00:00:00.000Z`,
      to: `${taxYear + 1}-01-01T00:00:00.000Z`,
    }
  );
}

/**
 * 주어진 시각이 속한 과세연도. 영국(4/6~)·호주(7/1~)는 역년이 아니므로
 * 달력 연도를 그대로 쓰면 화면이 다른 기간의 결과를 보여준다.
 */
export function taxYearFor(country: CountryCode | string, at: string | Date): number {
  const ms = at instanceof Date ? at.getTime() : Date.parse(at);
  const calendarYear = new Date(ms).getUTCFullYear();
  // 경계 근처만 확인하면 충분하다: 과세기간은 1년이므로 후보는 전년/당년뿐이다.
  for (const candidate of [calendarYear, calendarYear - 1]) {
    const period = taxPeriodFor(country, candidate);
    if (ms >= Date.parse(period.from) && ms < Date.parse(period.to)) return candidate;
  }
  return calendarYear;
}

/**
 * 룰셋 실행 진입점.
 * 원장은 기간 종료 전 전체 이력으로 돌려 취득원가를 추적하고,
 * 손익·소득 인식은 해당 과세기간에 발생한 행으로만 좁힌다.
 */
export function computeTaxEstimate(input: EstimateInput): TaxEstimate {
  const ruleset = getRuleSet(input.country);
  if (!ruleset) throw new UnknownRuleSetError(input.country);

  const period = taxPeriodFor(ruleset.code, input.taxYear);
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  // 계산 입력은 기간까지다. 기간 밖 이벤트를 원장에 섞으면
  // 일본 기간평균 원가·프랑스 자체 집계가 조용히 달라진다.
  const inScope = input.events.filter((event) => Date.parse(event.at) < toMs);
  // 기간 경계를 넘는 사실이 필요한 규칙(GB 재매수·CA superficial loss)에만 따로 준다.
  const lookaheadMs = LOOKAHEAD_DAYS * 86_400_000;
  const lookaheadEvents = input.events.filter((event) => {
    const at = Date.parse(event.at);
    return at >= toMs && at < toMs + lookaheadMs;
  });
  const full = runLedger(inScope, ruleset.ledger, lookaheadEvents);
  // 계산 입력은 넓혔지만 **인식 대상**은 여전히 이 기간뿐이다.
  const within = <T extends { at: string }>(rows: T[]) =>
    rows.filter((row) => Date.parse(row.at) >= fromMs && Date.parse(row.at) < toMs);
  const ledger: LedgerResult = {
    gains: within(full.gains),
    income: within(full.income),
    // 취득은 손익 인식이 아니라 원가 기록이다. 과세기간 밖의 매수도 이번 기간 손익을 만들므로
    // (한계 기여도에서 음수로 드러난다) 기간으로 자르지 않는다.
    acquisitions: full.acquisitions,
    deferred: within(full.deferred),
    warnings: full.warnings,
    limitations: full.limitations,
  };

  const context = {
    events: inScope,
    lookaheadEvents,
    ledger,
    profile: { ...DEFAULT_PROFILE, ...input.profile },
    taxYear: input.taxYear,
    period,
    excludedEventIds: input.excludedEventIds ?? [],
  };

  const estimate = ruleset.compute(context);
  // 판정은 compute 결과에서 파생한다 — 조건을 재작성하면 화면과 계산이 갈린다.
  return { ...estimate, period, judgments: buildJudgments(ruleset, context, estimate) };
}

/** 여러 국가를 한 번에 계산해 비교 화면에 그대로 넘긴다. */
export function compareRuleSets(countries: string[], input: Omit<EstimateInput, "country">): TaxEstimate[] {
  return countries.map((country) => computeTaxEstimate({ ...input, country }));
}

/**
 * 이벤트별 한계 기여도 — "이 거래를 빼면 총 부담이 얼마나 줄어드는가".
 *
 * 부담액은 건별로 배분할 수 없다: 면세한계가 계단 함수이고, 손실 상계·누진구간이 기간 집계에 걸리며,
 * 취득원가는 경로 의존적이다. 배분 대신 델타를 낸다 — 이 값은 항상 정의되고 재현 가능하다.
 * 매수의 델타는 음수가 될 수 있다. 취득원가가 사라지면 손익이 커져 부담이 늘기 때문이다.
 *
 * 비용은 이벤트 수만큼의 재계산이므로 응답에 기본 포함하지 않고, 이벤트 상한을 둔다.
 */
export function computeMarginalContributions(input: EstimateInput): Record<string, Decimal> {
  // O(n^2) 경로라 상한 없이 열어두면 estimate 엔드포인트가 CPU에 묶인다.
  // 중복 id로 상한을 우회하지 못하도록 원시 이벤트 수와 고유 id 수를 함께 본다.
  const ids = [...new Set(input.events.map((event) => event.id))];
  const cost = Math.max(ids.length, input.events.length);
  if (cost > MARGINAL_EVENT_LIMIT) throw new MarginalBudgetError(cost, MARGINAL_EVENT_LIMIT);
  const base = computeTaxEstimate(input).totals.estimatedCharge;
  const contributions: Record<string, Decimal> = {};

  for (const id of ids) {
    const without = computeTaxEstimate({
      ...input,
      events: input.events.filter((event) => event.id !== id),
    }).totals.estimatedCharge;
    contributions[id] = round(sub(base, without), 2);
  }

  return contributions;
}
