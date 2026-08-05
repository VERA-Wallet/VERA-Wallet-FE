import { ZERO, abs, add, clampPositive, div, gt, isNegative, lt, mul, percentOf, sub, sum } from "@/lib/tax/decimal";
import { DENIED_ACB_SUFFIX, PENDING_ACB_SUFFIX, limitationOf } from "@/lib/tax/limitations";
import { finalizeEstimate } from "@/lib/tax/estimate";
import type { GainRow, JudgmentVerdict, RuleContext, RuleSetDefinition, TaxEvent } from "@/lib/tax/types";
import type { Decimal } from "@/lib/tax/decimal";
import { runLedger } from "@/lib/tax/ledger";

/** 자본이득 포함률 50% (66.67% 인상안은 2025.3 철회). */
const INCLUSION_RATE = "0.5";
/**
 * superficial loss 판정 창은 처분일 **전후** 각 30일이다(ITA 54).
 * 뒤쪽만 보면 손실 직전에 사둔 물량이 부인되지 않아 인식 손실이 과대해진다.
 */
const SUPERFICIAL_WINDOW_MS = 30 * 86_400_000;

/**
 * superficial loss를 **lot 단위·수량 비례**로 본다.
 *
 * 행 전체 boolean으로 판정하면 손실 10개에 대체 1개만 사도 전액이 부인된다 — 틀린 답이다.
 * ITA 54는 대체 수량만큼만 부인하므로, 창 종료 시점에 살아남은 대체 수량과
 * 손실 수량의 비율로 부인 금액을 계산한다.
 *
 * 대체분에는 과세 교환(SWAP_IN)의 수취 자산도 포함된다 — 원장이 그 수취를
 * 실제 취득 lot으로 넣는데(ledger.ts) 여기서만 빼면 교환 재취득이 판정을 빠져나간다.
 */
type Lot = { id: string; asset: string; at: number; quantity: Decimal; remaining: Decimal };

type AcqRecord = { id: string; asset: string; at: number; quantity: Decimal };

/** 특정 시점에 각 취득분이 얼마나 남아 있는지(FIFO 소진 재생). */
function remainingAt(events: TaxEvent[], atMs: number): Lot[] {
  const ordered = [...events].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
  );
  const lots: Lot[] = [];
  const push = (record: AcqRecord) =>
    lots.push({ id: record.id, asset: record.asset, at: record.at, quantity: record.quantity, remaining: record.quantity });
  for (const event of ordered) {
    const at = Date.parse(event.at);
    if (at > atMs) break;
    if (event.kind !== "DISPOSE") {
      push({ id: event.id, asset: event.asset, at, quantity: event.quantity });
      continue;
    }
    let remaining = event.quantity;
    for (const lot of lots) {
      if (lot.asset !== event.asset || !gt(lot.remaining, ZERO)) continue;
      if (!gt(remaining, ZERO)) break;
      const taken = gt(lot.remaining, remaining) ? remaining : lot.remaining;
      lot.remaining = sub(lot.remaining, taken);
      remaining = sub(remaining, taken);
    }
    // 과세 교환의 수취분은 처분과 동시에 생기는 새 취득이다.
    if (event.receives && canada.ledger.cryptoToCryptoTaxable) {
      push({ id: `${event.id}:in`, asset: event.receives.asset, at, quantity: event.receives.quantity });
    }
  }
  return lots;
}

/** 이 손실 행의 창 종료 시점 생존 대체 lot들. */
function survivingReplacements(row: GainRow, events: TaxEvent[]): Lot[] {
  const disposedAt = Date.parse(row.at);
  const windowStart = disposedAt - SUPERFICIAL_WINDOW_MS;
  const windowEnd = disposedAt + SUPERFICIAL_WINDOW_MS;
  return remainingAt(events, windowEnd).filter(
    (lot) =>
      lot.asset === row.asset &&
      lot.at >= windowStart &&
      lot.at <= windowEnd &&
      lot.id !== row.eventId &&
      lot.id !== `${row.eventId}:in` &&
      gt(lot.remaining, ZERO),
  );
}

/**
 * 이 손실에서 부인되는 **금액**(0 ~ |손실|).
 * 대체 수량이 손실 수량보다 적으면 그 비율만큼만 부인한다.
 */
function deniedPortion(row: GainRow, events: TaxEvent[]): Decimal {
  if (!isNegative(row.gain)) return ZERO;
  if (!gt(row.quantity, ZERO)) return ZERO;
  const survivorQty = sum(survivingReplacements(row, events).map((lot) => lot.remaining));
  if (!gt(survivorQty, ZERO)) return ZERO;
  const deniedQty = gt(survivorQty, row.quantity) ? row.quantity : survivorQty;
  return mul(abs(row.gain), div(deniedQty, row.quantity));
}


/**
 * 이전 기간에 부인된 손실 중, **이번 기간에 대체분을 팔아 실현되는** 몫.
 *
 * 부인된 손실은 사라지지 않고 대체 취득분의 원가에 더해진다(ITA 53(1)(f)).
 * 어느 취득분에 얹혔는지를 lot으로 추적해야, 부분 처분에서 비례 배분되고
 * 그 lot을 다 판 뒤에는 두 번 빼지 않는다.
 */
function priorDeniedLosses(
  events: TaxEvent[],
  period: { from: string; to: string },
): { released: Decimal; pending: Decimal } {
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const past = events.filter((event) => Date.parse(event.at) < fromMs);
  if (past.length === 0) return { released: ZERO, pending: ZERO };

  const deniedRows = runLedger(past, canada.ledger)
    .gains.map((row) => ({ row, portion: deniedPortion(row, events) }))
    .filter((item) => gt(item.portion, ZERO));
  if (deniedRows.length === 0) return { released: ZERO, pending: ZERO };

  // 부인 금액을 그 손실의 생존 대체 lot들에 수량 비율로 나눠 얹는다.
  const deferredByLot = new Map<string, Decimal>();
  for (const { row, portion } of deniedRows) {
    const survivors = survivingReplacements(row, events);
    const totalQuantity = sum(survivors.map((lot) => lot.remaining));
    if (!gt(totalQuantity, ZERO)) continue;
    for (const lot of survivors) {
      const share = mul(portion, div(lot.remaining, totalQuantity));
      deferredByLot.set(lot.id, add(deferredByLot.get(lot.id) ?? ZERO, share));
    }
  }
  if (deferredByLot.size === 0) return { released: ZERO, pending: ZERO };

  // 캐나다 원장은 자산별 이동평균(ACB)이다 — 자산 풀로 다루고 처분 수량 비율만큼 실현한다.
  const ordered = [...events].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
  );
  const pools = new Map<string, { quantity: Decimal; deferred: Decimal }>();
  const addLot = (record: AcqRecord) => {
    const pool = pools.get(record.asset) ?? { quantity: ZERO, deferred: ZERO };
    pool.quantity = add(pool.quantity, record.quantity);
    pool.deferred = add(pool.deferred, deferredByLot.get(record.id) ?? ZERO);
    pools.set(record.asset, pool);
  };
  let released = ZERO;
  for (const event of ordered) {
    const at = Date.parse(event.at);
    if (event.kind !== "DISPOSE") {
      addLot({ id: event.id, asset: event.asset, at, quantity: event.quantity });
      continue;
    }
    const pool = pools.get(event.asset);
    if (pool && gt(pool.quantity, ZERO)) {
      const taken = gt(pool.quantity, event.quantity) ? event.quantity : pool.quantity;
      const share = gt(pool.deferred, ZERO) ? mul(pool.deferred, div(taken, pool.quantity)) : ZERO;
      if (at >= fromMs && at < toMs) released = add(released, share);
      pool.quantity = sub(pool.quantity, taken);
      pool.deferred = sub(pool.deferred, share);
      pools.set(event.asset, pool);
    }
    if (event.receives && canada.ledger.cryptoToCryptoTaxable) {
      addLot({ id: `${event.id}:in`, asset: event.receives.asset, at, quantity: event.receives.quantity });
    }
  }
  const pending = sum([...pools.values()].map((pool) => pool.deferred));
  return { released, pending };
}

export const canada: RuleSetDefinition = {
  code: "CA",
  label: "캐나다",
  currency: "CAD",
  cost_basis: "ACB",
  badge_label: "CA ACB 이동평균",
  demoPriority: null,
  status: "CONFIRMED",
  profileFields: ["marginalRatePercent", "isBusiness", "carriedLosses"],
  // 사업자로 선언하면 자본이득이 아니라 사업소득 100%다 — 포함률이 없다.
  aggregateAdjustment: ({ profile }) => (profile.isBusiness ? "offset" : "inclusion"),
  ledger: {
    // ITA는 ACB(이동평균)를 강제한다 — FIFO/LIFO 불가.
    method: "MOVING_AVERAGE",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "CONFIRMED", basis: "Income Tax Act + CRA 가이드", note: "포함률 50%" },
    { topic: "STAKING", status: "CONFIRMED", basis: "CRA 유권해석 2024-1031821I7 (2025.1)" },
    { topic: "LOSS_OFFSET", status: "CONFIRMED", basis: "ITA", note: "자본이득과만 상계, 3년 소급 / 무기한 이월" },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, context: RuleContext): JudgmentVerdict {
    const portion = deniedPortion(row, [...context.events, ...context.lookaheadEvents]);
    if (gt(portion, ZERO)) {
      // 대체 수량이 손실 수량보다 적으면 일부만 부인된다 — 전액 부인처럼 말하면 거짓이다.
      const full = !lt(portion, abs(row.gain));
      return {
        group: "denied",
        label: full ? "손실 부인 · 상계 불가" : "손실 일부 부인 · 대체 수량 비례",
        basis: "ITA 54 superficial loss (처분 전후 각 30일 내 취득)",
      };
    }

    if (isNegative(row.gain)) {
      return { group: "carry", label: "손실 · 상계 대상", basis: "ITA" };
    }

    return {
      group: "taxable",
      label: context.profile.isBusiness ? "과세 · 사업소득 100%" : "과세 · 포함률 50%",
      basis: "ITA (ACB 이동평균)",
    };
  },
  judgeIncome(): JudgmentVerdict {
    return { group: "income", label: "소득 · 과세", basis: "CRA 가이드" };
  },

  compute({ events, lookaheadEvents, ledger, profile, taxYear, excludedEventIds, period }) {
    // 기간이 끝난 직후 30일 안의 재취득도 부인 요건이다.
    const windowEvents = [...events, ...lookaheadEvents];
    // 부인은 행 전체가 아니라 대체 수량 비례다.
    const portions = ledger.gains.map((row) => ({ row, portion: deniedPortion(row, windowEvents) }));
    const denied = portions.filter((item) => gt(item.portion, ZERO)).map((item) => item.row);
    const deniedLosses = sum(portions.map((item) => item.portion));
    // 부인된 손실은 대체 취득분의 ACB에 더해진다(ITA 53(1)(f)).
    // **이전 과세기간**에 부인된 손실도 지금 자산 원가에 살아 있으므로,
    // 이번 기간 이익에서 빼주지 않으면 그만큼 이익을 과대 계산한다.
    const prior = priorDeniedLosses(events, period);
    const priorDenied = prior.released;
    // 인정 손익 = 원래 손익 + 부인된 몫(손실은 음수이므로 부인분을 되돌린다).
    const recognized = sum(portions.map((item) => add(item.row.gain, item.portion)));
    const net = sub(sub(recognized, priorDenied), profile.carriedLosses);
    const taxableCapitalGain = mul(clampPositive(net), INCLUSION_RATE);

    const incomeTotal = sum(ledger.income.map((row) => row.amount));
    // 사업자로 선언하면 자본이득 취급이 아니라 사업소득으로 100% 포함된다.
    const businessIncome = profile.isBusiness ? add(clampPositive(net), incomeTotal) : ZERO;
    const base = profile.isBusiness ? businessIncome : add(taxableCapitalGain, incomeTotal);
    const charge = percentOf(base, profile.marginalRatePercent);

    return finalizeEstimate({
      country: "CA",
      countryLabel: "캐나다",
      currency: "CAD",
      taxYear,
      method: "ACB 이동평균 (FIFO/LIFO 불가)",
      status: "CONFIRMED",
      taxableGains: profile.isBusiness ? clampPositive(net) : taxableCapitalGain,
      exemptGains: profile.isBusiness ? ZERO : sub(clampPositive(net), taxableCapitalGain),
      incomeTotal,
      taxableBase: base,
      estimatedCharge: charge,
      lossCarryforward: isNegative(net) ? abs(net) : ZERO,
      lines: [
        ...(gt(priorDenied, ZERO)
          ? [{ key: "prior_denied_acb", label: "이전 기간 부인 손실의 원가 가산", amount: priorDenied, basis: "ITA 53(1)(f)" }]
          : []),
        { key: "net_gains", label: "순 자본이득 (ACB 기준)", amount: net },
        { key: "denied_losses", label: "superficial loss로 부인된 손실", amount: deniedLosses, basis: "ITA 54 (처분 전후 각 30일)" },
        { key: "inclusion", label: "과세소득 포함분 (50%)", amount: taxableCapitalGain, rate: "포함률 50%" },
        { key: "income", label: "스테이킹 보상", amount: incomeTotal, rate: profile.isBusiness ? "사업소득 100%" : "일반소득" },
        { key: "charge", label: "예상 부담 (연방+주 한계세율)", amount: charge, rate: `${profile.marginalRatePercent}%` },
      ],
      notes: [
        "취득원가는 ACB(이동평균)만 허용되며 FIFO/LIFO는 사용할 수 없습니다.",
        "처분 전후 각 30일 내 동일 자산을 취득한 손실은 superficial loss로 부인해 상계하지 않습니다.",
        profile.isBusiness ? "사업자 선언에 따라 100% 포함으로 계산했습니다." : "투자자 선언 기준으로 포함률 50%를 적용했습니다.",
        ...ledger.warnings,
      ],
      limitations: [
        ...ledger.limitations,
        // 부인된 손실은 대체 취득분의 ACB에 더해져야 하는데 원장이 그 상태를 들지 않는다.
        // 조용히 근사하지 말고 한계로 내보내 화면이 그 사실을 말하게 한다.
        ...(gt(prior.pending, ZERO)
          ? [
              limitationOf(
                `이전 기간 부인 손실 ${prior.pending}가 아직 보유 중인 대체 취득분 원가에 남아 있습니다 —${PENDING_ACB_SUFFIX}`,
                [],
              ),
            ]
          : []),
        ...(gt(deniedLosses, ZERO)
          ? [
              limitationOf(
                `superficial loss로 부인된 ${deniedLosses}는${DENIED_ACB_SUFFIX}`,
                denied.map((row) => row.eventId),
              ),
            ]
          : []),
      ],
      openQuestions: [
        { topic: "CAPITAL_GAINS", status: "PARTIAL", reason: "사업 vs 투자 분류는 사실관계 판단이라 지갑 데이터만으로 자동 판정할 수 없습니다.", affectedEventIds: [] },
        { topic: "DEFI_LP", status: "UNDETERMINED", reason: "디파이 LP·랩핑에 대한 명문 규정이 없습니다.", affectedEventIds: [] },
      ],
      requiredInputs: ["연방+주 합산 한계세율", "사업자/투자자 분류 선언"],
      excludedEventIds,
    });
  },
};
