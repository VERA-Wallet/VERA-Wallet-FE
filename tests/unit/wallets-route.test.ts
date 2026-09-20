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

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/composition-root.server", () => ({ authStore: store }));

describe("DELETE /api/auth/wallets/[address] (OFF-mode FE route)", () => {
  const WALLET = "0x8A361b90E7F153eEdEb91ef2b2c7Fa4Dd68ceeee";
  const session = { source: "mock", didVerified: true, countryCode: "KR", walletAddress: WALLET, walletVerification: "siwe" };
  const call = async (address: string, cookie = "vw_session=s1") => {
    const { DELETE } = await import("@/app/api/auth/wallets/[address]/route");
    return DELETE(new Request(`http://localhost/api/auth/wallets/${address}`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ address }) });
  };

  it("clears the mock session's wallet claim when the address matches (case-insensitive) and re-issues the cookie", async () => {
    requireDidSession.mockResolvedValue(session);
    store.get.mockResolvedValue({ didVerified: true, countryCode: "KR", walletAddress: WALLET, walletVerification: "siwe", didExpiresAt: 1, walletExpiresAt: 1 });
    const response = await call(WALLET.toLowerCase());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { walletAddress: WALLET, removedTransactions: 0 } });
    expect(store.set).toHaveBeenCalledWith("s1", expect.objectContaining({ walletAddress: null, walletVerification: null, walletExpiresAt: null, didVerified: true }));
    expect(response.headers.get("set-cookie")).toContain("vw_session=s1");
  });

  it("answers 404 for an address the session never registered, without touching the session", async () => {
    requireDidSession.mockResolvedValue(session);
    store.set.mockClear();
    const response = await call("0x0000000000000000000000000000000000000001");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "wallet_not_found" } });
    expect(store.set).not.toHaveBeenCalled();
  });

  it("rejects a malformed address with 400 and an anonymous caller with 401", async () => {
    requireDidSession.mockResolvedValue(session);
    expect((await call("0xnothex")).status).toBe(400);
    requireDidSession.mockResolvedValue(null);
    expect((await call(WALLET)).status).toBe(401);
  });
});
