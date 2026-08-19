import "server-only";

import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeMarginalContributions, computeTaxEstimate, taxPeriodFor } from "@/lib/tax/engine";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEnginePort, TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { RuleSetSummary, TaxEstimate } from "@/lib/tax/types";
import { sortLimitations } from "@/lib/tax/limitations";

/**
 * mock 세무 엔진 어댑터.
 * 실제 백엔드로 교체될 때 바뀌는 것은 이벤트 출처뿐이고, 룰셋·원장·계산은 lib/tax가 그대로 담당한다.
 */
export class TaxEngineService implements TaxEnginePort {
  // 지갑 이벤트 출처는 모드에 따라 다르다(OFF: FE mock store, ON: BE 스냅샷). 룰셋·원장·계산은 그대로 lib/tax가 담당한다.
  constructor(private readonly walletEvents: () => NormalizedEvent[] | Promise<NormalizedEvent[]>) {}

  async listRuleSets(): Promise<RuleSetSummary[]> {
    return listRuleSetSummaries();
  }

  async estimate(input: TaxEstimateRequest): Promise<TaxEstimate> {
    if (input.source === "scenario") {
      // 연도를 넘기지 않으면 어느 해를 골라도 데모 시계의 해만 계산돼 나머지 해가 "계산할 거래 없음"이 된다.
      // 금액 자릿수는 룰셋 통화에 맞춘다 — 원화 기본공제 250만원이 만 단위 거래를 전부 삼키지 않도록.
      const events = createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country));
      const estimateInput = {
        country: input.country,
        taxYear: input.taxYear,
        profile: input.profile,
        assumeEffective: input.assumeEffective,
        events,
      };
      const estimate = computeTaxEstimate(estimateInput);
      return input.includeMarginal === true
        ? { ...estimate, marginalContributions: computeMarginalContributions(estimateInput) }
        : estimate;
    }

    // 취득 이력은 기간 전 것도 필요하므로 전체를 파생한다.
    const walletEvents = await this.walletEvents();
    const derived = deriveTaxEvents(walletEvents);
    // 다만 "확인이 필요해 계산에서 빠짐"은 **이 과세기간 안**의 이벤트에만 해당한다.
    // 기간 밖 이벤트까지 세면 화면이 없던 사유를 지어낸다(2024년 계산에 2025년 6건이 잡히던 결함).
    const period = taxPeriodFor(input.country, input.taxYear);
    const inPeriod = new Set(
      walletEvents
        .filter((event) => {
          const at = Date.parse(event.block_timestamp);
          return at >= Date.parse(period.from) && at < Date.parse(period.to);
        })
        .map((event) => event.id),
    );
    const estimateInput = {
      country: input.country,
      taxYear: input.taxYear,
      profile: input.profile,
      assumeEffective: input.assumeEffective,
      events: derived.events,
      excludedEventIds: derived.excludedEventIds.filter((id) => inPeriod.has(id)),
    };
    const estimate = computeTaxEstimate(estimateInput);
    return {
      ...estimate,
      ...(input.includeMarginal === true
        ? { marginalContributions: computeMarginalContributions(estimateInput) }
        : {}),
      notes: [...estimate.notes, ...derived.assumptions],
      limitations: sortLimitations([...estimate.limitations, ...derived.limitations]),
    };
  }
}
