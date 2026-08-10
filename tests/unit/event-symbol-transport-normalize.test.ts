import { describe, expect, it } from "vitest";

import { nativeSymbol } from "@/lib/format";
import { beEventListSchema, beNormalizedEventSchema } from "@/lib/schema/be-event-transport";

// BE(indexer.adapters.ts)가 실제로 내보내는 모양: symbol 키만 있고 asset_* 3종이 없다.
function beEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-01",
    tx_hash: `0x${"1".padStart(64, "0")}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2025-01-01T12:00:00.000Z",
    wallet_address: "0xwallet",
    direction: "IN",
    asset_type: "NATIVE",
    asset_contract: null,
    token_id: null,
    decimals: 18,
    raw_amount: "10000000000000000",
    counterparty: "0xcounterparty",
    gas_fee_native: "0.001",
    classification: "RECEIVE",
    confidence: 0.9,
    user_override: null,
    price_status: "RESOLVED",
    fiat_value: "1000.00",
    fiat_currency: "KRW",
    symbol: "ETH",
    ...overrides,
  };
}

describe("BE event transport normalization", () => {
  it("moves the BE symbol into the canonical asset_symbol field", () => {
    // canonical zod는 미지 키를 버리므로 디코딩 뒤 후처리로는 이 값을 복구할 수 없다.
    const parsed = beNormalizedEventSchema.parse(beEvent());
    expect(parsed.asset_symbol).toBe("ETH");
  });

  it.each([
    [1, "NATIVE"],
    [8453, "NATIVE"],
    [42161, "NATIVE"],
    [10, "NATIVE"],
    [137, "NATIVE"],
  ])("falls back to the chain native symbol for chain %s when BE omits symbol", (chainId) => {
    const parsed = beNormalizedEventSchema.parse(beEvent({ chain_id: chainId, symbol: undefined }));
    expect(parsed.asset_symbol).toBe(nativeSymbol(chainId));
  });

  it("uses the shared nativeSymbol fallback for an unknown chain instead of inventing a value", () => {
    const parsed = beNormalizedEventSchema.parse(beEvent({ chain_id: 999999, symbol: undefined }));
    expect(parsed.asset_symbol).toBe(nativeSymbol(999999));
  });

  it("keeps ERC assets on the BE symbol and never claims verification", () => {
    const parsed = beNormalizedEventSchema.parse(beEvent({
      asset_type: "ERC20",
      asset_contract: "0xtoken",
      symbol: "TOKEN",
    }));
    expect(parsed.asset_symbol).toBe("TOKEN");
    expect(parsed.asset_verified).toBe(false);
    expect(parsed.asset_icon_url).toBeNull();
  });

  it("leaves ERC assets without a symbol as unknown rather than guessing", () => {
    const parsed = beNormalizedEventSchema.parse(beEvent({ asset_type: "ERC721", asset_contract: "0xnft", token_id: "1", decimals: 0, raw_amount: "1", symbol: undefined }));
    expect(parsed.asset_symbol).toBeNull();
  });

  it("passes an already canonical payload through unchanged (OFF mode)", () => {
    const canonical = { ...beEvent(), asset_symbol: "POL", asset_verified: true, asset_icon_url: "https://icon.example/pol.png" };
    delete (canonical as Record<string, unknown>).symbol;
    const parsed = beNormalizedEventSchema.parse(canonical);
    expect(parsed).toMatchObject({ asset_symbol: "POL", asset_verified: true, asset_icon_url: "https://icon.example/pol.png" });
  });

  it("rejects a malformed payload instead of normalizing it into something valid", () => {
    expect(() => beNormalizedEventSchema.parse(beEvent({ confidence: 5 }))).toThrow();
    expect(() => beNormalizedEventSchema.parse(beEvent({ price_status: "UNKNOWN" }))).toThrow();
  });

  it("normalizes every event inside a list envelope", () => {
    const parsed = beEventListSchema.parse({ items: [{ event: beEvent(), version: 1 }], nextCursor: null });
    expect(parsed.items[0]!.event.asset_symbol).toBe("ETH");
  });
});
