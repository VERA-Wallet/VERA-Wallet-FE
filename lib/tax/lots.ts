import { ZERO, add, div, gt, isPositive, isZero, min, mul, sub } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import type { LedgerPolicy } from "@/lib/tax/types";

export type Lot = {
  id: string;
  asset: string;
  wallet: string;
  /** 평균법 원장은 취득일을 특정하지 않으므로 null. */
  at: string | null;
  quantity: Decimal;
  /** 잔여 수량에 대응하는 잔여 취득가액. */
  cost: Decimal;
};

export type LotMatch = {
  lotId: string;
  quantity: Decimal;
  cost: Decimal;
  acquiredAt: string | null;
};

export type Consumption = {
  matches: LotMatch[];
  /** 원장에 없는 수량(이관 이력 누락). 취득가액 0으로 처리하고 경고를 남긴다. */
  shortfall: Decimal;
};

export type AcquireInput = {
  id: string;
  /**
   * 원장 내부 lot 키. 사용자 이벤트 id와 네임스페이스가 분리돼 있어야 한다.
   * 실제 이벤트 id가 다른 교환의 합성 id와 같아도 서로 다른 취득으로 취급된다.
   */
  key: string;
  asset: string;
  wallet: string;
  at: string;
  quantity: Decimal;
  cost: Decimal;
};
export type DisposeInput = { asset: string; wallet: string; at: string; quantity: Decimal };

export interface LotLedger {
  acquire(input: AcquireInput): void;
  dispose(input: DisposeInput): Consumption;
  holdings(): Lot[];
}

function scopeKey(policy: LedgerPolicy, asset: string, wallet: string): string {
  return policy.scope === "WALLET" ? `${wallet}::${asset}` : asset;
}

function unitCost(lot: Lot): Decimal {
  return isPositive(lot.quantity) ? div(lot.cost, lot.quantity) : ZERO;
}

/** FIFO / LIFO / 이동평균(ACB) / 총평균법을 공통 lot 원장으로 처리한다. */
export class StandardLotLedger implements LotLedger {
  private readonly lots = new Map<string, Lot[]>();
  /** 총평균법 전용: 기간 전체 평균 취득단가(자산별). */
  private readonly periodUnitCost = new Map<string, Decimal>();
  /**
   * 의제취득가액(KR)으로 uplift된 자산. 이 자산은 pool.cost를 실제 취득원가가 아니라
   * seed 단가 기준(unit × quantity)으로 쌓는다 — 그래야 처분이 풀을 완전히 비울 때
   * dispose의 잔차흡수 분기(lot.cost 반환)가 seed 총액을 돌려주어 uplift가 사라지지 않는다.
   * 비의제 자산(JP·CA 등)은 seed 단가=실제 평균이라 이 집합에 들지 않고 동작이 완전히 동일하다.
   */
  private readonly deemedAssets = new Set<string>();
  private sequence = 0;

  constructor(private readonly policy: LedgerPolicy) {}

  /**
   * 총평균법은 기간 내 모든 취득을 선반영해야 하므로 사전 계산된 단가를 주입받는다.
   * `deemed`가 참이면(KR 의제취득가액) 이 자산의 pool.cost를 seed 단가 기준으로 쌓아
   * 전량 처분까지 seed 단가가 authoritative하게 한다.
   */
  seedPeriodAverage(asset: string, unit: Decimal, deemed = false): void {
    this.periodUnitCost.set(asset, unit);
    if (deemed) this.deemedAssets.add(asset);
  }

  acquire(input: AcquireInput): void {
    const key = scopeKey(this.policy, input.asset, input.wallet);
    const bucket = this.lots.get(key) ?? [];
    if (this.policy.method === "MOVING_AVERAGE" || this.policy.method === "PERIOD_AVERAGE") {
      const pool = bucket[0] ?? { id: `pool-${key}`, asset: input.asset, wallet: input.wallet, at: null, quantity: ZERO, cost: ZERO };
      pool.quantity = add(pool.quantity, input.quantity);
      // 의제 uplift 자산은 seed 단가로, 그 외는 실제 취득원가로 pool.cost를 쌓는다.
      // seed 단가=실제 평균인 비의제 자산은 두 경로가 같은 값이라 byte-for-byte 동일하다.
      pool.cost = add(pool.cost, this.deemedAssets.has(input.asset) ? mul(this.periodUnitCost.get(input.asset) ?? ZERO, input.quantity) : input.cost);
      this.lots.set(key, [pool]);
      return;
    }
    this.sequence += 1;
    bucket.push({ id: `${input.id}#${this.sequence}`, asset: input.asset, wallet: input.wallet, at: input.at, quantity: input.quantity, cost: input.cost });
    this.lots.set(key, bucket);
  }

  dispose(input: DisposeInput): Consumption {
    const key = scopeKey(this.policy, input.asset, input.wallet);
    const bucket = this.lots.get(key) ?? [];
    const order = this.policy.method === "LIFO" ? [...bucket].reverse() : bucket;
    const matches: LotMatch[] = [];
    let remaining = input.quantity;

    for (const lot of order) {
      if (!isPositive(remaining)) break;
      if (!isPositive(lot.quantity)) continue;
      const taken = min(lot.quantity, remaining);
      // 총평균법은 기간 전체 평균단가를, 나머지는 lot 잔여 단가를 적용한다.
      const unit = this.policy.method === "PERIOD_AVERAGE" ? this.periodUnitCost.get(input.asset) ?? unitCost(lot) : unitCost(lot);
      const cost = isZero(sub(lot.quantity, taken)) ? lot.cost : mul(unit, taken);
      lot.quantity = sub(lot.quantity, taken);
      lot.cost = sub(lot.cost, cost);
      remaining = sub(remaining, taken);
      matches.push({ lotId: lot.id, quantity: taken, cost, acquiredAt: lot.at });
    }

    this.lots.set(
      key,
      bucket.filter((lot) => isPositive(lot.quantity) || this.policy.method === "MOVING_AVERAGE" || this.policy.method === "PERIOD_AVERAGE"),
    );
    return { matches, shortfall: isPositive(remaining) ? remaining : ZERO };
  }

  holdings(): Lot[] {
    return [...this.lots.values()].flat().filter((lot) => isPositive(lot.quantity));
  }
}

type PooledAcquisition = { key: string; at: string; quantity: Decimal; remaining: Decimal; cost: Decimal; unit: Decimal; pooled: boolean };

/**
 * 영국 법정 매칭 순서: 1) same-day → 2) 30일 내 재매수(bed & breakfast) → 3) Section 104 풀 평균원가.
 * 미래 취득과 매칭해야 하므로 기간 전체 취득 이벤트를 사전에 주입받는다.
 */
export class Section104Ledger implements LotLedger {
  private readonly acquisitions = new Map<string, PooledAcquisition[]>();
  private readonly pool = new Map<string, { quantity: Decimal; cost: Decimal }>();

  /** 기간 전체 취득 목록(시간순). runLedger가 사전 스캔해 넘긴다. */
  constructor(schedule: { key: string; asset: string; at: string; quantity: Decimal; cost: Decimal }[]) {
    for (const item of schedule) {
      const bucket = this.acquisitions.get(item.asset) ?? [];
      bucket.push({
        key: item.key,
        at: item.at,
        quantity: item.quantity,
        remaining: item.quantity,
        cost: item.cost,
        unit: isPositive(item.quantity) ? div(item.cost, item.quantity) : ZERO,
        pooled: false,
      });
      this.acquisitions.set(item.asset, bucket);
    }
  }

  acquire(input: AcquireInput): void {
    const record = (this.acquisitions.get(input.asset) ?? []).find((item) => item.key === input.key);
    // 선행 처분이 same-day / 30일 규칙으로 이미 소진한 수량은 풀에 넣지 않는다.
    const poolable = record ? record.remaining : input.quantity;
    if (record) record.pooled = true;
    if (!isPositive(poolable)) return;
    const cost = record ? record.cost : input.cost;
    const current = this.pool.get(input.asset) ?? { quantity: ZERO, cost: ZERO };
    this.pool.set(input.asset, { quantity: add(current.quantity, poolable), cost: add(current.cost, cost) });
  }

  dispose(input: DisposeInput): Consumption {
    const matches: LotMatch[] = [];
    let remaining = input.quantity;
    const schedule = this.acquisitions.get(input.asset) ?? [];
    const disposalDay = input.at.slice(0, 10);
    const windowEnd = Date.parse(input.at) + 30 * 86_400_000;

    const takeFrom = (candidates: PooledAcquisition[]) => {
      for (const record of candidates) {
        if (!isPositive(remaining)) break;
        if (!isPositive(record.remaining)) continue;
        const taken = min(record.remaining, remaining);
        const cost = isZero(sub(record.remaining, taken)) ? record.cost : mul(record.unit, taken);
        record.remaining = sub(record.remaining, taken);
        record.cost = sub(record.cost, cost);
        remaining = sub(remaining, taken);
        if (record.pooled) {
          // 이미 풀에 들어간 same-day 취득은 넣은 만큼 정확히 되돌린다.
          const current = this.pool.get(input.asset) ?? { quantity: ZERO, cost: ZERO };
          this.pool.set(input.asset, { quantity: sub(current.quantity, taken), cost: sub(current.cost, cost) });
        }
        matches.push({ lotId: record.key, quantity: taken, cost, acquiredAt: record.at });
      }
    };

    takeFrom(schedule.filter((record) => record.at.slice(0, 10) === disposalDay));
    takeFrom(
      schedule
        .filter((record) => Date.parse(record.at) > Date.parse(input.at) && Date.parse(record.at) <= windowEnd)
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    );

    if (isPositive(remaining)) {
      const current = this.pool.get(input.asset) ?? { quantity: ZERO, cost: ZERO };
      const taken = min(current.quantity, remaining);
      if (isPositive(taken)) {
        const cost = isZero(sub(current.quantity, taken)) ? current.cost : mul(div(current.cost, current.quantity), taken);
        this.pool.set(input.asset, { quantity: sub(current.quantity, taken), cost: sub(current.cost, cost) });
        remaining = sub(remaining, taken);
        matches.push({ lotId: `s104-${input.asset}`, quantity: taken, cost, acquiredAt: null });
      }
    }

    return { matches, shortfall: gt(remaining, ZERO) ? remaining : ZERO };
  }

  holdings(): Lot[] {
    return [...this.pool.entries()]
      .filter(([, value]) => isPositive(value.quantity))
      .map(([asset, value]) => ({ id: `s104-${asset}`, asset, wallet: "*", at: null, quantity: value.quantity, cost: value.cost }));
  }
}
