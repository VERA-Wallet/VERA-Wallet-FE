import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingSession } from "@/lib/ports/session-store";

const mocks = vi.hoisted(() => ({
  session: null as OnboardingSession | null,
  redirect: vi.fn((destination: string): never => { throw new Error(`redirect:${destination}`); }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => mocks.session ? { value: "test-session" } : undefined,
  })),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/lib/composition-root.server", () => ({
  authStore: { get: vi.fn(async () => mocks.session) },
}));

import ConnectWalletPage from "@/app/connect-wallet/page";
import DashboardPage from "@/app/dashboard/page";
import ExportPage from "@/app/export/page";
import { isCompletedOnboarding } from "@/lib/dal";

const now = Date.now();
const complete: OnboardingSession = {
  didVerified: true,
  countryCode: "US",
  walletAddress: "0x123",
  chainId: 1,
  didExpiresAt: now + 60_000,
  walletExpiresAt: now + 60_000,
};

const states: Array<{ name: string; session: OnboardingSession | null; destinations: [string | null, string | null, string | null] }> = [
  { name: "anonymous", session: null, destinations: ["/login", "/login", "/login"] },
  { name: "DID only", session: { ...complete, walletAddress: null, chainId: null, walletExpiresAt: null }, destinations: [null, "/connect-wallet", "/connect-wallet"] },
  { name: "complete", session: complete, destinations: ["/dashboard", null, null] },
  { name: "expired DID", session: { ...complete, didExpiresAt: now - 1 }, destinations: ["/login", "/login", "/login"] },
  { name: "expired wallet", session: { ...complete, walletExpiresAt: now - 1 }, destinations: [null, "/connect-wallet", "/connect-wallet"] },
];

const pages = [ConnectWalletPage, DashboardPage, ExportPage];

async function expectDestination(page: () => Promise<unknown>, destination: string | null) {
  mocks.redirect.mockClear();
  if (destination === null) {
    await expect(page()).resolves.toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
    return;
  }

  await expect(page()).rejects.toThrow(`redirect:${destination}`);
  expect(mocks.redirect).toHaveBeenCalledWith(destination);
}

describe("onboarding page guards", () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
  });

  for (const state of states) {
    it(`routes ${state.name} sessions through each onboarding step`, async () => {
      mocks.session = state.session;
      for (const [index, page] of pages.entries()) await expectDestination(page, state.destinations[index]!);
    });
  }

  it("does not treat a wallet-only session as completed onboarding", () => {
    expect(isCompletedOnboarding({ ...complete, didVerified: false, countryCode: null }, now)).toBe(false);
  });
});
