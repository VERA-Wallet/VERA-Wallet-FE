import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@/lib/ports/session-snapshot";

const mocks = vi.hoisted(() => ({
  snapshot: { source: "anonymous" } as SessionSnapshot,
  redirect: vi.fn((destination: string): never => { throw new Error(`redirect:${destination}`); }),
  read: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/lib/composition-root.server", () => ({
  sessionReader: { cookieMode: "access-token", read: mocks.read },
}));

import ConnectWalletPage from "@/app/connect-wallet/page";
import DashboardPage from "@/app/dashboard/page";
import ExportPage from "@/app/export/page";

const now = Date.now();
const complete = {
  source: "mock" as const,
  didVerified: true as const,
  countryCode: "US",
  walletAddress: "0x123",
  chainId: 1,
  didExpiresAt: now + 60_000,
  walletExpiresAt: now + 60_000,
};

const states: Array<{ name: string; snapshot: SessionSnapshot; destinations: [string | null, string | null, string | null] }> = [
  { name: "anonymous", snapshot: { source: "anonymous" }, destinations: ["/login", "/login", "/login"] },
  { name: "DID only", snapshot: { ...complete, walletAddress: null, chainId: null }, destinations: [null, "/connect-wallet", "/connect-wallet"] },
  { name: "complete", snapshot: complete, destinations: ["/dashboard", null, null] },
  { name: "expired DID", snapshot: { ...complete, didExpiresAt: now }, destinations: ["/login", "/login", "/login"] },
  { name: "expired wallet", snapshot: { ...complete, walletExpiresAt: now }, destinations: [null, "/connect-wallet", "/connect-wallet"] },
  { name: "BE DID only", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: null, chainId: null }, destinations: [null, "/connect-wallet", "/connect-wallet"] },
  { name: "BE complete", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: "0x123", chainId: 1 }, destinations: ["/dashboard", null, null] },
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
    mocks.read.mockImplementation(async () => mocks.snapshot);
  });

  for (const state of states) {
    it(`routes ${state.name} sessions through each onboarding step`, async () => {
      mocks.snapshot = state.snapshot;
      for (const [index, page] of pages.entries()) await expectDestination(page, state.destinations[index]!);
    });
  }
});
