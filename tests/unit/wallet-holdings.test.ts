import { describe, expect, it } from "vitest";

import {
  addDecimal,
  compareDecimal,
  demoDefiPositions,
  demoNftHoldings,
  demoWalletHoldings,
  multiplyDecimal,
  portfolioTotalUsd,
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
      expect(compareDecimal(values[index - 1], values[index])).toBeGreaterThanOrEqual(0);
    }
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
