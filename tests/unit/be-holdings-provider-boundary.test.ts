import { afterEach, describe, expect, it, vi } from "vitest";

import { BeHttpHoldingsProvider } from "@/lib/adapters/http/holdings-provider.server";
import { FixedFxRateProvider } from "@/lib/adapters/fx/fixed-fx-rate";
import { FxRateUnavailableError, type FxRateProvider } from "@/lib/ports/fx-rate";
import { HoldingsReadError } from "@/lib/ports/holdings-provider";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

const cookie = "vw_access_token=token";
const today = () => "2026-09-11T05:00:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockFetch(value: Response | Error) {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
  const fetcher = vi.fn(async () => {
    if (value instanceof Error) throw value;
    return value;
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function envelope(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const beData = {
  walletAddresses: ["0xabc"],
  holdings: [
    { chainId: 1, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18, rawAmount: "1", amount: "0.75", priceUsd: "3200", valueUsd: "2400", priceStatus: "priced", costBasis: { currency: "KRW", totalCost: "3000000", avgCost: "4000000", trackedAmount: "0.75" } },
    { chainId: 8453, assetType: "ERC20", contract: "0xusdc", symbol: "USDC", name: "USD Coin", decimals: 6, rawAmount: "1", amount: "500", priceUsd: null, valueUsd: null, priceStatus: "unknown", costBasis: null },
  ],
  skippedChainIds: [137], truncatedChainIds: [], unresolvedCount: 0, totalValueUsd: "2400", unpricedCount: 1, asOf: "2026-09-11T05:00:00.000Z",
};
const ok = (provenance: "mock" | "live") => envelope({ data: beData, meta: { provenance, generatedAt: today() } }, 200);

describe("BeHttpHoldingsProvider boundary", () => {
  it("reads BE holdings, converts KRW cost to USD at today's rate, and passes BE provenance through", async () => {
    const fetcher = mockFetch(ok("live"));
    // 고정표: KRW 1500/EUR, USD 1.1/EUR → 1 KRW = 0.000733… USD. 3,000,000 KRW → 2,200 USD.
    const result = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings();
    expect(result.provenance).toBe("live");
    expect(result.data.holdings[0]).toMatchObject({ symbol: "ETH", costUsd: "2200", costStatus: "ready" });
    expect(result.data.holdings[1]).toMatchObject({ symbol: "USDC", costUsd: null, costStatus: "unknown", valueUsd: null });
    expect(result.data.skippedChainIds).toEqual([137]);
    // 세션 쿠키는 access-token 하나만, 경로는 BE 잔액 API.
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://be.example/api/portfolio/holdings");
    expect(new Headers(init.headers).get("cookie")).toBe(cookie);
  });

  it("keeps balances and prices when the FX source is down, marking cost fx_unavailable instead of failing", async () => {
    mockFetch(ok("live"));
    const down: FxRateProvider = { ratesFor: async () => { throw new FxRateUnavailableError("network", "offline"); } };
    const result = await new BeHttpHoldingsProvider(cookie, down, today).getHoldings();
    expect(result.data.holdings[0]).toMatchObject({ valueUsd: "2400", costUsd: null, costStatus: "fx_unavailable" });
  });

  it("does not call the FX source when no holding carries a non-USD cost", async () => {
    mockFetch(envelope({ data: { ...beData, holdings: [beData.holdings[1]] }, meta: { provenance: "mock", generatedAt: today() } }, 200));
    const ratesFor = vi.fn();
    await new BeHttpHoldingsProvider(cookie, { ratesFor }, today).getHoldings();
    expect(ratesFor).not.toHaveBeenCalled();
  });

  it("preserves the unbound-wallet 404 and the all-chains-down 503 as domain errors with their codes", async () => {
    mockFetch(envelope({ error: { code: "not_found", message: "A bound wallet is required before reading holdings." } }, 404));
    const notFound = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings().catch((cause: unknown) => cause);
    expect(notFound).toBeInstanceOf(HoldingsReadError);
    expect(notFound).toMatchObject({ status: 404, code: "not_found" });

    mockFetch(envelope({ error: { code: "service_unavailable", message: "Balance read observed no chain" } }, 503));
    const outage = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings().catch((cause: unknown) => cause);
    expect(outage).toMatchObject({ status: 503, code: "service_unavailable" });
  });

  it("tells an old BE without the route (Nest 'Cannot GET' 404) apart from the unbound-wallet 404", async () => {
    mockFetch(envelope({ error: { code: "not_found", message: "Cannot GET /api/portfolio/holdings" } }, 404));
    const missing = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings().catch((cause: unknown) => cause);
    expect(missing).toBeInstanceOf(HoldingsReadError);
    expect(missing).toMatchObject({ status: 502, code: "backend_endpoint_missing" });
  });

  it("classifies timeout, network loss, a 2xx error envelope, and a malformed body as infrastructure failures", async () => {
    mockFetch(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings()).rejects.toMatchObject({ cause: "timeout" });

    mockFetch(new Error("offline"));
    await expect(new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings()).rejects.toMatchObject({ cause: "network" });

    mockFetch(envelope({ error: { code: "not_found", message: "impossible" } }, 200));
    const contract = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings().catch((cause: unknown) => cause);
    expect(contract).toBeInstanceOf(SessionInfrastructureError);
    expect(contract).toMatchObject({ cause: "invalid_contract" });

    // 응답 껍데기(walletAddresses 등)가 깨진 것은 계약 위반이다.
    mockFetch(envelope({ data: { ...beData, walletAddresses: "0xabc" }, meta: { provenance: "live", generatedAt: today() } }, 200));
    await expect(new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings()).rejects.toMatchObject({ cause: "invalid_contract" });
  });

  it("drops a malformed row and reports it, instead of turning the whole wallet into a 502", async () => {
    // 원가 통화 필드가 빠진 행 하나 — 그 행은 0원으로 읽지도, 지갑 전체를 지우지도 않는다.
    mockFetch(envelope({ data: { ...beData, holdings: [{ ...beData.holdings[0], costBasis: { totalCost: "1" } }, beData.holdings[1]] }, meta: { provenance: "live", generatedAt: today() } }, 200));
    const result = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings();
    expect(result.data.holdings.map((holding) => holding.symbol)).toEqual(["USDC"]);
    expect(result.data.droppedCount).toBe(1);
  });

  it("accepts an exponent-form DexScreener price and normalizes it", async () => {
    mockFetch(envelope({ data: { ...beData, holdings: [{ ...beData.holdings[1], priceUsd: "1.2e-9", valueUsd: "0.0000006", priceStatus: "priced" }] }, meta: { provenance: "live", generatedAt: today() } }, 200));
    const result = await new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings();
    expect(result.data.droppedCount).toBe(0);
    expect(result.data.holdings[0].priceUsd).toBe("0.0000000012");
  });

  it("refuses a ledger that reports more than one cost currency (fail closed, never convert only the first)", async () => {
    mockFetch(envelope({ data: { ...beData, holdings: [beData.holdings[0], { ...beData.holdings[1], costBasis: { currency: "EUR", totalCost: "1", avgCost: "1", trackedAmount: "500" } }] }, meta: { provenance: "live", generatedAt: today() } }, 200));
    await expect(new BeHttpHoldingsProvider(cookie, new FixedFxRateProvider(), today).getHoldings()).rejects.toMatchObject({ cause: "invalid_contract" });
  });
});
