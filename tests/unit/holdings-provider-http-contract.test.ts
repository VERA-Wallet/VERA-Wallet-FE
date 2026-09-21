import { describe, expect, it, vi } from "vitest";

import { HoldingsFetchError, HttpHoldingsProvider } from "@/lib/adapters/http/holdings-provider.http";
import type { PortfolioHoldingsDTO } from "@/lib/http/dto";

const dto: PortfolioHoldingsDTO = {
  walletAddresses: ["0xabc"],
  byWallet: [],
  holdings: [{ chainId: 1, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18, amount: "0.75", priceKrw: "3200", valueKrw: "2400", priceStatus: "priced", costKrw: "2160", costStatus: "ready", trackedAmount: "0.75", canonicalAssetId: "eth" }],
  skippedChainIds: [], truncatedChainIds: [], unresolvedCount: 0, droppedCount: 0, totalValueKrw: "2400", unpricedCount: 0, asOf: "2026-09-11T05:00:00.000Z", fx: { usdKrw: "1390", day: "2026-09-11" },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// 클라이언트 경계: 라우트 출력과 클라이언트 zod 계약이 어긋나면 브라우저에서만 드러난다. 여기서 못 박는다.
describe("HttpHoldingsProvider contract", () => {
  it("decodes the FE route envelope and carries provenance", async () => {
    const fetcher = vi.fn(async () => json({ data: dto, meta: { provenance: "live", generatedAt: "2026-09-11T05:00:01.000Z" } }));
    const result = await new HttpHoldingsProvider(fetcher).getHoldings();
    expect(result).toEqual({ data: dto, provenance: "live" });
    expect(fetcher).toHaveBeenCalledWith("/api/portfolio/holdings");
  });

  it("preserves the error code so the screen can tell 'no wallet' from 'session ended'", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401));
    const failure = await new HttpHoldingsProvider(fetcher).getHoldings().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(HoldingsFetchError);
    expect(failure).toMatchObject({ code: "unauthorized" });
  });

  it("rejects a payload that violates the client contract as invalid_response — never renders a half-parsed wallet", async () => {
    const fetcher = vi.fn(async () => json({ data: { ...dto, holdings: [{ ...dto.holdings[0], costStatus: "maybe" }] }, meta: { provenance: "live", generatedAt: "x" } }));
    const failure = await new HttpHoldingsProvider(fetcher).getHoldings().catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ code: "invalid_response" });
  });
});
