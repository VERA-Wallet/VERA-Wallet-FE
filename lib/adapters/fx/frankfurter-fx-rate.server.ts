import "server-only";

import { FxRateUnavailableError, type FxRateProvider, type FxRateTable } from "@/lib/ports/fx-rate";
import { div, type Decimal } from "@/lib/tax/decimal";

/**
 * Frankfurter(ECB 기준환율) 어댑터.
 *
 * - 기준통화를 EUR로 고정하고 두 통화의 EUR 대비 시세를 받아 교차환율을 만든다. `base=KRW`로 받으면
 *   응답이 소수 5자리로 잘려 USD 0.00067처럼 유효숫자 2자리가 되기 때문이다(약 8% 오차).
 * - ECB는 영업일에만 고시한다. 주말·연휴 거래는 **직전 영업일** 환율을 쓴다(세무 관행과 같다). 그래서 요청
 *   범위 앞쪽을 LOOKBACK_DAYS만큼 더 받아 첫 거래일이 연휴여도 직전 값을 찾는다.
 * - 과거 날짜의 환율은 바뀌지 않으므로 프로세스 메모리에 영구 캐시한다. 오늘 값은 오후에 갱신되므로 캐시하지 않는다.
 * - 소스가 응답하지 못하면 빈 표 대신 FxRateUnavailableError를 던진다. 빈 표는 "환율 없음"으로 읽혀 모든 이벤트가
 *   조용히 제외되고, 화면은 "계산할 거래 없음"이라는 거짓말을 하게 된다.
 */
const DEFAULT_BASE_URL = "https://api.frankfurter.dev/v1";
const CROSS_BASE = "EUR";
const LOOKBACK_DAYS = 10;
const DEFAULT_TIMEOUT_MS = 8_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Options = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 테스트에서 "오늘"을 고정한다(캐시 경계). */
  today?: () => string;
};

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 정렬된 날짜 목록에서 `day` 이하의 마지막 날짜. 없으면 undefined. */
export function latestOnOrBefore(sortedDays: readonly string[], day: string): string | undefined {
  let low = 0;
  let high = sortedDays.length - 1;
  let found: string | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sortedDays[mid] <= day) {
      found = sortedDays[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** JSON number를 decimal 문자열로. 지수 표기(1e-7)를 막고 유한 양수만 받는다. */
function toDecimal(value: unknown): Decimal | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value.toFixed(8).replace(/\.?0+$/, "");
}

export class FrankfurterFxRateProvider implements FxRateProvider {
  private readonly cache = new Map<string, Decimal>();

  constructor(private readonly options: Options = {}) {}

  async ratesFor({ from, to, dates }: { from: string; to: string; dates: readonly string[] }): Promise<FxRateTable> {
    const table = new Map<string, Decimal>();
    if (dates.length === 0) return table;
    if (from === to) {
      for (const day of dates) table.set(day, "1");
      return table;
    }
    const wanted = [...new Set(dates)].sort();
    const missing = wanted.filter((day) => {
      const hit = this.cache.get(cacheKey(from, to, day));
      if (hit === undefined) return true;
      table.set(day, hit);
      return false;
    });
    if (missing.length === 0) return table;

    const series = await this.fetchSeries(shiftDay(missing[0], -LOOKBACK_DAYS), missing[missing.length - 1], [from, to]);
    const publishedDays = [...series.keys()].sort();
    const today = (this.options.today ?? utcToday)();
    for (const day of missing) {
      const source = latestOnOrBefore(publishedDays, day);
      if (source === undefined) continue;
      const perEur = series.get(source)!;
      const fromPerEur = from === CROSS_BASE ? "1" : perEur[from];
      const toPerEur = to === CROSS_BASE ? "1" : perEur[to];
      if (fromPerEur === undefined || toPerEur === undefined) continue;
      const rate = div(toPerEur, fromPerEur);
      table.set(day, rate);
      if (day < today) this.cache.set(cacheKey(from, to, day), rate);
    }
    return table;
  }

  private async fetchSeries(start: string, end: string, currencies: string[]): Promise<Map<string, Record<string, Decimal>>> {
    const symbols = [...new Set(currencies.filter((code) => code !== CROSS_BASE))];
    const baseUrl = (this.options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const url = `${baseUrl}/${start}..${end}?base=${CROSS_BASE}&symbols=${symbols.join(",")}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (cause) {
      const timeout = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      throw new FxRateUnavailableError(timeout ? "timeout" : "network", `환율 서버(${CROSS_BASE} 기준)에 연결하지 못했다: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!response.ok) throw new FxRateUnavailableError("http_status", `환율 서버가 HTTP ${response.status}를 돌려줬다.`, response.status);

    const body = (await response.json().catch(() => null)) as { rates?: unknown } | null;
    const rates = body?.rates;
    if (rates === null || typeof rates !== "object") throw new FxRateUnavailableError("invalid_response", "환율 응답에 rates가 없다.");

    const series = new Map<string, Record<string, Decimal>>();
    for (const [day, quotes] of Object.entries(rates as Record<string, unknown>)) {
      if (!DAY_PATTERN.test(day) || quotes === null || typeof quotes !== "object") continue;
      const row: Record<string, Decimal> = {};
      for (const [code, value] of Object.entries(quotes as Record<string, unknown>)) {
        const decimal = toDecimal(value);
        if (decimal !== undefined) row[code] = decimal;
      }
      series.set(day, row);
    }
    return series;
  }
}

function cacheKey(from: string, to: string, day: string): string {
  return `${from}:${to}:${day}`;
}
