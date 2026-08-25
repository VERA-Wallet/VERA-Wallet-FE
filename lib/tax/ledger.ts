import { ZERO, add, clampPositive, div, holdingDays, isPositive, max, mul, sub } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { Section104Ledger, StandardLotLedger } from "@/lib/tax/lots";
import type { LotLedger } from "@/lib/tax/lots";
import type { AcquisitionRow, DeemedCostResolver, GainRow, IncomeRow, LedgerPolicy, LedgerResult, TaxEvent } from "@/lib/tax/types";
import { ZERO_BASIS_SUFFIX, limitationOf } from "@/lib/tax/limitations";

/**
 * 원장 내부 lot 키. 사용자 이벤트 id 네임스페이스와 분리한다.
 * origin에는 구분자가 없으므로 (origin, eventId) 쌍마다 유일하다 —
 * 실제 이벤트 id가 `x:in`이어도 다른 교환의 수취분과 섞이지 않는다.
 */
function lotKey(eventId: string, origin: "ACQUIRE" | "INCOME" | "SWAP_IN"): string {
  return `${origin}\u001f${eventId}`;
}

function chronological(events: TaxEvent[]): TaxEvent[] {
  return [...events].sort((left, right) => {
    const delta = Date.parse(left.at) - Date.parse(right.at);
    return delta !== 0 ? delta : left.id.localeCompare(right.id);
  });
}

/** 취득으로 잡히는 모든 이벤트(매수·소득 수령·과세 교환의 수취분)를 사전 스캔한다. */
function acquisitionSchedule(events: TaxEvent[], policy: LedgerPolicy) {
  const schedule: { key: string; asset: string; at: string; quantity: Decimal; cost: Decimal }[] = [];
  for (const event of events) {
    if (event.kind === "ACQUIRE") {
      schedule.push({ key: lotKey(event.id, "ACQUIRE"), asset: event.asset, at: event.at, quantity: event.quantity, cost: policy.feeDeductible ? add(event.cost, event.fee) : event.cost });
    }
    if (event.kind === "INCOME") {
      const zeroBasis = policy.zeroBasisIncomeKinds.includes(event.incomeKind);
      schedule.push({ key: lotKey(event.id, "INCOME"), asset: event.asset, at: event.at, quantity: event.quantity, cost: zeroBasis ? ZERO : event.fmv });
    }
    if (event.kind === "DISPOSE" && event.receives && policy.cryptoToCryptoTaxable) {
      schedule.push({ key: lotKey(event.id, "SWAP_IN"), asset: event.receives.asset, at: event.at, quantity: event.receives.quantity, cost: event.proceeds });
    }
  }
  return schedule;
}

type ScheduleItem = { key: string; asset: string; at: string; quantity: Decimal; cost: Decimal };

/**
 * KR 거주자별 총평균법의 자산별 seed 단가(2-세그먼트).
 *
 * 시행 경계(2027-01-01) 전에 취득해 **계속 보유한** 분은 의제취득가액 Max(2026-12-31 시가, 실제 취득단가)로,
 * 경계 후 취득분은 실제 원가로 합쳐 단일 평균단가를 낸다.
 * 이미 경계 전에 처분된 수량은 opening 원가에서 빠진다 — 의제취득가액은 **보유분에만** 붙는다.
 */
function deemedSegmentUnit(asset: string, fmv: Decimal, boundaryMs: number, schedule: ScheduleItem[], events: TaxEvent[]): Decimal {
  let preAcqQty = ZERO;
  let preAcqCost = ZERO;
  let postQty = ZERO;
  let postCost = ZERO;
  for (const item of schedule) {
    if (item.asset !== asset) continue;
    if (Date.parse(item.at) < boundaryMs) {
      preAcqQty = add(preAcqQty, item.quantity);
      preAcqCost = add(preAcqCost, item.cost);
    } else {
      postQty = add(postQty, item.quantity);
      postCost = add(postCost, item.cost);
    }
  }
  let preDispQty = ZERO;
  for (const event of events) {
    if (event.kind === "DISPOSE" && event.asset === asset && Date.parse(event.at) < boundaryMs) {
      preDispQty = add(preDispQty, event.quantity);
    }
  }
  const preUnit = isPositive(preAcqQty) ? div(preAcqCost, preAcqQty) : ZERO;
  const heldPre = clampPositive(sub(preAcqQty, preDispQty));
  // 의제취득가액은 보유 순수량에만 적용한다(이미 처분된 분 제외).
  const openingCost = mul(heldPre, max(fmv, preUnit));
  const denom = add(heldPre, postQty);
  return isPositive(denom) ? div(add(openingCost, postCost), denom) : ZERO;
}

// deemedCost는 seed 계층이 소비한다. 단, KR처럼 policy.deemedCostBoundary를 선언한 룰셋에서
// **그 자산의 시가가 정의된 경우에만** 2-세그먼트 원가를 만든다. JP 등은 resolver가 있어도
// 기존 총평균 seed를 그대로 써서 타국 회귀가 0이다.
function createLedger(events: TaxEvent[], policy: LedgerPolicy, lookahead: TaxEvent[], deemedCost?: DeemedCostResolver): LotLedger {
  // 영국 재매수 매칭만 기간 밖 취득을 본다.
  // 총평균법(JP)·FIFO 등 다른 원가법의 평균·순서에는 절대 넣지 않는다.
  if (policy.method === "SECTION_104") {
    return new Section104Ledger(acquisitionSchedule([...events, ...lookahead], policy));
  }
  const ledger = new StandardLotLedger(policy);
  if (policy.method === "PERIOD_AVERAGE") {
    // 총평균법: 기간 내 모든 취득을 합산한 단일 평균단가를 처분 전에 확정한다.
    const schedule = acquisitionSchedule(events, policy);
    const totals = new Map<string, { quantity: Decimal; cost: Decimal }>();
    for (const item of schedule) {
      const current = totals.get(item.asset) ?? { quantity: ZERO, cost: ZERO };
      totals.set(item.asset, { quantity: add(current.quantity, item.quantity), cost: add(current.cost, item.cost) });
    }
    const boundary = policy.deemedCostBoundary;
    for (const [asset, total] of totals) {
      const fmv = boundary !== undefined ? deemedCost?.(asset) : undefined;
      if (fmv === undefined || boundary === undefined) {
        // generic 총평균 경로 — 타국(JP)과 시가 미입력 KR이 여기로 온다(byte-for-byte 동일).
        ledger.seedPeriodAverage(asset, isPositive(total.quantity) ? div(total.cost, total.quantity) : ZERO);
        continue;
      }
      // deemed=true: pool.cost가 seed 단가 기준으로 쌓여 전량 처분까지 uplift가 보존된다.
      ledger.seedPeriodAverage(asset, deemedSegmentUnit(asset, fmv, Date.parse(boundary), schedule, events), true);
    }
  }
  return ledger;
}

/**
 * 원장 실행: 이벤트를 시간순으로 소비해 처분별 손익 행과 소득 행을 만든다.
 * 이중과세 방지 불변식 — 소득 이벤트는 인식과 동시에 `cost_basis = fmv_at_receipt`,
 * `acquired_at = received_at`인 새 lot을 만든다.
 */
/**
 * @param lookahead 과세기간이 끝난 뒤 30일 안의 이벤트.
 *   영국 재매수(bed & breakfast) 매칭에만 쓰인다 — 다른 원가법의 평균·순서에는 넣지 않는다.
 *   넣으면 기간 밖 취득이 이번 기간 손익을 조용히 바꾼다.
 */
export function runLedger(events: TaxEvent[], policy: LedgerPolicy, lookahead: TaxEvent[] = [], deemedCost?: DeemedCostResolver): LedgerResult {
  const ordered = chronological(events);
  const ledger = createLedger(ordered, policy, chronological(lookahead), deemedCost);
  const gains: GainRow[] = [];
  const income: IncomeRow[] = [];
  const acquisitions: AcquisitionRow[] = [];
  const deferred: LedgerResult["deferred"] = [];
  const warnings: string[] = [];
  // 문구에서 id를 되뜯으면 `swp:in` 같은 정상 id가 `swp`로 잘린다.
  const warned: { message: string; eventId: string }[] = [];

  for (const event of ordered) {
    if (event.kind === "ACQUIRE") {
      const cost = policy.feeDeductible ? add(event.cost, event.fee) : event.cost;
      ledger.acquire({
        id: event.id,
        key: lotKey(event.id, "ACQUIRE"),
        asset: event.asset,
        wallet: event.wallet,
        at: event.at,
        quantity: event.quantity,
        cost,
      });
      acquisitions.push({
        eventId: event.id,
        sourceEventId: event.id,
        at: event.at,
        asset: event.asset,
        symbol: event.symbol,
        quantity: event.quantity,
        cost,
        origin: "ACQUIRE",
        zeroBasis: false,
      });
      continue;
    }

    if (event.kind === "INCOME") {
      const zeroBasis = policy.zeroBasisIncomeKinds.includes(event.incomeKind);
      if (!zeroBasis) {
        income.push({ eventId: event.id, at: event.at, asset: event.asset, symbol: event.symbol, quantity: event.quantity, amount: event.fmv, incomeKind: event.incomeKind });
      }
      const incomeCost = zeroBasis ? ZERO : event.fmv;
      ledger.acquire({ id: event.id, key: lotKey(event.id, "INCOME"), asset: event.asset, wallet: event.wallet, at: event.at, quantity: event.quantity, cost: incomeCost });
      acquisitions.push({
        eventId: event.id,
        sourceEventId: event.id,
        at: event.at,
        asset: event.asset,
        symbol: event.symbol,
        quantity: event.quantity,
        cost: incomeCost,
        origin: "INCOME",
        zeroBasis,
        incomeKind: event.incomeKind,
      });
      continue;
    }

    const consumption = ledger.dispose({ asset: event.asset, wallet: event.wallet, at: event.at, quantity: event.quantity });
    if (isPositive(consumption.shortfall)) {
      // 사용자가 처분 원가(취득가액 직접 입력·50% 의제)를 정했으면 "취득가 0원"이 아니다 — 경고를 달지 않는다.
      if (event.cost === undefined) {
        const message = `${event.id}: 원장에 없는 수량 ${consumption.shortfall} ${event.symbol} —${ZERO_BASIS_SUFFIX}`;
        warnings.push(message);
        warned.push({ message, eventId: event.id });
      }
      consumption.matches.push({ lotId: `${event.id}:missing`, quantity: consumption.shortfall, cost: ZERO, acquiredAt: null });
    }

    const nonTaxableSwap = event.trigger === "CRYPTO" && !policy.cryptoToCryptoTaxable && event.receives;
    if (nonTaxableSwap && event.receives) {
      // 비과세 교환: 소비된 lot의 취득가액을 그대로 수취 자산으로 승계한다(과세 이연).
      // 콜백 안에서 좁힘이 풀리므로 지역 변수로 고정한다.
      const receives = event.receives;
      let allocatedReceived = ZERO;
      consumption.matches.forEach((match, index) => {
        const isLast = index === consumption.matches.length - 1;
        const share = isPositive(event.quantity) ? div(match.quantity, event.quantity) : ZERO;
        const quantity = isLast ? sub(receives.quantity, allocatedReceived) : mul(receives.quantity, share);
        allocatedReceived = add(allocatedReceived, quantity);
        ledger.acquire({
          id: `${event.id}:in:${match.lotId}`,
          key: `DEFERRED_IN\u001f${event.id}\u001f${match.lotId}`,
          asset: receives.asset,
          wallet: event.wallet,
          at: policy.carryHoldingPeriod ? match.acquiredAt ?? event.at : event.at,
          quantity,
          cost: match.cost,
        });
        deferred.push({ eventId: event.id, at: event.at, asset: receives.asset, symbol: receives.symbol, quantity, carriedCost: match.cost });
      });
      continue;
    }

    // 양도가액·수수료를 lot마다 독립적으로 곱하면 18자리 절사가 누적돼 합계가 원래 값에 못 미친다.
    // (예: 1300을 1:2로 나누면 999.999999999999999999가 되어 면세한계 비교가 뒤집힌다)
    // 마지막 lot이 잔차를 흡수해 합계를 보존한다.
    const totalFee = policy.feeDeductible ? event.fee : ZERO;
    // 사용자가 정한 처분 원가(취득가액 직접 입력·50% 의제). 지정 시 lot 매칭 원가 대신 이 값을 lot마다 안분한다.
    const overrideCost = event.cost;
    let allocatedProceeds = ZERO;
    let allocatedFee = ZERO;
    let allocatedCost = ZERO;
    consumption.matches.forEach((match, index) => {
      const isLast = index === consumption.matches.length - 1;
      const share = isPositive(event.quantity) ? div(match.quantity, event.quantity) : ZERO;
      const proceeds = isLast ? sub(event.proceeds, allocatedProceeds) : mul(event.proceeds, share);
      const fee = isLast ? sub(totalFee, allocatedFee) : mul(totalFee, share);
      const cost =
        overrideCost === undefined
          ? match.cost
          : isLast
            ? sub(overrideCost, allocatedCost)
            : mul(overrideCost, share);
      allocatedProceeds = add(allocatedProceeds, proceeds);
      allocatedFee = add(allocatedFee, fee);
      allocatedCost = add(allocatedCost, cost);
      gains.push({
        eventId: event.id,
        at: event.at,
        asset: event.asset,
        symbol: event.symbol,
        quantity: match.quantity,
        proceeds,
        cost,
        fee,
        gain: sub(sub(proceeds, cost), fee),
        holdingDays: match.acquiredAt ? holdingDays(match.acquiredAt, event.at) : null,
        acquiredAt: match.acquiredAt,
        trigger: event.trigger,
      });
    });

    if (event.receives && policy.cryptoToCryptoTaxable) {
      ledger.acquire({
        id: `${event.id}:in`,
        key: lotKey(event.id, "SWAP_IN"),
        asset: event.receives.asset,
        wallet: event.wallet,
        at: event.at,
        quantity: event.receives.quantity,
        cost: event.proceeds,
      });
      acquisitions.push({
        eventId: `${event.id}:in`,
        sourceEventId: event.id,
        at: event.at,
        asset: event.receives.asset,
        symbol: event.receives.symbol,
        quantity: event.receives.quantity,
        cost: event.proceeds,
        origin: "SWAP_IN",
        zeroBasis: false,
      });
    }
  }

  return { gains, income, acquisitions, deferred, warnings, limitations: warned.map((row) => limitationOf(row.message, [row.eventId])) };
}
