import { ZERO, add, clampPositive, div, gt, isNegative, isPositive, lt, mul, percentOf, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleSetDefinition, TaxEvent } from "@/lib/tax/types";

/** PFU(단일세율) — 소득세 12.8% + 사회기여금 17.2%. 2026.1.1부터 31.4%. */
const PFU_2025 = "30";
const PFU_2026 = "31.4";
/** 연간 총 양도가액 면세 기준. */
const ANNUAL_PROCEEDS_FLOOR = "305";
type FrenchDisposal = {
  eventId: string;
  at: string;
  gain: Decimal;
  proceeds: Decimal;
};

const disposalCache = new WeakMap<TaxEvent[], Map<string, FrenchDisposal[]>>();
const disposalIndexCache = new WeakMap<TaxEvent[], Map<string, Map<string, FrenchDisposal>>>();

function frenchDisposals(events: TaxEvent[], period: { from: string; to: string }): FrenchDisposal[] {
  const periodKey = `${period.from}:${period.to}`;
  const cachedByPeriod = disposalCache.get(events);
  const cached = cachedByPeriod?.get(periodKey);
  if (cached) return cached;

  const ordered = [...events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
  const quantities = new Map<string, Decimal>();
  const unitPrices = new Map<string, Decimal>();
  let portfolioCost = ZERO;
  const disposals: FrenchDisposal[] = [];
  const periodStartMs = Date.parse(period.from);
  const periodEndMs = Date.parse(period.to);
  // 프랑스는 원장 대신 자체 포트폴리오 공식을 쓴다 — 상한을 직접 걸지 않으면
  // 기간 밖 처분이 이 계산에 새어 들어온다(엔진의 `within`이 이 경로를 덮지 않는다).
  const inPeriod = (at: string) => Date.parse(at) >= periodStartMs && Date.parse(at) < periodEndMs;
  const bump = (asset: string, delta: Decimal) => quantities.set(asset, add(quantities.get(asset) ?? ZERO, delta));
  const portfolioValue = () =>
    sum([...quantities.entries()].map(([asset, quantity]) => mul(quantity, unitPrices.get(asset) ?? ZERO)));

  for (const event of ordered) {
    if (event.kind === "ACQUIRE") {
      bump(event.asset, event.quantity);
      portfolioCost = add(portfolioCost, add(event.cost, event.fee));
      if (isPositive(event.quantity)) unitPrices.set(event.asset, div(event.cost, event.quantity));
      continue;
    }
    if (event.kind === "INCOME") {
      bump(event.asset, event.quantity);
      portfolioCost = add(portfolioCost, event.fmv);
      if (isPositive(event.quantity)) unitPrices.set(event.asset, div(event.fmv, event.quantity));
      continue;
    }
    if (isPositive(event.quantity)) unitPrices.set(event.asset, div(event.proceeds, event.quantity));
    if (event.trigger === "CRYPTO" && event.receives) {
      // 크립토→크립토는 과세 이연: 포트폴리오 총취득원가는 변하지 않는다.
      bump(event.asset, sub(ZERO, event.quantity));
      bump(event.receives.asset, event.receives.quantity);
      if (isPositive(event.receives.quantity)) unitPrices.set(event.receives.asset, div(event.proceeds, event.receives.quantity));
      continue;
    }
    const value = portfolioValue();
    // 공식: gain = 양도가액 - 포트폴리오_총취득원가 * 양도가액 / 포트폴리오_총가치
    const fraction = gt(value, ZERO) ? div(event.proceeds, value) : ZERO;
    const deductible = mul(portfolioCost, fraction);
    // 과세기간 이전의 처분도 포트폴리오 총취득원가를 소진시키므로 원장은 계속 굴리고 인식만 기간으로 좁힌다.
    if (inPeriod(event.at)) {
      disposals.push({
        eventId: event.id,
        at: event.at,
        gain: sub(sub(event.proceeds, deductible), event.fee),
        proceeds: event.proceeds,
      });
    }
    portfolioCost = clampPositive(sub(portfolioCost, deductible));
    bump(event.asset, sub(ZERO, event.quantity));
  }

  const byPeriod = cachedByPeriod ?? new Map<string, FrenchDisposal[]>();
  byPeriod.set(periodKey, disposals);
  if (!cachedByPeriod) disposalCache.set(events, byPeriod);
  const indexByPeriod = disposalIndexCache.get(events) ?? new Map<string, Map<string, FrenchDisposal>>();
  indexByPeriod.set(periodKey, new Map(disposals.map((disposal) => [disposal.eventId, disposal])));
  if (!disposalIndexCache.has(events)) disposalIndexCache.set(events, indexByPeriod);
  return disposals;
}
function frenchDisposal(events: TaxEvent[], period: { from: string; to: string }, eventId: string): FrenchDisposal | undefined {
  frenchDisposals(events, period);
  return disposalIndexCache.get(events)?.get(`${period.from}:${period.to}`)?.get(eventId);
}


function annualProceedsBelowFloor(events: TaxEvent[], period: { from: string; to: string }): boolean {
  return lt(sum(frenchDisposals(events, period).map((disposal) => disposal.proceeds)), ANNUAL_PROCEEDS_FLOOR);
}

export const france: RuleSetDefinition = {
  code: "FR",
  label: "프랑스",
  currency: "EUR",
  cost_basis: "portfolio_weighted_average",
  badge_label: "FR PFU 30%",
  demoPriority: null,
  status: "CONFIRMED",
  profileFields: ["marginalRatePercent"],
  aggregateAdjustment: "floor",
  ledger: {
    // 프랑스는 lot 매칭이 아니라 포트폴리오 가중평균 공식을 쓰므로 원장은 참고용으로만 돌린다.
    method: "MOVING_AVERAGE",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: false,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "CGI Art. 150 VH bis (2019 Finance Act)" },
    { topic: "CRYPTO_TO_CRYPTO", status: "CONFIRMED", basis: "CGI", note: "피아트 전환·재화구매 시에만 과세" },
    { topic: "STAKING", status: "PARTIAL", basis: "BNC 체계", note: "수령 시점·평가 규정이 상대적으로 모호" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, context): JudgmentVerdict {
    const disposal = frenchDisposal(context.events, context.period, row.eventId);
    if (!disposal) {
      return { group: "deferred", label: "과세 이연 · 처분 아님", basis: "CGI (피아트 전환 시에만 과세)" };
    }
    // 프랑스는 건별 lot 손익이 아니라 포트폴리오 전체 안분으로 계산한다.
    // 원장 행 금액을 그대로 두면 도장과 금액의 부호가 반대일 수 있으므로 공식 금액으로 덮어쓴다.
    const amount = disposal.gain;
    if (isNegative(amount)) {
      return { group: "carry", label: "손실 · 상계 대상", basis: "CGI Art. 150 VH bis", amount };
    }
    if (annualProceedsBelowFloor(context.events, context.period)) {
      return { group: "exempt", label: "비과세 · 연간 양도가액 한계 미만", basis: "CGI Art. 150 VH bis", amount };
    }
    return { group: "taxable", label: "과세 · 포트폴리오 안분", basis: "CGI Art. 150 VH bis", amount };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "BNC 체계" };
  },

  compute({ events, ledger, profile, taxYear, period, excludedEventIds }) {
    const ordered = [...events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
    const disposals = frenchDisposals(events, period);
    const proceedsTotal = sum(disposals.map((disposal) => disposal.proceeds));
    let bncIncome = ZERO;
    const periodStartMs = Date.parse(period.from);
    const periodEndMs = Date.parse(period.to);

    for (const event of ordered) {
      if (event.kind === "INCOME" && Date.parse(event.at) >= periodStartMs && Date.parse(event.at) < periodEndMs) {
        bncIncome = add(bncIncome, event.fmv);
      }
    }

    const rate = taxYear >= 2026 ? PFU_2026 : PFU_2025;
    const netGains = sum(disposals.map((disposal) => disposal.gain));
    const belowFloor = annualProceedsBelowFloor(events, period);
    const taxableGains = belowFloor ? ZERO : clampPositive(netGains);
    const gainsCharge = percentOf(taxableGains, rate);
    // 스테이킹·마이닝은 BNC(종합과세) — 한계세율 입력이 필요하다.
    const incomeCharge = percentOf(bncIncome, profile.marginalRatePercent);

    return finalizeEstimate({
      country: "FR",
      countryLabel: "프랑스",
      currency: "EUR",
      taxYear,
      method: "포트폴리오 가중평균 (양도가액 비례 배분)",
      status: "CONFIRMED",
      taxableGains,
      exemptGains: belowFloor ? clampPositive(netGains) : ZERO,
      incomeTotal: bncIncome,
      taxableBase: add(taxableGains, bncIncome),
      estimatedCharge: add(gainsCharge, incomeCharge),
      lines: [
        { key: "proceeds", label: "연간 총 양도가액 (피아트·재화구매)", amount: proceedsTotal, basis: `면세 기준 €${ANNUAL_PROCEEDS_FLOOR}` },
        { key: "net_gains", label: "가중평균 공식 적용 양도차익", amount: netGains, basis: "CGI Art. 150 VH bis" },
        { key: "deferred_swaps", label: "비과세 교환으로 이연된 건수", amount: String(ledger.deferred.length) , unit: "count" as const },
        { key: "gains_charge", label: "양도분 예상 부담 (PFU)", amount: gainsCharge, rate: `${rate}%` },
        { key: "bnc_income", label: "스테이킹·마이닝 (BNC)", amount: bncIncome, rate: `${profile.marginalRatePercent}% 누진` },
        { key: "income_charge", label: "BNC 예상 부담", amount: incomeCharge },
      ],
      notes: [
        "과세 트리거는 피아트 전환·재화구매뿐이며 크립토→크립토는 과세가 이연됩니다.",
        `${taxYear >= 2026 ? "2026.1.1 시행 PLFSS 2026에 따라 31.4%를 적용했습니다." : "2025년 실현분은 PFU 30%입니다(2026년부터 31.4%)."}`,
        "취득원가는 포트폴리오 전체 가중평균이며, 처분 시점 포트폴리오 총가치 스냅샷이 필요합니다.",
        "포트폴리오 총가치는 각 자산의 최근 관측 단가로 근사했습니다(mock 가정).",
        ...ledger.warnings,
      ],
      limitations: ledger.limitations,
      openQuestions: [
        { topic: "STAKING", status: "PARTIAL", reason: "BNC 체계이나 수령 시점·평가 규정이 모호합니다(micro-BNC 34% 정액공제 선택 가능).", affectedEventIds: ledger.income.map((row) => row.eventId) },
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["종합소득 한계세율 (BNC 적용)", "누진세율 선택 여부 (box 2OP)"],
      excludedEventIds,
    });
  },
};
