import { describe, expect, it } from "vitest";

import type { PortfolioHoldingDTO } from "@/lib/http/dto";
import type { BeHoldingsDTO } from "@/lib/schema/be-portfolio-transport";
import { coverageOf, costCurrenciesNeedingFx, normalizeDecimal, roundKrw, toPortfolioHoldings, type HoldingsFx } from "@/lib/wallet/holdings-cost";
import { groupGainKrw, groupHoldings, holdingsFromDto, holdingsGainSummary, totalValueKrw, unpricedCount } from "@/lib/wallet/holdings";

const USDC = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function beHolding(overrides: Partial<BeHoldingsDTO["holdings"][number]> = {}): BeHoldingsDTO["holdings"][number] {
  return {
    chainId: 1, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18,
    rawAmount: "750000000000000000", amount: "0.75", priceUsd: "3200", valueUsd: "2400", priceStatus: "priced",
    costBasis: { currency: "KRW", totalCost: "3000000", avgCost: "4000000", trackedAmount: "0.75" },
    canonicalAssetId: "eth",
    ...overrides,
  };
}

function be(holdings: BeHoldingsDTO["holdings"]): BeHoldingsDTO {
  return { walletAddresses: ["0xabc"], byWallet: [], holdings, skippedChainIds: [], truncatedChainIds: [], unresolvedCount: 0, totalValueUsd: "2400", unpricedCount: 0, asOf: "2026-09-11T05:00:00.000Z" };
}

/** US$1 = ₩1,390. 원가 통화 표는 비어 있다(원장 통화가 KRW라 필요 없다). */
const fx: HoldingsFx = { day: "2026-09-11", usdKrw: "1390", costKrwPer: new Map() };

describe("toPortfolioHoldings (BE 시세 USD → FE 계약 KRW, 원가는 원장 통화 KRW 그대로)", () => {
  it("converts price and value at today's USD→KRW rate and keeps a fully tracked KRW cost as ready (avgCost × balance)", () => {
    const [eth] = toPortfolioHoldings(be([beHolding()]), fx).holdings;
    // 3,200 USD × 1,390 = ₩4,448,000 · 2,400 USD × 1,390 = ₩3,336,000 · 원가 4,000,000 KRW/ETH × 0.75 = ₩3,000,000
    expect(eth).toMatchObject({ priceKrw: "4448000", valueKrw: "3336000", costKrw: "3000000", costStatus: "ready", trackedAmount: "0.75" });
  });

  it("rounds won amounts to whole won from ₩1 up and keeps two decimals below it (a dust balance is not ₩0)", () => {
    expect(roundKrw("3336000.4")).toBe("3336000");
    expect(roundKrw("3336000.5")).toBe("3336001");
    expect(roundKrw("0.417")).toBe("0.42");
    expect(roundKrw("-0.417")).toBe("-0.42");
    expect(roundKrw("1")).toBe("1");
  });

  it("treats a wei-level gap between the ledger fold and the on-chain balance as ready, priced over the whole balance", () => {
    // 온체인 0.749999999999999998 vs 원장 0.75: 완전 일치를 요구하면 실지갑에서 손익이 늘 사라진다.
    const [row] = toPortfolioHoldings(be([beHolding({ amount: "0.749999999999999998" })]), fx).holdings;
    expect(row.costStatus).toBe("ready");
    // 4,000,000 KRW/ETH × 0.749999999999999998 = 2,999,999.999999999992 → 원 단위 반올림
    expect(row.costKrw).toBe("3000000");
    expect(coverageOf("0.75", "0.749999999999999998")).toBe("ready");
    expect(coverageOf("0.7463", "0.75")).toBe("ready"); // 0.49%
    expect(coverageOf("0.746", "0.75")).toBe("partial"); // 0.53%
    expect(coverageOf("0.5", "0")).toBe("partial");
  });

  it("marks partial when the ledger tracks materially less (or more) than the live balance, keeping the ledger's own cost", () => {
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: { currency: "KRW", totalCost: "1000000", avgCost: "4000000", trackedAmount: "0.25" } })]), fx).holdings;
    expect(row).toMatchObject({ costKrw: "1000000", costStatus: "partial", trackedAmount: "0.25" });
  });

  it("normalizes an exponent-form provider price and keeps sub-won precision for a dust position", () => {
    expect(normalizeDecimal("1.2e-9")).toBe("0.0000000012");
    expect(normalizeDecimal("2.5E+3")).toBe("2500");
    expect(normalizeDecimal("-3e2")).toBe("-300");
    expect(normalizeDecimal("12.345e1")).toBe("123.45");
    expect(normalizeDecimal("0.5")).toBe("0.5");
    const [row] = toPortfolioHoldings(be([beHolding({ priceUsd: "1.2e-9", valueUsd: "0.0003" })]), fx).holdings;
    // 0.0000000012 USD × 1,390 = 0.000001668 KRW → 소수 8자리 · 0.0003 USD × 1,390 = 0.417 KRW → 1원 미만은 소수 둘째 자리
    expect(row.priceKrw).toBe("0.00000167");
    expect(row.valueKrw).toBe("0.42");
  });

  it("carries the number of rows the FE dropped", () => {
    expect(toPortfolioHoldings(be([]), fx, 3).droppedCount).toBe(3);
  });

  it("marks unknown with no cost when the ledger has never seen the asset", () => {
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: null })]), fx).holdings;
    expect(row).toMatchObject({ costKrw: null, costStatus: "unknown", trackedAmount: null });
  });

  it("marks fx_unavailable, never 0, when the cost currency has no rate, keeping price and value", () => {
    const usdCost = beHolding({ costBasis: { currency: "USD", totalCost: "1800", avgCost: "2400", trackedAmount: "0.75" } });
    const [row] = toPortfolioHoldings(be([usdCost]), fx).holdings;
    expect(row).toMatchObject({ costKrw: null, costStatus: "fx_unavailable", trackedAmount: "0.75", valueKrw: "3336000" });
  });

  it("converts a non-KRW cost with its own rate", () => {
    const withUsd: HoldingsFx = { ...fx, costKrwPer: new Map([["USD", "1390"]]) };
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: { currency: "USD", totalCost: "1800", avgCost: "2400", trackedAmount: "0.75" } })]), withUsd).holdings;
    // 2,400 USD/ETH × 0.75 × 1,390 = ₩2,502,000
    expect(row).toMatchObject({ costKrw: "2502000", costStatus: "ready" });
  });

  it("carries coverage facts through, converts the totals, and states the rate it used", () => {
    const source = {
      ...be([beHolding()]),
      byWallet: [{ address: "0xabc", verificationMethod: "siwe", totalValueUsd: "2400", chainIds: [1], holdingsCount: 1, unpricedCount: 0 }],
      skippedChainIds: [137], truncatedChainIds: [8453], unresolvedCount: 2, unpricedCount: 1,
    };
    const result = toPortfolioHoldings(source, fx);
    expect(result).toMatchObject({ walletAddresses: ["0xabc"], skippedChainIds: [137], truncatedChainIds: [8453], unresolvedCount: 2, droppedCount: 0, unpricedCount: 1, totalValueKrw: "3336000", asOf: "2026-09-11T05:00:00.000Z", fx: { usdKrw: "1390", day: "2026-09-11" } });
    expect(result.byWallet).toEqual([{ address: "0xabc", verificationMethod: "siwe", totalValueKrw: "3336000", chainIds: [1], holdingsCount: 1, unpricedCount: 0 }]);
  });

  it("lists the cost currencies that are not already KRW", () => {
    expect(costCurrenciesNeedingFx(be([beHolding(), beHolding({ costBasis: null })]))).toEqual([]);
    expect(costCurrenciesNeedingFx(be([beHolding({ costBasis: { currency: "USD", totalCost: "1", avgCost: "1", trackedAmount: "1" } })]))).toEqual(["USD"]);
  });
});

function dto(overrides: Partial<PortfolioHoldingDTO> = {}): PortfolioHoldingDTO {
  return { chainId: 1, assetType: "ERC20", contract: USDC, symbol: "USDC", name: "USD Coin", decimals: 6, amount: "500", priceKrw: "1", valueKrw: "500", priceStatus: "priced", costKrw: "480", costStatus: "ready", trackedAmount: "500", canonicalAssetId: "usdc", ...overrides };
}

describe("holdingsFromDto + null-aware display math", () => {
  it("orders priced rows by value desc and unpriced rows last, deterministically", () => {
    const rows = holdingsFromDto([
      dto({ symbol: "ZZZ", contract: "0x1", priceKrw: null, valueKrw: null, priceStatus: "unknown" }),
      dto({ symbol: "ETH", assetType: "NATIVE", contract: null, valueKrw: "2400" }),
      dto({ symbol: "AAA", contract: "0x0", priceKrw: null, valueKrw: null, priceStatus: "illiquid" }),
      dto(),
    ]);
    expect(rows.map((row) => row.symbol)).toEqual(["ETH", "USDC", "AAA", "ZZZ"]);
    expect(rows[0]).toMatchObject({ key: "1:ETH", chainName: "Ethereum", isNft: false });
    expect(rows[1].key).toBe(`1:${USDC}`);
  });

  it("drops unpriced rows from the total and counts them instead of adding 0", () => {
    const rows = holdingsFromDto([dto(), dto({ symbol: "X", contract: "0x1", priceKrw: null, valueKrw: null, priceStatus: "unknown" })]);
    expect(totalValueKrw(rows)).toBe("500");
    expect(unpricedCount(rows)).toBe(1);
  });

  it("sums gain only over rows with both value and cost, reporting how many were excluded", () => {
    const rows = holdingsFromDto([
      dto(), // +20
      dto({ symbol: "ETH", assetType: "NATIVE", contract: null, valueKrw: "2400", costKrw: null, costStatus: "unknown", trackedAmount: null }),
      dto({ symbol: "X", contract: "0x1", priceKrw: null, valueKrw: null, priceStatus: "unknown" }),
    ]);
    expect(holdingsGainSummary(rows)).toEqual({ valueKrw: "2900", costKrw: "480", gainKrw: "20", returnPercent: "4.17", excluded: 2 });
  });

  it("refuses a gain for a partially tracked cost — half the cost against the whole balance overstates it", () => {
    const rows = holdingsFromDto([dto({ costKrw: "240", costStatus: "partial", trackedAmount: "250" })]);
    expect(holdingsGainSummary(rows)).toEqual({ valueKrw: "500", costKrw: null, gainKrw: null, returnPercent: null, excluded: 1 });
  });

  it("reports null gain (not 0) when no row has a cost", () => {
    const rows = holdingsFromDto([dto({ costKrw: null, costStatus: "fx_unavailable" })]);
    expect(holdingsGainSummary(rows)).toEqual({ valueKrw: "500", costKrw: null, gainKrw: null, returnPercent: null, excluded: 1 });
  });
});

describe("groupHoldings (같은 정식 자산의 체인별 행 합치기)", () => {
  const eth = (chainId: number, over: Partial<PortfolioHoldingDTO> = {}) => dto({ chainId, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18, canonicalAssetId: "eth", ...over });

  it("merges rows sharing a canonical id: amounts and values summed, chains listed, logo from the largest member", () => {
    const groups = groupHoldings(holdingsFromDto([
      eth(10, { amount: "0.1", valueKrw: "320", costKrw: "300", costStatus: "ready" }),
      eth(1, { amount: "0.75", valueKrw: "2400", costKrw: "2160", costStatus: "ready" }),
      dto(),
    ]));
    expect(groups.map((group) => [group.symbol, group.members.length, group.amount, group.valueKrw, group.chainIds])).toEqual([
      ["ETH", 2, "0.85", "2720", [1, 10]],
      ["USDC", 1, "500", "500", [1]],
    ]);
    expect(groups[0].members[0].chainId).toBe(1);
    expect(groups[0]).toMatchObject({ costKrw: "2460", costStatus: "ready" });
    expect(groupGainKrw(groups[0])).toBe("260");
  });

  it("never merges by symbol: rows without a canonical id stay separate even with the same symbol", () => {
    const groups = groupHoldings(holdingsFromDto([
      dto({ contract: "0x1", canonicalAssetId: null }),
      dto({ contract: "0x2", canonicalAssetId: null }),
    ]));
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.members.length === 1)).toBe(true);
  });

  it("refuses a group gain when any member lacks price or full cost — one partial chain taints the whole group", () => {
    const partial = groupHoldings(holdingsFromDto([
      eth(1, { amount: "0.75", valueKrw: "2400", costKrw: "2160", costStatus: "ready" }),
      eth(10, { amount: "0.1", valueKrw: "320", costKrw: "100", costStatus: "partial", trackedAmount: "0.05" }),
    ]))[0];
    expect(partial).toMatchObject({ valueKrw: "2720", costKrw: null, costStatus: "partial" });
    expect(groupGainKrw(partial)).toBeNull();

    const unpriced = groupHoldings(holdingsFromDto([
      eth(1, { amount: "0.75", valueKrw: "2400", costKrw: "2160", costStatus: "ready" }),
      eth(10, { amount: "0.1", priceKrw: null, valueKrw: null, priceStatus: "unknown", costKrw: "100", costStatus: "ready" }),
    ]))[0];
    // 시세 없는 멤버는 평가액에 0으로 더해지지 않고 unpricedCount에 센다.
    expect(unpriced).toMatchObject({ valueKrw: "2400", unpricedCount: 1, amount: "0.85" });
    expect(groupGainKrw(unpriced)).toBeNull();

    const fx = groupHoldings(holdingsFromDto([
      eth(1, { costKrw: "2160", costStatus: "ready" }),
      eth(10, { costKrw: null, costStatus: "fx_unavailable" }),
    ]))[0];
    expect(fx.costStatus).toBe("fx_unavailable");
  });
});
