import { describe, expect, it } from "vitest";

import type { PortfolioHoldingDTO } from "@/lib/http/dto";
import type { BeHoldingsDTO } from "@/lib/schema/be-portfolio-transport";
import { coverageOf, costCurrenciesNeedingFx, normalizeDecimal, toPortfolioHoldings } from "@/lib/wallet/holdings-cost";
import { holdingsFromDto, holdingsGainSummary, totalValueUsd, unpricedCount } from "@/lib/wallet/holdings";

const USDC = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function beHolding(overrides: Partial<BeHoldingsDTO["holdings"][number]> = {}): BeHoldingsDTO["holdings"][number] {
  return {
    chainId: 1, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18,
    rawAmount: "750000000000000000", amount: "0.75", priceUsd: "3200", valueUsd: "2400", priceStatus: "priced",
    costBasis: { currency: "KRW", totalCost: "3000000", avgCost: "4000000", trackedAmount: "0.75" },
    ...overrides,
  };
}

function be(holdings: BeHoldingsDTO["holdings"]): BeHoldingsDTO {
  return { walletAddresses: ["0xabc"], byWallet: [], holdings, skippedChainIds: [], truncatedChainIds: [], unresolvedCount: 0, totalValueUsd: "2400", unpricedCount: 0, asOf: "2026-09-11T05:00:00.000Z" };
}

const krwToUsd = { table: new Map([["2026-09-11", "0.00072"]]), day: "2026-09-11" };

describe("toPortfolioHoldings (BE 원가 KRW → FE 계약 USD)", () => {
  it("converts a fully tracked cost at the day's rate and marks it ready (avgCost × balance)", () => {
    const [eth] = toPortfolioHoldings(be([beHolding()]), krwToUsd).holdings;
    expect(eth).toMatchObject({ costUsd: "2160", costStatus: "ready", trackedAmount: "0.75", priceUsd: "3200", valueUsd: "2400" });
  });

  it("treats a wei-level gap between the ledger fold and the on-chain balance as ready, priced over the whole balance", () => {
    // 온체인 0.749999999999999998 vs 원장 0.75: 완전 일치를 요구하면 실지갑에서 손익이 늘 사라진다.
    const [row] = toPortfolioHoldings(be([beHolding({ amount: "0.749999999999999998" })]), krwToUsd).holdings;
    expect(row.costStatus).toBe("ready");
    // 4,000,000 KRW/ETH × 0.749999999999999998 × 0.00072 = 2159.99999999999999424 → 8자리 반올림
    expect(row.costUsd).toBe("2160");
    expect(coverageOf("0.75", "0.749999999999999998")).toBe("ready");
    expect(coverageOf("0.7463", "0.75")).toBe("ready"); // 0.49%
    expect(coverageOf("0.746", "0.75")).toBe("partial"); // 0.53%
    expect(coverageOf("0.5", "0")).toBe("partial");
  });

  it("marks partial when the ledger tracks materially less (or more) than the live balance, keeping the ledger's own cost", () => {
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: { currency: "KRW", totalCost: "1000000", avgCost: "4000000", trackedAmount: "0.25" } })]), krwToUsd).holdings;
    expect(row).toMatchObject({ costUsd: "720", costStatus: "partial", trackedAmount: "0.25" });
  });

  it("normalizes an exponent-form provider price into plain decimal so FE math can use it", () => {
    expect(normalizeDecimal("1.2e-9")).toBe("0.0000000012");
    expect(normalizeDecimal("2.5E+3")).toBe("2500");
    expect(normalizeDecimal("-3e2")).toBe("-300");
    expect(normalizeDecimal("12.345e1")).toBe("123.45");
    expect(normalizeDecimal("0.5")).toBe("0.5");
    const [row] = toPortfolioHoldings(be([beHolding({ priceUsd: "1.2e-9" })]), krwToUsd).holdings;
    expect(row.priceUsd).toBe("0.0000000012");
  });

  it("carries the number of rows the FE dropped", () => {
    expect(toPortfolioHoldings(be([]), null, 3).droppedCount).toBe(3);
  });

  it("marks unknown with no cost when the ledger has never seen the asset", () => {
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: null })]), krwToUsd).holdings;
    expect(row).toMatchObject({ costUsd: null, costStatus: "unknown", trackedAmount: null });
  });

  it("marks fx_unavailable — never 0 — when the rate source did not answer, keeping price and value", () => {
    const [row] = toPortfolioHoldings(be([beHolding()]), null).holdings;
    expect(row).toMatchObject({ costUsd: null, costStatus: "fx_unavailable", trackedAmount: "0.75", valueUsd: "2400" });
    const [missingDay] = toPortfolioHoldings(be([beHolding()]), { table: new Map(), day: "2026-09-11" }).holdings;
    expect(missingDay.costStatus).toBe("fx_unavailable");
  });

  it("passes a USD cost through without a rate", () => {
    const [row] = toPortfolioHoldings(be([beHolding({ costBasis: { currency: "USD", totalCost: "1800", avgCost: "2400", trackedAmount: "0.75" } })]), null).holdings;
    expect(row).toMatchObject({ costUsd: "1800", costStatus: "ready" });
  });

  it("carries coverage facts and totals through unchanged", () => {
    const source = { ...be([beHolding()]), skippedChainIds: [137], truncatedChainIds: [8453], unresolvedCount: 2, unpricedCount: 1 };
    const result = toPortfolioHoldings(source, krwToUsd);
    expect(result).toMatchObject({ walletAddresses: ["0xabc"], skippedChainIds: [137], truncatedChainIds: [8453], unresolvedCount: 2, droppedCount: 0, unpricedCount: 1, totalValueUsd: "2400", asOf: "2026-09-11T05:00:00.000Z" });
  });

  it("lists the non-USD cost currencies that need a rate", () => {
    expect(costCurrenciesNeedingFx(be([beHolding(), beHolding({ costBasis: null })]))).toEqual(["KRW"]);
    expect(costCurrenciesNeedingFx(be([beHolding({ costBasis: { currency: "USD", totalCost: "1", avgCost: "1", trackedAmount: "1" } })]))).toEqual([]);
  });
});

function dto(overrides: Partial<PortfolioHoldingDTO> = {}): PortfolioHoldingDTO {
  return { chainId: 1, assetType: "ERC20", contract: USDC, symbol: "USDC", name: "USD Coin", decimals: 6, amount: "500", priceUsd: "1", valueUsd: "500", priceStatus: "priced", costUsd: "480", costStatus: "ready", trackedAmount: "500", ...overrides };
}

describe("holdingsFromDto + null-aware display math", () => {
  it("orders priced rows by value desc and unpriced rows last, deterministically", () => {
    const rows = holdingsFromDto([
      dto({ symbol: "ZZZ", contract: "0x1", priceUsd: null, valueUsd: null, priceStatus: "unknown" }),
      dto({ symbol: "ETH", assetType: "NATIVE", contract: null, valueUsd: "2400" }),
      dto({ symbol: "AAA", contract: "0x0", priceUsd: null, valueUsd: null, priceStatus: "illiquid" }),
      dto(),
    ]);
    expect(rows.map((row) => row.symbol)).toEqual(["ETH", "USDC", "AAA", "ZZZ"]);
    expect(rows[0]).toMatchObject({ key: "1:ETH", chainName: "Ethereum", isNft: false });
    expect(rows[1].key).toBe(`1:${USDC}`);
  });

  it("drops unpriced rows from the total and counts them instead of adding 0", () => {
    const rows = holdingsFromDto([dto(), dto({ symbol: "X", contract: "0x1", priceUsd: null, valueUsd: null, priceStatus: "unknown" })]);
    expect(totalValueUsd(rows)).toBe("500");
    expect(unpricedCount(rows)).toBe(1);
  });

  it("sums gain only over rows with both value and cost, reporting how many were excluded", () => {
    const rows = holdingsFromDto([
      dto(), // +20
      dto({ symbol: "ETH", assetType: "NATIVE", contract: null, valueUsd: "2400", costUsd: null, costStatus: "unknown", trackedAmount: null }),
      dto({ symbol: "X", contract: "0x1", priceUsd: null, valueUsd: null, priceStatus: "unknown" }),
    ]);
    expect(holdingsGainSummary(rows)).toEqual({ valueUsd: "2900", costUsd: "480", gainUsd: "20", returnPercent: "4.17", excluded: 2 });
  });

  it("refuses a gain for a partially tracked cost — half the cost against the whole balance overstates it", () => {
    const rows = holdingsFromDto([dto({ costUsd: "240", costStatus: "partial", trackedAmount: "250" })]);
    expect(holdingsGainSummary(rows)).toEqual({ valueUsd: "500", costUsd: null, gainUsd: null, returnPercent: null, excluded: 1 });
  });

  it("reports null gain (not 0) when no row has a cost", () => {
    const rows = holdingsFromDto([dto({ costUsd: null, costStatus: "fx_unavailable" })]);
    expect(holdingsGainSummary(rows)).toEqual({ valueUsd: "500", costUsd: null, gainUsd: null, returnPercent: null, excluded: 1 });
  });
});
