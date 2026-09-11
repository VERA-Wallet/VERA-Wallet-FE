import { describe, expect, it } from "vitest";

import { resolveTokenMark, REGISTERED_CHAIN_IDS } from "@/lib/assets/token-logo";

const asset = (over: Partial<Parameters<typeof resolveTokenMark>[0]>) => ({
  chain_id: 1,
  asset_type: "ERC20" as const,
  asset_contract: null,
  token_id: null,
  ...over,
});

describe("resolveTokenMark", () => {
  it("등록된 체인의 캐노니컬 USDC/USDT 컨트랙트를 마크로 해석한다", () => {
    expect(resolveTokenMark(asset({ chain_id: 8453, asset_contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }))).toBe("USDC");
    expect(resolveTokenMark(asset({ chain_id: 137, asset_contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" }))).toBe("USDT");
  });

  it("컨트랙트 대소문자를 정규화한다", () => {
    expect(resolveTokenMark(asset({ chain_id: 1, asset_contract: "0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48" }))).toBe("USDC");
  });

  it("네이티브 코인은 체인으로 해석한다 — ETH 체인만, Polygon(POL)은 벡터가 없어 null", () => {
    expect(resolveTokenMark(asset({ chain_id: 1, asset_type: "NATIVE" }))).toBe("ETH");
    expect(resolveTokenMark(asset({ chain_id: 42161, asset_type: "NATIVE" }))).toBe("ETH");
    expect(resolveTokenMark(asset({ chain_id: 137, asset_type: "NATIVE" }))).toBeNull();
  });

  it("심볼은 키가 아니다 — 미등록 컨트랙트는 심볼이 무엇이든 null", () => {
    expect(resolveTokenMark(asset({ chain_id: 1, asset_contract: "0x0000000000000000000000000000000000000bad" }))).toBeNull();
  });

  it("등록되지 않은 체인은 null", () => {
    expect(REGISTERED_CHAIN_IDS.has(56)).toBe(false);
    expect(resolveTokenMark(asset({ chain_id: 56, asset_contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }))).toBeNull();
  });

  it("NFT(토큰 번호가 있는 자산)는 조회하지 않는다", () => {
    expect(resolveTokenMark(asset({ chain_id: 1, asset_type: "ERC721", token_id: "1", asset_contract: "0xdac17f958d2ee523a2206206994597c13d831ec7" }))).toBeNull();
  });
});
