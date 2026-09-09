import type { FxRateProvider, FxRateTable } from "@/lib/ports/fx-rate";
import { div, type Decimal } from "@/lib/tax/decimal";

/**
 * 고정 환율(EUR 1단위당). **결정적 테스트·CI 전용**이다.
 * 실제 세금 숫자를 이 표로 만들면 안 된다 — 날짜와 무관한 한 값이라 취득·양도 시점의 환율 차이가 사라진다.
 * 운영 배선은 `VERAWALLET_FX_SOURCE`가 `fixed`일 때만 이 provider를 고른다.
 */
export const FIXED_EUR_RATES: Readonly<Record<string, Decimal>> = {
  EUR: "1",
  KRW: "1500",
  USD: "1.1",
  GBP: "0.85",
  JPY: "165",
  INR: "92",
  AUD: "1.65",
  CAD: "1.5",
};

export class FixedFxRateProvider implements FxRateProvider {
  constructor(private readonly perEur: Readonly<Record<string, Decimal>> = FIXED_EUR_RATES) {}

  async ratesFor({ from, to, dates }: { from: string; to: string; dates: readonly string[] }): Promise<FxRateTable> {
    const table = new Map<string, Decimal>();
    const fromPerEur = this.perEur[from];
    const toPerEur = this.perEur[to];
    if (fromPerEur === undefined || toPerEur === undefined) return table;
    const rate = div(toPerEur, fromPerEur);
    for (const day of new Set(dates)) table.set(day, rate);
    return table;
  }
}
