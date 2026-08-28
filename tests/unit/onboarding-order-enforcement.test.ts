import { describe, expect, it } from "vitest";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
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
    didExpiresAt: session.didExpiresAt,
    walletExpiresAt: session.walletExpiresAt,
  };
}


const walletOnly = {
  didVerified: false,
  countryCode: null,
  walletAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  walletVerification: "siwe" as const,
  didExpiresAt: null,
  walletExpiresAt: Date.now() + 30 * 60_000,
};


function nonceRequest(sessionId?: string) {
  return new Request("http://localhost/api/auth/nonce", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionId ? { cookie: `${SESSION_COOKIE}=${sessionId}` } : {}),
    },
    body: JSON.stringify({ chainId: 1, domain: "wallet.example", uri: "https://wallet.example" }),
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
      walletVerification: "siwe" as const,
      didExpiresAt,
      walletExpiresAt: null,
    }))).toBe(false);
  });

  it("cannot create a wallet-only session through nonce or verify APIs", async () => {
    const sessionId = "reverse-order-session";
    // 직접 스토어 시드는 API 밖 상태를 재현하기 위한 것이며, 실제 API가 wallet-only 세션을 만들 수 있다는 뜻이 아니다.
    await authStore.set(sessionId, { ...walletOnly });

    const nonceResponse = await nonce(nonceRequest(sessionId));
    expect(nonceResponse.status).toBe(401);
    await expect(nonceResponse.json()).resolves.toMatchObject({ error: { code: "unauthorized", message: "Unauthorized" } });

    const cookieLessVerify = await verify(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(cookieLessVerify.status).toBe(401);
    await expect(cookieLessVerify.json()).resolves.toMatchObject({ error: { code: "unauthorized", message: "Unauthorized" } });

    const walletOnlyVerify = await verify(new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
      body: JSON.stringify({}),
    }));
    expect(walletOnlyVerify.status).toBe(401);
    await expect(walletOnlyVerify.json()).resolves.toMatchObject({ error: { code: "unauthorized", message: "Unauthorized" } });
    expect(await authStore.get(sessionId)).toEqual(walletOnly);
  });

  it("guards nonce issuance for sessions without DID claims", async () => {
    // 순서 강제가 present의 클레임 초기화에서 nonce 가드로 이동했다.
    const anonymous = await nonce(nonceRequest());
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ error: { code: "unauthorized", message: "Unauthorized" } });

    const sessionId = "wallet-only-nonce-session";
    await authStore.set(sessionId, { ...walletOnly });
    const walletOnlyResponse = await nonce(nonceRequest(sessionId));
    expect(walletOnlyResponse.status).toBe(401);
    await expect(walletOnlyResponse.json()).resolves.toMatchObject({ error: { code: "unauthorized", message: "Unauthorized" } });
  });

  // 직접 스토어 시드는 API 밖 상태를 재현하기 위한 것이다.
  it("keeps DID claims intact when wallet verification follows DID", async () => {
    const sessionId = "forward-order-session";
    const didExpiresAt = Date.now() + 30 * 60_000;
    await authStore.set(sessionId, { didVerified: true, countryCode: "KR", walletAddress: null, walletVerification: null, didExpiresAt, walletExpiresAt: null });
    await authStore.set(sessionId, {
      ...(await authStore.get(sessionId))!,
      walletAddress: walletOnly.walletAddress,
      walletExpiresAt: Date.now() + 30 * 60_000,
    });
    expect(isCompletedOnboarding(toSnapshot(await authStore.get(sessionId)))).toBe(true);
  });
});
