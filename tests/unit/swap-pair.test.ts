import { describe, expect, it } from "vitest";

import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { pairSwapLegs } from "@/lib/swap-pair";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/** 페어링 규칙 검증용 최소 이벤트. 필요한 칸만 덮는다. */
function event(over: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  return {
    tx_hash: "0xaa",
    chain_id: 8453,
    log_index: 0,
    block_timestamp: "2025-07-01T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "OUT",
    asset_type: "ERC20",
    asset_contract: "0x2222222222222222222222222222222222222222",
    asset_symbol: "USDC",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 6,
    raw_amount: "1000000000",
    counterparty: "0x3333333333333333333333333333333333333333",
    gas_fee_native: "0.0004",
    classification: "EXCHANGE",
    confidence: 0.95,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "1400000.00",
    fiat_currency: "KRW",
    income_kind: null,
    group_id: "grp-1",
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...over,
  };
}

describe("스왑 두 다리 페어링", () => {
  it("같은 group_id의 EXCHANGE·OUT + RECEIVE·IN을 한 쌍으로 묶는다", () => {
    const out = event({ id: "out", classification: "EXCHANGE", direction: "OUT", group_id: "g1" });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", asset_symbol: "ETH", group_id: "g1" });
    const pairing = pairSwapLegs([out, received]);
    expect(pairing.inLegByOutId.get("out")?.id).toBe("in");
    expect(pairing.pairedInIds.has("in")).toBe(true);
  });

  it("group_id가 다르면(같은 tx여도) 묶지 않는다 — 페어링은 서버 발급 키만 따른다", () => {
    const out = event({ id: "out", group_id: "g1" });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", group_id: "g2" });
    expect(pairSwapLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("group_id가 없는 leg는 묶지 않는다(서버가 스왑으로 인정하지 않음)", () => {
    const out = event({ id: "out", group_id: null });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", group_id: null });
    expect(pairSwapLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("가격 미확정(price_status UNKNOWN)이어도 병합한다 — 병합은 표시, 가격은 세무", () => {
    const out = event({ id: "out", price_status: "UNKNOWN", fiat_value: null, group_id: "g1" });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", price_status: "UNKNOWN", fiat_value: null, group_id: "g1" });
    const pairing = pairSwapLegs([out, received]);
    expect(pairing.inLegByOutId.get("out")?.id).toBe("in");
  });

  it("신뢰도가 바닥(0.5) 미만인 다리(브릿지 의심)는 묶지 않는다", () => {
    const out = event({ id: "out", confidence: 0.4, group_id: "g1" });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", group_id: "g1" });
    expect(pairSwapLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("소득 수령(IN)은 스왑 다리가 아니다", () => {
    const out = event({ id: "out", group_id: "g1" });
    const income = event({ id: "in", classification: "RECEIVE", direction: "IN", income_kind: "STAKING", group_id: "g1" });
    expect(pairSwapLegs([out, income]).inLegByOutId.size).toBe(0);
  });

  it("live 데모 픽스처의 스왑들이 실제로 페어링된다", () => {
    const events = createNormalizedEventFixtures(2025, new Date(Date.UTC(2026, 7, 26)));
    const pairing = pairSwapLegs(events);
    // 기준 연도 스왑 2건 + 시행연도 쇼케이스 스왑 1건.
    expect(pairing.inLegByOutId.size).toBeGreaterThanOrEqual(2);
    for (const [outId, inLeg] of pairing.inLegByOutId) {
      const out = events.find((item) => item.id === outId)!;
      expect(out.group_id).toBe(inLeg.group_id);
      expect(out.group_id).toBeTruthy();
      expect(out.direction).toBe("OUT");
      expect(inLeg.direction).toBe("IN");
    }
  });
});
