import { afterEach, describe, expect, it, vi } from "vitest";

const requireDidSession = vi.fn();
const getSessionCookieHeaderForEventReader = vi.fn(async () => "vw_access_token=jwt");
vi.mock("@/lib/dal", () => ({ requireDidSession, getSessionCookieHeaderForEventReader }));

const getHoldings = vi.fn();
vi.mock("@/lib/adapters/http/holdings-provider.server", () => ({
  BeHttpHoldingsProvider: class { getHoldings = getHoldings; },
}));

const session = (walletAddress: string | null) => ({ source: "mock", didVerified: true, countryCode: "KR", walletAddress, chainId: null });

afterEach(() => {
  requireDidSession.mockReset();
  getHoldings.mockReset();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function call(query = "") {
  const { GET } = await import("@/app/api/portfolio/holdings/route");
  return GET(new Request(`http://localhost/api/portfolio/holdings${query}`));
}

// resetModules 뒤에는 모듈 레지스트리가 새로 만들어지므로, 라우트가 instanceof로 보는 클래스와 같은 인스턴스를 얻으려면 같은 레지스트리에서 가져온다.
async function errors() {
  const { HoldingsReadError } = await import("@/lib/ports/holdings-provider");
  const { SessionInfrastructureError } = await import("@/lib/ports/session-reader");
  return { HoldingsReadError, SessionInfrastructureError };
}

describe("GET /api/portfolio/holdings (FE-owned route)", () => {
  it("rejects without a DID session (401) and without a bound wallet (404)", async () => {
    requireDidSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    requireDidSession.mockResolvedValue(session(null));
    expect((await call()).status).toBe(404);
  });

  it("OFF 모드: serves the demo wallet under the session's address with provenance mock", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    requireDidSession.mockResolvedValue(session("0xAbC"));
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.provenance).toBe("mock");
    expect(body.data.walletAddresses).toEqual(["0xabc"]);
    expect(body.data.holdings.map((holding: { symbol: string; costStatus: string }) => [holding.symbol, holding.costStatus])).toEqual([["ETH", "ready"], ["USDT", "ready"], ["USDC", "ready"]]);
    expect(body.data.totalValueKrw).toBe("5062500");
    expect(body.data.droppedCount).toBe(0);
    expect(body.data.byWallet).toEqual([{ address: "0xabc", verificationMethod: "siwe", totalValueKrw: "5062500", chainIds: [1, 137, 8453], holdingsCount: 3, unpricedCount: 0 }]);
  });

  it("validates ?address= before any provider runs, and scopes the mock provider to that wallet (404 when unregistered)", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    requireDidSession.mockResolvedValue(session("0x1111111111111111111111111111111111111111"));
    expect((await call("?address=nope")).status).toBe(400);
    const own = await call("?address=0x1111111111111111111111111111111111111111");
    expect(own.status).toBe(200);
    expect((await own.json()).data.byWallet).toHaveLength(1);
    const other = await call("?address=0x2222222222222222222222222222222222222222");
    expect(other.status).toBe(404);
    await expect(other.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("ON 모드: passes the BE provenance through and preserves BE rejections by status and code", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    requireDidSession.mockResolvedValue(session("0xabc"));
    getHoldings.mockResolvedValue({ provenance: "live", data: { walletAddresses: ["0xabc"], holdings: [], skippedChainIds: [], truncatedChainIds: [], unresolvedCount: 0, totalValueKrw: "0", unpricedCount: 0, asOf: "2026-09-11T05:00:00.000Z" } });
    const live = await call();
    expect(live.status).toBe(200);
    expect((await live.json()).meta.provenance).toBe("live");

    const { HoldingsReadError, SessionInfrastructureError } = await errors();
    getHoldings.mockRejectedValue(new HoldingsReadError(503, "service_unavailable", "Balance read observed no chain"));
    const outage = await call();
    expect(outage.status).toBe(503);
    await expect(outage.json()).resolves.toMatchObject({ error: { code: "service_unavailable" } });

    // 뜻을 모르는 BE 상태(게이트웨이 3xx)는 브라우저로 흘리지 않고 502로 접는다.
    getHoldings.mockRejectedValue(new HoldingsReadError(302, "redirect", "moved"));
    expect((await call()).status).toBe(502);

    getHoldings.mockRejectedValue(new SessionInfrastructureError("timeout", "slow"));
    const timeout = await call();
    expect(timeout.status).toBe(502);
    await expect(timeout.json()).resolves.toMatchObject({ error: { code: "upstream_unavailable" } });
  });
});
