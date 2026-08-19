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
import WalletsPage from "@/app/wallets/page";
import HomePage from "@/app/page";
import LoginPage from "@/app/login/page";
import PlanPage from "@/app/plan/page";

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

// destinations 순서: [ConnectWallet, Dashboard, Export, Wallets, Home, Login, Plan].
// Home/Login은 진입 페이지 — 인증된 세션이면 /dashboard로 보내고, 아니면 로그인으로(또는 로그인 렌더).
// Export는 온보딩 완료를 더 이상 강제하지 않는다 — DID-only는 /connect-wallet로 튕기지 않고
// 연결 유도 빈 상태를 그 자리에서 렌더한다(null = 리다이렉트 없음).
// Wallets는 requireDidSession만 요구한다 — DID-only도 "아직 연결된 지갑이 없다"는 정보를 그대로 보여준다.
// Plan도 requireDidSession만 요구한다 — 무엇을 결제하는지 보려고 지갑부터 연결하게 만들지 않는다.
const states: Array<{ name: string; snapshot: SessionSnapshot; destinations: [string | null, string | null, string | null, string | null, string | null, string | null, string | null] }> = [
  { name: "anonymous", snapshot: { source: "anonymous" }, destinations: ["/login", "/login", "/login", "/login", "/login", null, "/login"] },
  { name: "DID only", snapshot: { ...complete, walletAddress: null, chainId: null }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "complete", snapshot: complete, destinations: ["/dashboard", null, null, null, "/dashboard", "/dashboard", null] },
  { name: "expired DID", snapshot: { ...complete, didExpiresAt: now }, destinations: ["/login", "/login", "/login", "/login", "/login", null, "/login"] },
  { name: "expired wallet", snapshot: { ...complete, walletExpiresAt: now }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "BE DID only", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: null, chainId: null }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "BE complete", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: "0x123", chainId: 1 }, destinations: ["/dashboard", null, null, null, "/dashboard", "/dashboard", null] },
];

const pages = [ConnectWalletPage, DashboardPage, ExportPage, WalletsPage, HomePage, LoginPage, PlanPage];

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
