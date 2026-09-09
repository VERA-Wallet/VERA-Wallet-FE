import type { FxRateTable } from "@/lib/ports/fx-rate";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { mul, round, type Decimal } from "@/lib/tax/decimal";

/** 환산값 소수 자릿수. 원화(소수 2자리) × 환율(소수 ~6자리)이 잘리지 않게 넉넉히 둔다. 최종 반올림은 finalizeEstimate가 한다. */
export const FX_VALUE_DP = 8;

/** RFC3339 시각의 UTC 달력일. ECB 고시는 하루 한 값이라 시각은 버린다. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function moneyFields(event: NormalizedEvent): Array<Decimal | null> {
  const vo = event.value_override;
  return [event.fiat_value, vo?.acquisition_cost ?? null, vo?.disposal_value ?? null, vo?.incidental_cost ?? null, vo?.gas_fee ?? null];
}

/** 환산할 금액이 하나라도 있는가. 아무 금액도 없는 이벤트는 어차피 "가격 확인 필요"로 빠지므로 환율을 요구하지 않는다. */
function carriesMoney(event: NormalizedEvent): boolean {
  return moneyFields(event).some((value) => value !== null);
}

/** 환산이 필요한 (원통화, 날짜들) 묶음. 룰셋 통화와 같은 이벤트는 포함하지 않는다. */
export function fxDatesNeeded(events: readonly NormalizedEvent[], target: string): Array<{ from: string; dates: string[] }> {
  const byCurrency = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.fiat_currency === target || !carriesMoney(event)) continue;
    const days = byCurrency.get(event.fiat_currency) ?? new Set<string>();
    days.add(utcDay(event.block_timestamp));
    byCurrency.set(event.fiat_currency, days);
  }
  return [...byCurrency].map(([from, dates]) => ({ from, dates: [...dates].sort() }));
}

export type FxConversion = {
  events: NormalizedEvent[];
  /** 거래일 환율이 없어 환산하지 못한 이벤트. 목록에서 빠지며 호출자가 제외 사유로 알린다. */
  unconvertibleIds: string[];
};

/**
 * 이벤트 금액을 룰셋 통화로 환산한다. `fiat_value`와 사용자 입력 금액(value_override)을 같은 환율로 바꾸고
 * `fiat_currency`를 목표 통화로 바꾼다. 수량·시각·분류는 건드리지 않는다.
 */
export function convertEventsToCurrency(
  events: readonly NormalizedEvent[],
  target: string,
  tables: ReadonlyMap<string, FxRateTable>,
): FxConversion {
  const converted: NormalizedEvent[] = [];
  const unconvertibleIds: string[] = [];
  for (const event of events) {
    if (event.fiat_currency === target || !carriesMoney(event)) {
      converted.push(event);
      continue;
    }
    const rate = tables.get(event.fiat_currency)?.get(utcDay(event.block_timestamp));
    if (rate === undefined) {
      unconvertibleIds.push(event.id);
      continue;
    }
    const convert = (value: Decimal | null): Decimal | null => (value === null ? null : round(mul(value, rate), FX_VALUE_DP));
    const vo = event.value_override;
    converted.push({
      ...event,
      fiat_value: convert(event.fiat_value),
      fiat_currency: target,
      value_override: vo === null
        ? null
        : {
            ...vo,
            acquisition_cost: convert(vo.acquisition_cost),
            disposal_value: convert(vo.disposal_value),
            incidental_cost: convert(vo.incidental_cost),
            gas_fee: convert(vo.gas_fee),
          },
    });
  }
  return { events: converted, unconvertibleIds };
}
