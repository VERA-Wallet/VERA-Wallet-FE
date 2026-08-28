import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("composition-root session reader mode", () => {
  it("uses the raw mock-session cookie path when backend mode is off", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    vi.resetModules();
    const { sessionReader, authStore } = await import("@/lib/composition-root.server");
    const { MockSessionReader } = await import("@/lib/adapters/session/mock-session-reader.server");

    await authStore.set("raw-session", {
      didVerified: true,
      countryCode: "KR",
      walletAddress: "0x123",
      walletVerification: "siwe",
      didExpiresAt: Date.now() + 60_000,
      walletExpiresAt: Date.now() + 60_000,
    });

    expect(sessionReader).toBeInstanceOf(MockSessionReader);
    expect(sessionReader.cookieMode).toBe("raw");
    await expect(sessionReader.read("other=1; vw_session=raw-session; ignored=2")).resolves.toMatchObject({
      source: "mock",
      countryCode: "KR",
    });
  });

  it("uses the access-token-only backend path when backend mode is on", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: { didVerified: true, countryCode: "KR", walletAddress: "0x123", chainId: 1 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { sessionReader } = await import("@/lib/composition-root.server");
    const { BeSessionReader } = await import("@/lib/adapters/session/be-session-reader.server");
    const { resolveCookieHeader } = await import("@/lib/adapters/session/request-cookie.server");

    const cookieHeader = await resolveCookieHeader(new Request("http://localhost", {
      headers: { cookie: "vw_session=secret-session; other=1; vw_access_token=token" },
    }));
    expect(sessionReader).toBeInstanceOf(BeSessionReader);
    expect(sessionReader.cookieMode).toBe("access-token");
    await sessionReader.read(cookieHeader);
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get("cookie")).toBe("vw_access_token=token");
  });

  it("routes the OFF-mode raw cookie through the DAL guard, not just the reader", async () => {
    // 리더를 직접 부르면 DAL이 항상 한 종류의 쿠키 헬퍼만 고르는 회귀를 못 잡는다. 게이트를 통과시켜 확인한다.
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    vi.resetModules();
    const { authStore } = await import("@/lib/composition-root.server");
    const { requireCompletedOnboarding } = await import("@/lib/dal");

    const expiry = Date.now() + 60_000;
    await authStore.set("dal-session", { didVerified: true, countryCode: "KR", walletAddress: "0x123", walletVerification: "siwe", didExpiresAt: expiry, walletExpiresAt: expiry });
    const request = new Request("http://localhost", { headers: { cookie: "other=1; vw_session=dal-session" } });
    await expect(requireCompletedOnboarding(request)).resolves.toMatchObject({ source: "mock", countryCode: "KR" });
  });

  it("routes the ON-mode access token through the DAL guard and forwards only that cookie", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: { didVerified: true, countryCode: "KR", walletAddress: "0x123", chainId: 1 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { requireCompletedOnboarding } = await import("@/lib/dal");

    const request = new Request("http://localhost", { headers: { cookie: "vw_session=secret-session; vw_access_token=token" } });
    await expect(requireCompletedOnboarding(request)).resolves.toMatchObject({ source: "be", countryCode: "KR" });
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get("cookie")).toBe("vw_access_token=token");
  });
});
