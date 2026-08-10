import "server-only";

import { cache } from "react";

import { resolveCookieHeader, resolveRawCookieHeader } from "@/lib/adapters/session/request-cookie.server";
import { sessionReader } from "@/lib/composition-root.server";
import type { SessionSnapshot } from "@/lib/ports/session-snapshot";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

type DidVerifiedSession = Exclude<SessionSnapshot, { source: "anonymous" }>;

export type CompletedOnboardingSession = DidVerifiedSession & {
  walletAddress: string;
  chainId: number;
};

// 보호 페이지가 requireCompletedOnboarding() 실패 시 requireDidSession()을 다시 부르므로 그대로 두면 렌더당 BE 왕복이 2회다.
// cache()는 같은 렌더 트리 안에서만 메모이즈되고 요청 간에는 공유되지 않아 사용자 간 오염이 없다.
// 신선도는 beFetch의 cache: "no-store"가 담당한다.
const getSessionSnapshot = cache(async (request?: Request): Promise<SessionSnapshot> => {
  // 리더가 요구하는 쿠키만 넘긴다. BE 리더에겐 vw_access_token 하나만, mock 리더에겐 vw_session이 든 헤더 전문.
  // 한쪽으로 통일하면 OFF 모드에서 vw_session이 버려져 세션이 영원히 익명이 되거나, raw 헤더가 BE로 새어나간다.
  const cookieHeader = sessionReader.cookieMode === "access-token"
    ? await resolveCookieHeader(request)
    : await resolveRawCookieHeader(request);
  try {
    return await sessionReader.read(cookieHeader);
  } catch (error) {
    if (error instanceof SessionInfrastructureError) Object.assign(error, { digest: "VW_BACKEND_UNAVAILABLE" });
    throw error;
  }
});

export function isDidVerified(snapshot: SessionSnapshot, now = Date.now()): snapshot is DidVerifiedSession {
  switch (snapshot.source) {
    case "anonymous":
      return false;
    case "be":
      return snapshot.countryCode !== null;
    case "mock":
      return now < snapshot.didExpiresAt;
    default: {
      const _exhaustive: never = snapshot;
      return _exhaustive;
    }
  }
}

export function isCompletedOnboarding(snapshot: SessionSnapshot, now = Date.now()): snapshot is CompletedOnboardingSession {
  if (!isDidVerified(snapshot, now) || snapshot.walletAddress === null || snapshot.chainId === null) return false;
  // mock 세션은 지갑 클레임이 생길 때 만료 타임스탬프도 함께 기록된다. null이면 지갑 단계가 끝나지 않은 것이므로 완료가 아니다.
  if (snapshot.source === "mock") return snapshot.walletExpiresAt !== null && now < snapshot.walletExpiresAt;
  return true;
}

export async function requireDidSession(request?: Request): Promise<DidVerifiedSession | null> {
  const snapshot = await getSessionSnapshot(request);
  return isDidVerified(snapshot) ? snapshot : null;
}

export async function requireCompletedOnboarding(request?: Request): Promise<CompletedOnboardingSession | null> {
  const snapshot = await getSessionSnapshot(request);
  return isCompletedOnboarding(snapshot) ? snapshot : null;
}

// BE 이벤트 스냅샷 리더가 같은 요청의 쿠키를 BE로 전달할 때 쓴다.
// 목적지가 BE이므로 mock 모드의 raw 헤더가 아니라 항상 access-token 하나만 돌려준다.
export async function getSessionCookieHeaderForEventReader(request?: Request): Promise<string | undefined> {
  return resolveCookieHeader(request);
}
