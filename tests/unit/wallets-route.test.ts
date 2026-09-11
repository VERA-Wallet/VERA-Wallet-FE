import { afterEach, describe, expect, it, vi } from "vitest";

const requireDidSession = vi.fn();
vi.mock("@/lib/dal", () => ({ requireDidSession }));

afterEach(() => { requireDidSession.mockReset(); vi.resetModules(); });

describe("GET /api/auth/wallets (OFF-mode FE route)", () => {
  it("lists the mock session's wallet with its verification method, or none", async () => {
    const { GET } = await import("@/app/api/auth/wallets/route");
    requireDidSession.mockResolvedValue({ source: "mock", didVerified: true, countryCode: "KR", walletAddress: "0x1111111111111111111111111111111111111111", walletVerification: "watch_only" });
    const body = await (await GET(new Request("http://localhost/api/auth/wallets"))).json();
    expect(body.data.wallets).toHaveLength(1);
    expect(body.data.wallets[0]).toMatchObject({ walletAddress: "0x1111111111111111111111111111111111111111", verificationMethod: "watch_only" });

    requireDidSession.mockResolvedValue({ source: "mock", didVerified: true, countryCode: "KR", walletAddress: null });
    expect((await (await GET(new Request("http://localhost/api/auth/wallets"))).json()).data.wallets).toEqual([]);

    requireDidSession.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/auth/wallets"))).status).toBe(401);
  });
});
