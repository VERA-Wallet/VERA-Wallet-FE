import type { PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";
import type { HoldingsProvider } from "@/lib/ports/holdings-provider";
import { DEMO_TOKENS, demoWalletHoldings, totalValueUsd } from "@/lib/wallet/holdings";

/**
 * OFF(mock) 모드의 보유 자산 소스. 지갑 홈이 하드코딩하던 데모 지갑(ETH·USDT·USDC + 데모 시세·원가)을
 * BE와 같은 계약으로 돌려준다. BE MOCK_MODE의 데모 지갑과 같은 자산·수량이라 두 모드가 같은 화면을 그린다.
 */
export class MockHoldingsProvider implements HoldingsProvider {
  constructor(private readonly walletAddresses: readonly string[], private readonly now: () => Date = () => new Date()) {}

  async getHoldings(): Promise<{ data: PortfolioHoldingsDTO; provenance: Provenance }> {
    const holdings = demoWalletHoldings();
    return {
      provenance: "mock",
      data: {
        walletAddresses: this.walletAddresses.map((address) => address.toLowerCase()),
        holdings: holdings.map((holding) => ({
          chainId: holding.chainId,
          assetType: holding.contract === null ? "NATIVE" : "ERC20",
          contract: holding.contract,
          symbol: holding.symbol,
          name: holding.name,
          decimals: DEMO_TOKENS.find((token) => token.chainId === holding.chainId && token.symbol === holding.symbol)!.decimals,
          amount: holding.amount,
          priceUsd: holding.priceUsd,
          valueUsd: holding.valueUsd,
          priceStatus: "priced",
          costUsd: holding.costUsd,
          costStatus: "ready",
          trackedAmount: holding.amount,
        })),
        skippedChainIds: [],
        truncatedChainIds: [],
        unresolvedCount: 0,
        droppedCount: 0,
        totalValueUsd: totalValueUsd(holdings),
        unpricedCount: 0,
        asOf: this.now().toISOString(),
      },
    };
  }
}
