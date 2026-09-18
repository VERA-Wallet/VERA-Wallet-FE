import { requireDidSession } from "@/lib/dal";
import { success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { demoWalletHoldings } from "@/lib/wallet/holdings";
import type { HoldingDTO, HoldingsDTO } from "@/lib/http/dto";

/**
 * OFF(FE mock) 모드의 보유 자산. ON 모드에서는 `proxy.ts`가 이 경로를 BE로 넘기므로 여기까지 오지 않는다.
 *
 * 데모 상수를 BE와 **같은 계약**으로 감싸 내려준다. 화면이 모드별로 다른 모양을 받지 않게 하려는 것이고,
 * 그래서 mock에서도 시세 미상·스팸 필드가 실재한다(값만 비어 있다).
 */
export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) return walletNotBoundResponse();

  const holdings: HoldingDTO[] = demoWalletHoldings().map((holding) => ({
    key: holding.key,
    chainId: holding.chainId,
    contract: holding.contract,
    symbol: holding.symbol,
    name: holding.name,
    amount: holding.amount,
    priceUsd: holding.priceUsd,
    valueUsd: holding.valueUsd,
    spam: false,
  }));

  const totalUsd = holdings.reduce((sum, holding) => sum + Number(holding.valueUsd ?? 0), 0);
  const payload: HoldingsDTO = {
    walletAddress: session.walletAddress,
    holdings,
    // 데모 상수는 자릿수가 작아 Number 합산으로 충분하다. 실 잔액(18자리)은 BE가 BigInt로 센다.
    totalUsd: totalUsd.toString(),
    unpricedCount: 0,
    spamCount: 0,
    skippedChainIds: [],
    truncatedChainIds: [],
  };
  return Response.json(success(payload));
}
