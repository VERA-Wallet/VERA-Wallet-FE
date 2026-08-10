import { describe, expect, it } from "vitest";
import { POST as presentDid } from "@/app/api/auth/did/present/route";
import { authStore } from "@/lib/composition-root.server";
import { SESSION_COOKIE } from "@/lib/mock/auth-store";
import { isCompletedOnboarding } from "@/lib/dal";
import type { SessionSnapshot } from "@/lib/ports/session-snapshot";
import type { OnboardingSession } from "@/lib/ports/session-store";

function toSnapshot(session: OnboardingSession | null): SessionSnapshot {
  if (!session || !session.didVerified || session.countryCode === null || session.didExpiresAt === null) return { source: "anonymous" };
  return {
    source: "mock",
    didVerified: true,
    countryCode: session.countryCode,
    walletAddress: session.walletAddress,
    chainId: session.chainId,
    didExpiresAt: session.didExpiresAt,
    walletExpiresAt: session.walletExpiresAt,
  };
}


const walletOnly = {
  didVerified: false,
  countryCode: null,
  walletAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  chainId: 1,
  didExpiresAt: null,
  walletExpiresAt: Date.now() + 30 * 60_000,
};

function didRequest(sessionId: string) {
  return new Request("http://localhost/api/auth/did/present", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${sessionId}` },
    body: JSON.stringify({ country: "KR" }),
  });
}

describe("onboarding order enforcement", () => {
  it("rejects a wallet-only session as completed onboarding", () => {
    // wallet-only는 SessionSnapshot에서 표현 불가한 상태라 anonymous로 옮긴다. 불가능한 조합 자체는 invariant 테스트가 고정한다.
    expect(isCompletedOnboarding(toSnapshot(walletOnly))).toBe(false);
  });
  it("does not complete when wallet claims have no wallet expiry", () => {
    const didExpiresAt = Date.now() + 30 * 60_000;
    expect(isCompletedOnboarding(toSnapshot({
      didVerified: true,
      countryCode: "KR",
      walletAddress: walletOnly.walletAddress,
      chainId: 1,
      didExpiresAt,
      walletExpiresAt: null,
    }))).toBe(false);
  });

  it("clears wallet claims when DID is presented after SIWE so reverse order cannot complete", async () => {
    const sessionId = "reverse-order-session";
    await authStore.set(sessionId, { ...walletOnly });
    const response = await presentDid(didRequest(sessionId));
    expect(response.status).toBe(200);

    const merged = await authStore.get(sessionId);
    expect(merged).toMatchObject({ didVerified: true, countryCode: "KR", walletAddress: null, chainId: null, walletExpiresAt: null });
    expect(isCompletedOnboarding(toSnapshot(merged))).toBe(false);
  });

  it("keeps DID claims intact when wallet verification follows DID", async () => {
    const sessionId = "forward-order-session";
    const didExpiresAt = Date.now() + 30 * 60_000;
    await authStore.set(sessionId, { didVerified: true, countryCode: "KR", walletAddress: null, chainId: null, didExpiresAt, walletExpiresAt: null });
    await authStore.set(sessionId, {
      ...(await authStore.get(sessionId))!,
      walletAddress: walletOnly.walletAddress,
      chainId: 1,
      walletExpiresAt: Date.now() + 30 * 60_000,
    });
    expect(isCompletedOnboarding(toSnapshot(await authStore.get(sessionId)))).toBe(true);
  });
});
