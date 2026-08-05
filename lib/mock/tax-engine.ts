import "server-only";

import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";
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
export class MockTaxEngine implements TaxEnginePort {
  constructor(private readonly walletEvents: () => NormalizedEvent[]) {}

  async listRuleSets(): Promise<RuleSetSummary[]> {
    return listRuleSetSummaries();
  }

  async estimate(input: TaxEstimateRequest): Promise<TaxEstimate> {
    if (input.source === "scenario") {
      const events = createTaxScenarioEvents();
      const estimateInput = {
        country: input.country,
        taxYear: input.taxYear,
        profile: input.profile,
        events,
      };
      const estimate = computeTaxEstimate(estimateInput);
      return input.includeMarginal === true
        ? { ...estimate, marginalContributions: computeMarginalContributions(estimateInput) }
        : estimate;
    }

    // 취득 이력은 기간 전 것도 필요하므로 전체를 파생한다.
    const walletEvents = this.walletEvents();
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
