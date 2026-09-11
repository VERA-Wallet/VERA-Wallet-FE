import { describe, expect, it } from "vitest";

import {
  addDecimal,
  compareDecimal,
  demoDefiPositions,
  demoNftHoldings,
  demoWalletHoldings,
  holdingGainUsd,
  holdingsGainSummary,
  multiplyDecimal,
  portfolioTotalUsd,
  returnPercent,
  subtractDecimal,
  totalValueUsd,
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
    expect(totalValueUsd(demoWalletHoldings())).toBe("3750");
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
  it("holds ETH, USDT, and USDC as fungible tokens with computed USD values", () => {
    const holdings = demoWalletHoldings();

    expect(holdings.map((holding) => holding.symbol)).toEqual(["ETH", "USDT", "USDC"]);
    expect(holdings.every((holding) => holding.isNft === false)).toBe(true);
    const eth = holdings.find((holding) => holding.symbol === "ETH")!;
    expect(eth).toMatchObject({ amount: "0.75", priceUsd: "3200.00", valueUsd: "2400", chainId: 1 });
  });

  it("sorts holdings by USD value descending", () => {
    const values = demoWalletHoldings().map((holding) => holding.valueUsd);
    // ETH 2400 > USDT 850 > USDC 500
    expect(values).toEqual(["2400", "850", "500"]);
    for (let index = 1; index < values.length; index += 1) {
      expect(compareDecimal(values[index - 1]!, values[index]!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("carries a mock cost basis and derives gain/return per holding", () => {
    const holdings = demoWalletHoldings();
    const eth = holdings.find((holding) => holding.symbol === "ETH")!;
    const usdt = holdings.find((holding) => holding.symbol === "USDT")!;
    const usdc = holdings.find((holding) => holding.symbol === "USDC")!;

    expect(eth.costUsd).toBe("1800.00");
    expect(holdingGainUsd(eth)).toBe("600"); // 2,400 − 1,800, a gain
    expect(returnPercent(eth.costUsd!, holdingGainUsd(eth)!)).toBe("33.33");

    expect(usdt.costUsd).toBe("900.00");
    expect(holdingGainUsd(usdt)).toBe("-50"); // 850 − 900, a loss
    expect(returnPercent(usdt.costUsd!, holdingGainUsd(usdt)!)).toBe("-5.56");

    expect(usdc.costUsd).toBe("480.00");
    expect(holdingGainUsd(usdc)).toBe("20");
  });
});

describe("holdingsGainSummary", () => {
  it("aggregates value, cost, gain, and return for the token holdings", () => {
    // value 3,750 − cost (1,800 + 900 + 480 = 3,180) = +570 → +17.92%.
    const summary = holdingsGainSummary(demoWalletHoldings());
    expect(summary.valueUsd).toBe("3750");
    expect(summary.costUsd).toBe("3180");
    expect(summary.gainUsd).toBe("570");
    expect(summary.returnPercent).toBe("17.92");
  });
});

describe("demoNftHoldings", () => {
  it("holds popular collections sorted by floor value descending", () => {
    const nfts = demoNftHoldings();
    expect(nfts.map((nft) => nft.shortName)).toEqual(["BAYC", "PPG", "AZUKI", "DOODLE"]);
    expect(nfts.map((nft) => nft.valueUsd)).toEqual(["8000", "5200", "3100", "1200"]);
    expect(nfts[0]).toMatchObject({ collection: "Bored Ape Yacht Club", tokenId: "4521", chainId: 1 });
  });
});

describe("demoDefiPositions", () => {
  it("lists protocol positions sorted by value descending with a localized kind label", () => {
    const defi = demoDefiPositions();
    expect(defi.map((position) => position.protocol)).toEqual(["Uniswap v3", "Lido", "Aave v3"]);
    expect(defi.map((position) => position.valueUsd)).toEqual(["3200", "2100", "1500"]);
    expect(defi.find((position) => position.protocol === "Lido")).toMatchObject({ kind: "staking", kindLabel: "스테이킹", apy: "3.2%" });
  });
});

describe("portfolioTotalUsd", () => {
  it("sums tokens, NFTs, and DeFi positions", () => {
    // tokens 3,750 + nfts 17,500 + defi 6,800 = 28,050
    expect(portfolioTotalUsd(demoWalletHoldings(), demoNftHoldings(), demoDefiPositions())).toBe("28050");
  });
});
