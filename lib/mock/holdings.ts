import type { PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";
import { HoldingsReadError, type HoldingsProvider } from "@/lib/ports/holdings-provider";
import { DEMO_TOKENS, DEMO_USD_KRW, demoWalletHoldings, totalValueKrw } from "@/lib/wallet/holdings";

/**
 * OFF(mock) 모드의 보유 자산 소스. 지갑 홈이 하드코딩하던 데모 지갑(ETH·USDT·USDC + 데모 시세·원가)을
 * BE와 같은 계약으로 돌려준다. BE MOCK_MODE의 데모 지갑과 같은 자산·수량이라 두 모드가 같은 화면을 그린다.
 */
export class MockHoldingsProvider implements HoldingsProvider {
  constructor(
    private readonly walletAddresses: readonly string[],
    private readonly verificationMethod: "siwe" | "watch_only" = "siwe",
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getHoldings(address?: string): Promise<{ data: PortfolioHoldingsDTO; provenance: Provenance }> {
    const registered = this.walletAddresses.map((item) => item.toLowerCase());
    const scoped = address === undefined ? registered : registered.filter((item) => item === address.toLowerCase());
    if (scoped.length === 0) throw new HoldingsReadError(404, "not_found", "That wallet is not registered to this user.");
    const holdings = demoWalletHoldings();
    // 데모 지갑은 하나뿐이다: 첫 지갑이 데모 자산 전부를 들고, 추가 등록한 지갑은 비어 있다.
    const chainIds = [...new Set(holdings.map((holding) => holding.chainId))].sort((a, b) => a - b);
    return {
      provenance: "mock",
      data: {
        walletAddresses: scoped,
        byWallet: scoped.map((item) => (item === registered[0]
          ? { address: item, verificationMethod: this.verificationMethod, totalValueKrw: totalValueKrw(holdings), chainIds, holdingsCount: holdings.length, unpricedCount: 0 }
          : { address: item, verificationMethod: this.verificationMethod, totalValueKrw: "0", chainIds: [], holdingsCount: 0, unpricedCount: 0 })),
        holdings: scoped.includes(registered[0]) ? holdings.map((holding) => ({
          chainId: holding.chainId,
          assetType: holding.contract === null ? "NATIVE" : "ERC20",
          contract: holding.contract,
          symbol: holding.symbol,
          name: holding.name,
          decimals: DEMO_TOKENS.find((token) => token.chainId === holding.chainId && token.symbol === holding.symbol)!.decimals,
          amount: holding.amount,
          priceKrw: holding.priceKrw,
          valueKrw: holding.valueKrw,
          priceStatus: "priced",
          costKrw: holding.costKrw,
          costStatus: "ready",
          trackedAmount: holding.amount,
          canonicalAssetId: holding.symbol.toLowerCase(),
        })) : [],
        skippedChainIds: [],
        truncatedChainIds: [],
        unresolvedCount: 0,
        droppedCount: 0,
        totalValueKrw: scoped.includes(registered[0]) ? totalValueKrw(holdings) : "0",
        unpricedCount: 0,
        asOf: this.now().toISOString(),
        // 데모 시세는 이 환율로 옮긴 원화다. 화면이 실데이터와 같은 문장으로 환산 근거를 말한다.
        fx: { usdKrw: DEMO_USD_KRW, day: this.now().toISOString().slice(0, 10) },
      },
    };
  }
}
