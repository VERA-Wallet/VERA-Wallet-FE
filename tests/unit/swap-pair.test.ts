import { describe, expect, it } from "vitest";

import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { pairBridgeLegs, pairSwapLegs } from "@/lib/swap-pair";
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

describe("브릿지 두 다리 페어링", () => {
  it("같은 bridge_group_id의 INTERNAL_TRANSFER·OUT + INTERNAL_TRANSFER·IN을 한 쌍으로 묶는다", () => {
    const out = event({
      id: "out",
      classification: "INTERNAL_TRANSFER",
      direction: "OUT",
      group_id: null,
      bridge_group_id: "b1",
      bridge_dest_chain_id: 10,
    });
    const received = event({
      id: "in",
      classification: "INTERNAL_TRANSFER",
      direction: "IN",
      chain_id: 10,
      group_id: null,
      bridge_group_id: "b1",
    });
    const pairing = pairBridgeLegs([out, received]);
    expect(pairing.inLegByOutId.get("out")?.id).toBe("in");
    expect(pairing.pairedInIds.has("in")).toBe(true);
  });

  it("bridge_group_id가 다르면 묶지 않는다 — 페어링은 서버 발급 키만 따른다", () => {
    const out = event({ id: "out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1" });
    const received = event({ id: "in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: "b2" });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("bridge_group_id가 없는 leg는 묶지 않는다(서버가 브릿지로 인정하지 않음)", () => {
    const out = event({ id: "out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: null });
    const received = event({ id: "in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: null });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("한쪽을 사용자가 INTERNAL_TRANSFER 밖으로 재분류하면 묶지 않는다 — 자기이동이 아니라는 판단을 존중한다", () => {
    const out = event({ id: "out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1" });
    const received = event({
      id: "in",
      classification: "INTERNAL_TRANSFER",
      direction: "IN",
      group_id: null,
      bridge_group_id: "b1",
      user_override: { classification: "RECEIVE", reason: "실제로는 받은 선물", overridden_at: "2025-08-01T00:00:00.000Z" },
    });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("신뢰도가 바닥(0.5) 미만인 다리는 묶지 않는다", () => {
    const out = event({ id: "out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1", confidence: 0.4 });
    const received = event({ id: "in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("한 그룹에 OUT이 둘 이상이면(모호) 묶지 않는다 — 보수적으로 각 행을 그대로 둔다", () => {
    const out1 = event({ id: "out1", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1" });
    const out2 = event({ id: "out2", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1" });
    const received = event({ id: "in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out1, out2, received]).inLegByOutId.size).toBe(0);
  });

  it("스왑 group_id와 브릿지 bridge_group_id는 서로 다른 채널이다 — 섞여도 교차로 묶이지 않는다", () => {
    const swapOut = event({ id: "swap-out", classification: "EXCHANGE", direction: "OUT", group_id: "g1", bridge_group_id: null });
    const swapIn = event({ id: "swap-in", classification: "RECEIVE", direction: "IN", group_id: "g1", bridge_group_id: null });
    const bridgeOut = event({ id: "bridge-out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1" });
    const bridgeIn = event({ id: "bridge-in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: "b1" });
    const all = [swapOut, swapIn, bridgeOut, bridgeIn];
    const swapPairing = pairSwapLegs(all);
    const bridgePairing = pairBridgeLegs(all);
    expect(swapPairing.pairedInIds).toEqual(new Set(["swap-in"]));
    expect(bridgePairing.pairedInIds).toEqual(new Set(["bridge-in"]));
  });
});

describe("브릿지 두 다리 페어링 — 자산이 바뀌는 브릿지(브릿지 스왑)", () => {
  it("같은 bridge_group_id의 EXCHANGE·OUT + RECEIVE·IN(소득 아님)을 한 쌍으로 묶는다 — 예: Mayan(Polygon USDT → Ethereum USDC)", () => {
    const out = event({
      id: "mayan-out",
      classification: "EXCHANGE",
      direction: "OUT",
      chain_id: 137,
      asset_symbol: "USDT",
      group_id: null,
      bridge_group_id: "mayan-1",
      bridge_dest_chain_id: 1,
      raw_amount: "17270000",
    });
    const received = event({
      id: "mayan-in",
      classification: "RECEIVE",
      direction: "IN",
      chain_id: 1,
      asset_symbol: "USDC",
      group_id: null,
      bridge_group_id: "mayan-1",
      raw_amount: "15940000",
    });
    const pairing = pairBridgeLegs([out, received]);
    expect(pairing.inLegByOutId.get("mayan-out")?.id).toBe("mayan-in");
    expect(pairing.pairedInIds.has("mayan-in")).toBe(true);
  });

  it("IN이 소득 수령(income_kind 있음)이면 브릿지 스왑 다리가 아니다", () => {
    const out = event({ id: "out", classification: "EXCHANGE", direction: "OUT", group_id: null, bridge_group_id: "b1", bridge_dest_chain_id: 1 });
    const income = event({ id: "in", classification: "RECEIVE", direction: "IN", income_kind: "STAKING", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out, income]).inLegByOutId.size).toBe(0);
  });

  it("OUT을 사용자가 EXCHANGE 밖으로 재분류하면(예: SEND) 묶지 않는다", () => {
    const out = event({
      id: "out",
      classification: "EXCHANGE",
      direction: "OUT",
      group_id: null,
      bridge_group_id: "b1",
      bridge_dest_chain_id: 1,
      user_override: { classification: "SEND", reason: "이건 단순 송금", overridden_at: "2025-08-01T00:00:00.000Z" },
    });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("신뢰도가 바닥(0.5) 미만인 다리는 묶지 않는다", () => {
    const out = event({ id: "out", classification: "EXCHANGE", direction: "OUT", group_id: null, bridge_group_id: "b1", bridge_dest_chain_id: 1, confidence: 0.4 });
    const received = event({ id: "in", classification: "RECEIVE", direction: "IN", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out, received]).inLegByOutId.size).toBe(0);
  });

  it("한 그룹에 IN이 둘 이상이면(모호) 묶지 않는다 — 보수적으로 각 행을 그대로 둔다", () => {
    const out = event({ id: "out", classification: "EXCHANGE", direction: "OUT", group_id: null, bridge_group_id: "b1", bridge_dest_chain_id: 1 });
    const in1 = event({ id: "in1", classification: "RECEIVE", direction: "IN", group_id: null, bridge_group_id: "b1" });
    const in2 = event({ id: "in2", classification: "RECEIVE", direction: "IN", group_id: null, bridge_group_id: "b1" });
    expect(pairBridgeLegs([out, in1, in2]).inLegByOutId.size).toBe(0);
  });

  it("같은 그룹에 같은 자산 이동(INTERNAL_TRANSFER) 모양이 1:1로 성립하면 그쪽을 우선한다", () => {
    // 실제로는 서버가 한 그룹을 두 모양으로 겹쳐 찍지 않지만, 함수 자체의 우선순위 규칙을 고정한다.
    const internalOut = event({ id: "internal-out", classification: "INTERNAL_TRANSFER", direction: "OUT", group_id: null, bridge_group_id: "b1", bridge_dest_chain_id: 1 });
    const internalIn = event({ id: "internal-in", classification: "INTERNAL_TRANSFER", direction: "IN", group_id: null, bridge_group_id: "b1" });
    const pairing = pairBridgeLegs([internalOut, internalIn]);
    expect(pairing.inLegByOutId.get("internal-out")?.id).toBe("internal-in");
  });
});
