import { describe, expect, it } from "vitest";

import {
  addDecimal,
  compareDecimal,
  demoDefiPositions,
  demoNftHoldings,
  demoWalletHoldings,
  holdingGainKrw,
  holdingsGainSummary,
  multiplyDecimal,
  portfolioTotalKrw,
  returnPercent,
  subtractDecimal,
  totalValueKrw,
} from "@/lib/wallet/holdings";

describe("decimal math", () => {
  it("multiplies decimal strings without float error and trims trailing zeros", () => {
    expect(multiplyDecimal("0.75", "3200.00")).toBe("2400");
    expect(multiplyDecimal("850", "1.00")).toBe("850");
    expect(multiplyDecimal("0.1", "0.2")).toBe("0.02");
  });

  it("adds decimal strings across differing scales", () => {
    expect(addDecimal("2400", "850")).toBe("3250");
    expect(addDecimal("0.1", "0.02")).toBe("0.12");
  });

  it("compares decimal strings by magnitude", () => {
    expect(compareDecimal("2400", "850")).toBe(1);
    expect(compareDecimal("500", "500.00")).toBe(0);
    expect(compareDecimal("0.9", "1")).toBe(-1);
  });

  it("sums holding values into a portfolio total", () => {
    expect(totalValueKrw(demoWalletHoldings())).toBe("5062500");
  });

  it("subtracts decimal strings across differing scales", () => {
    expect(subtractDecimal("2400", "1800.00")).toBe("600");
    expect(subtractDecimal("850", "900.00")).toBe("-50");
    expect(subtractDecimal("500", "500")).toBe("0");
  });

  it("computes return percent to two decimals, null when cost is zero", () => {
    // 600 gain on 1,800 cost = +33.33%.
    expect(returnPercent("1800.00", "600")).toBe("33.33");
    // -50 gain on 900 cost = -5.56%.
    expect(returnPercent("900.00", "-50")).toBe("-5.56");
    expect(returnPercent("480.00", "20")).toBe("4.17");
    expect(returnPercent("1000", "0")).toBe("0");
    expect(returnPercent("0", "10")).toBeNull();
  });
});

describe("demoWalletHoldings", () => {
  it("holds ETH, USDT, and USDC as fungible tokens with computed KRW values", () => {
    const holdings = demoWalletHoldings();

    expect(holdings.map((holding) => holding.symbol)).toEqual(["ETH", "USDT", "USDC"]);
    expect(holdings.every((holding) => holding.isNft === false)).toBe(true);
    const eth = holdings.find((holding) => holding.symbol === "ETH")!;
    expect(eth).toMatchObject({ amount: "0.75", priceKrw: "4320000", valueKrw: "3240000", chainId: 1 });
  });

  it("sorts holdings by KRW value descending", () => {
    const values = demoWalletHoldings().map((holding) => holding.valueKrw);
    // ETH 3,240,000 > USDT 1,147,500 > USDC 675,000
    expect(values).toEqual(["3240000", "1147500", "675000"]);
    for (let index = 1; index < values.length; index += 1) {
      expect(compareDecimal(values[index - 1]!, values[index]!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("carries a mock cost basis and derives gain/return per holding", () => {
    const holdings = demoWalletHoldings();
    const eth = holdings.find((holding) => holding.symbol === "ETH")!;
    const usdt = holdings.find((holding) => holding.symbol === "USDT")!;
    const usdc = holdings.find((holding) => holding.symbol === "USDC")!;

    expect(eth.costKrw).toBe("2430000");
    expect(holdingGainKrw(eth)).toBe("810000"); // 3,240,000 − 2,430,000, a gain
    expect(returnPercent(eth.costKrw!, holdingGainKrw(eth)!)).toBe("33.33");

    expect(usdt.costKrw).toBe("1215000");
    expect(holdingGainKrw(usdt)).toBe("-67500"); // 1,147,500 − 1,215,000, a loss
    expect(returnPercent(usdt.costKrw!, holdingGainKrw(usdt)!)).toBe("-5.56");

    expect(usdc.costKrw).toBe("648000");
    expect(holdingGainKrw(usdc)).toBe("27000");
  });
});

describe("holdingsGainSummary", () => {
  it("aggregates value, cost, gain, and return for the token holdings", () => {
    // value 5,062,500 − cost (2,430,000 + 1,215,000 + 648,000 = 4,293,000) = +769,500 → +17.92%.
    const summary = holdingsGainSummary(demoWalletHoldings());
    expect(summary.valueKrw).toBe("5062500");
    expect(summary.costKrw).toBe("4293000");
    expect(summary.gainKrw).toBe("769500");
    expect(summary.returnPercent).toBe("17.92");
  });
});

describe("demoNftHoldings", () => {
  it("holds popular collections sorted by floor value descending", () => {
    const nfts = demoNftHoldings();
    expect(nfts.map((nft) => nft.shortName)).toEqual(["BAYC", "PPG", "AZUKI", "DOODLE"]);
    expect(nfts.map((nft) => nft.valueKrw)).toEqual(["10800000", "7020000", "4185000", "1620000"]);
    expect(nfts[0]).toMatchObject({ collection: "Bored Ape Yacht Club", tokenId: "4521", chainId: 1 });
  });
});

describe("demoDefiPositions", () => {
  it("lists protocol positions sorted by value descending with a localized kind label", () => {
    const defi = demoDefiPositions();
    expect(defi.map((position) => position.protocol)).toEqual(["Uniswap v3", "Lido", "Aave v3"]);
    expect(defi.map((position) => position.valueKrw)).toEqual(["4320000", "2835000", "2025000"]);
    expect(defi.find((position) => position.protocol === "Lido")).toMatchObject({ kind: "staking", kindLabel: "스테이킹", apy: "3.2%" });
  });
});

describe("portfolioTotalKrw", () => {
  it("sums tokens, NFTs, and DeFi positions", () => {
    // tokens 5,062,500 + nfts 23,625,000 + defi 9,180,000 = 37,867,500
    expect(portfolioTotalKrw(demoWalletHoldings(), demoNftHoldings(), demoDefiPositions())).toBe("37867500");
  });
});
