import "server-only";

import { cookies } from "next/headers";

import { authStore } from "@/lib/composition-root.server";
import { SESSION_COOKIE } from "@/lib/mock/auth-store";
import type { OnboardingSession } from "@/lib/ports/session-store";

export type CompletedOnboardingSession = OnboardingSession & {
  didVerified: true;
  countryCode: string;
  walletAddress: string;
  chainId: number;
  didExpiresAt: number;
  walletExpiresAt: number;
};

export function isDidVerified(session: OnboardingSession | null, now = Date.now()): session is OnboardingSession & {
  didVerified: true;
  countryCode: string;
  didExpiresAt: number;
} {
  return !!session && session.didVerified === true && session.countryCode !== null &&
    session.didExpiresAt !== null && now < session.didExpiresAt;
}

async function getSession(request?: Request): Promise<OnboardingSession | null> {
  const sessionId = request
    ? request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1]
    : (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionId ? authStore.get(sessionId) : null;
}

export function isCompletedOnboarding(session: OnboardingSession | null, now = Date.now()): session is CompletedOnboardingSession {
  return !!session && session.didVerified === true && session.countryCode !== null && session.walletAddress !== null &&
    session.chainId !== null && session.didExpiresAt !== null && session.walletExpiresAt !== null &&
    now < session.didExpiresAt && now < session.walletExpiresAt;
}

export async function requireDidSession(request?: Request): Promise<OnboardingSession | null> {
  const session = await getSession(request);
  return isDidVerified(session) ? session : null;
}

export async function requireCompletedOnboarding(request?: Request): Promise<CompletedOnboardingSession | null> {
  const session = await getSession(request);
  return isCompletedOnboarding(session) ? session : null;
}
