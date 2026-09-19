import "server-only";

import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { Provenance } from "@/lib/http/envelope";
import type { FxRateProvider, FxRateTable } from "@/lib/ports/fx-rate";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeMarginalContributions, computeTaxEstimate, taxPeriodFor } from "@/lib/tax/engine";
import { convertEventsToCurrency, fxDatesNeeded } from "@/lib/tax/fx-convert";
import { getRuleSet, listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEnginePort, TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { Limitation, RuleSetSummary, TaxEstimate } from "@/lib/tax/types";
import { EXCLUDED_ID_SUFFIX, FX_CONVERSION_SUFFIX, FX_RATE_SUFFIX, limitationOf, sortLimitations } from "@/lib/tax/limitations";

/** 지갑 이벤트 스냅샷과 그 출처. 배열만 주면 mock으로 본다(테스트 픽스처 관례). */
export type WalletEventSource = { events: NormalizedEvent[]; provenance: Provenance };
type WalletEventsReader = () => NormalizedEvent[] | WalletEventSource | Promise<NormalizedEvent[] | WalletEventSource>;

function asSource(value: NormalizedEvent[] | WalletEventSource): WalletEventSource {
  return Array.isArray(value) ? { events: value, provenance: "mock" } : value;
}

type CurrencyConversion = {
  events: NormalizedEvent[];
  unconvertibleIds: string[];
  /** 환산이 실제로 일어난 원통화들. 한계 문구("KRW → USD …")의 근거. */
  convertedFrom: string[];
};

/**
 * 세무 엔진 어댑터.
 * 이벤트 출처(OFF: FE mock store, ON: BE 스냅샷)와 환율 소스만 바깥에서 받고, 룰셋·원장·계산은 lib/tax가 그대로 담당한다.
 */
export class TaxEngineService implements TaxEnginePort {
  /**
   * @param walletEvents 지갑 이벤트 출처. 배열이면 mock 출처로 본다.
   * @param fx 과거 환율 소스. 이벤트 통화(BE는 KRW)와 룰셋 통화가 다르면 **거래일 환율**로 환산한다.
   *   `null`이면 환산하지 않고 통과시킨다 — 이벤트 통화가 곧 룰셋 통화라고 가정하는 것이라 픽스처 기반 테스트 전용이다.
   *   운영 배선(composition-root.server.ts)은 반드시 provider를 준다. 환산 없이 다른 통화 룰셋을 계산하면
   *   원화 금액에 달러 라벨이 붙는다(실지갑 검증에서 미국 룰셋이 원화 90만 원을 90만 달러로 계산했다).
   */
  constructor(private readonly walletEvents: WalletEventsReader, private readonly fx: FxRateProvider | null = null) {}

  async listRuleSets(): Promise<RuleSetSummary[]> {
    return listRuleSetSummaries();
  }

  async estimate(input: TaxEstimateRequest): Promise<TaxEstimate> {
    if (input.source === "scenario") {
      // 연도를 넘기지 않으면 어느 해를 골라도 데모 시계의 해만 계산돼 나머지 해가 "계산할 거래 없음"이 된다.
      // 금액 자릿수는 룰셋 통화에 맞춘다 — 원화 기본공제 250만원이 만 단위 거래를 전부 삼키지 않도록.
      // 시나리오 금액은 통화 중립이라 환산 대상이 아니다.
      const events = createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country));
      const estimateInput = {
        country: input.country,
        taxYear: input.taxYear,
        profile: input.profile,
        assumeEffective: input.assumeEffective,
        deemedFmv: input.deemedFmv,
        events,
      };
      const estimate = computeTaxEstimate(estimateInput);
      return input.includeMarginal === true
        ? { ...estimate, marginalContributions: computeMarginalContributions(estimateInput) }
        : estimate;
    }

    const source = asSource(await this.walletEvents());
    // 모르는 룰셋은 computeTaxEstimate가 UnknownRuleSetError로 거절한다. 여기서는 통화만 미리 본다.
    const targetCurrency = getRuleSet(input.country)?.currency;
    const conversion = targetCurrency === undefined
      ? { events: source.events, unconvertibleIds: [], convertedFrom: [] }
      : await this.toCurrency(source.events, targetCurrency);

    // 취득 이력은 기간 전 것도 필요하므로 전체를 파생한다.
    const derived = deriveTaxEvents(conversion.events);
    // 다만 "확인이 필요해 계산에서 빠짐"은 **이 과세기간 안**의 이벤트에만 해당한다.
    // 기간 밖 이벤트까지 세면 화면이 없던 사유를 지어낸다(2024년 계산에 2025년 6건이 잡히던 결함).
    const period = taxPeriodFor(input.country, input.taxYear);
    const inPeriod = new Set(
      source.events
        .filter((event) => {
          const at = Date.parse(event.block_timestamp);
          return at >= Date.parse(period.from) && at < Date.parse(period.to);
        })
        .map((event) => event.id),
    );
    const fxExcludedIds = conversion.unconvertibleIds.filter((id) => inPeriod.has(id));
    const estimateInput = {
      country: input.country,
      taxYear: input.taxYear,
      profile: input.profile,
      assumeEffective: input.assumeEffective,
      deemedFmv: input.deemedFmv,
      events: derived.events,
      excludedEventIds: [...derived.excludedEventIds.filter((id) => inPeriod.has(id)), ...fxExcludedIds],
    };
    const estimate = computeTaxEstimate(estimateInput);
    // 제외 사유는 아는 생산자(파생·환율)가 말한다. finalizeEstimate는 사유 없이 "확인이 필요해"로 같은 id를
    // 한 줄씩 더 채우는데, 그대로 두면 같은 거래가 두 줄에 세어져 화면 건수가 부풀었다(실지갑 39건 중복).
    const fxLimitations: Limitation[] = [
      ...fxExcludedIds.map((id) => limitationOf(`${id}:${FX_RATE_SUFFIX}`, [id])),
      ...conversion.convertedFrom.map((from) => limitationOf(`${from} → ${targetCurrency}${FX_CONVERSION_SUFFIX}`, [])),
    ];
    const explained = new Set([...derived.limitations, ...fxLimitations].flatMap((row) => row.eventIds));
    const rulesetLimitations = estimate.limitations.filter(
      (row) => !(row.message.endsWith(EXCLUDED_ID_SUFFIX) && row.eventIds.length === 1 && explained.has(row.eventIds[0])),
    );
    return {
      ...estimate,
      ...(input.includeMarginal === true
        ? { marginalContributions: computeMarginalContributions(estimateInput) }
        : {}),
      notes: [...estimate.notes, ...derived.assumptions],
      limitations: sortLimitations([...rulesetLimitations, ...derived.limitations, ...fxLimitations]),
      provenance: source.provenance,
    };
  }

  /** 이벤트 통화가 룰셋 통화와 다르면 거래일 환율로 환산한다. 같은 통화뿐이면 환율 소스를 부르지 않는다. */
  private async toCurrency(events: NormalizedEvent[], target: string): Promise<CurrencyConversion> {
    const needs = fxDatesNeeded(events, target);
    if (needs.length === 0 || this.fx === null) return { events, unconvertibleIds: [], convertedFrom: [] };
    const tables = new Map<string, FxRateTable>();
    for (const need of needs) {
      tables.set(need.from, await this.fx.ratesFor({ from: need.from, to: target, dates: need.dates }));
    }
    const converted = convertEventsToCurrency(events, target, tables);
    return { ...converted, convertedFrom: needs.map((need) => need.from) };
  }
}
