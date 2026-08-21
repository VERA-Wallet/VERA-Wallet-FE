import { describe, expect, it } from "vitest";

import { runLedger } from "@/lib/tax/ledger";
import { getRuleSet } from "@/lib/tax/rulesets";
import type { DeemedCostResolver, TaxEvent } from "@/lib/tax/types";

const WALLET = "0xW";
const asset = (symbol: string) => `1:${symbol.toLowerCase()}`;

function acquire(id: string, at: string, symbol: string, quantity: string, cost: string): TaxEvent {
  return { kind: "ACQUIRE", id, at, wallet: WALLET, asset: asset(symbol), symbol, quantity, cost, fee: "0" };
}
function dispose(id: string, at: string, symbol: string, quantity: string, proceeds: string): TaxEvent {
  return { kind: "DISPOSE", id, at, wallet: WALLET, asset: asset(symbol), symbol, quantity, proceeds, fee: "0", trigger: "FIAT" };
}

// 단가가 다른 두 취득으로 총평균(JP)·Section 104(GB) 분기를 실제로 가른다.
const events: TaxEvent[] = [
  acquire("a", "2025-01-01T00:00:00.000Z", "BTC", "1", "10"),
  acquire("b", "2025-01-02T00:00:00.000Z", "BTC", "2", "90"),
  dispose("d", "2025-03-01T00:00:00.000Z", "BTC", "1", "50"),
];

// 자산 전체를 덮는 resolver. 아직 소비하지 않으므로 어떤 값이든 결과가 같아야 한다.
const resolver: DeemedCostResolver = () => "999999";

describe("deemed-cost resolver 배관은 아직 소비되지 않는다(US-001)", () => {
  for (const country of ["JP", "GB"]) {
    it(`${country}: resolver 유무와 무관하게 gains/acquisitions가 동일하다`, () => {
      const policy = getRuleSet(country)!.ledger;
      const withoutResolver = runLedger(events, policy);
      const withResolver = runLedger(events, policy, [], resolver);
      expect(withResolver.gains).toEqual(withoutResolver.gains);
      expect(withResolver.acquisitions).toEqual(withoutResolver.acquisitions);
    });
  }
});
