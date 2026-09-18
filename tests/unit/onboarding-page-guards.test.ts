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
// `/export`(리포트)는 완료 세션에서 진입 귀속연도를 서버에서 파생한다(`latestActivityTaxYear`).
// 그 편의값 때문에 가드 계약 테스트가 깨지지 않도록 요약 포트도 함께 세운다 — 목적지 판정은 그대로다.
vi.mock("@/lib/composition-root.server", () => ({
  sessionReader: { cookieMode: "access-token", read: mocks.read },
  summaryProvider: {
    getSummary: async () => ({ period: { from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" } }),
  },
}));

import ConnectWalletPage from "@/app/connect-wallet/page";
import DashboardPage from "@/app/dashboard/page";
// 리포트는 다섯 화면이 됐고, 세션 가드는 그 전부를 덮는 layout 하나로 올라갔다.
// 그래서 계약도 layout을 세운다 — page를 세우면 하위 경로(`/export/settings` 등)의 가드는 검증되지 않는다.
import ExportLayout from "@/app/export/layout";
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
// Export(리포트)는 온보딩 완료를 더 이상 강제하지 않는다 — DID-only는 /connect-wallet로 튕기지 않고
// 데모 시나리오 계산을 그 자리에서 렌더한다(null = 리다이렉트 없음). 내려받기만 "지갑 연결 필요"다.
// Wallets는 requireDidSession만 요구한다 — DID-only도 "아직 연결된 지갑이 없다"는 정보를 그대로 보여준다.
// Plan도 requireDidSession만 요구한다 — 무엇을 결제하는지 보려고 지갑부터 연결하게 만들지 않는다.
// ConnectWallet도 requireDidSession만 요구한다 — 지갑 등록은 기존 지갑에 더해지는 것이라 이미 지갑이 있는
// 세션도 들어와야 한다. 완료 세션을 /dashboard로 튕기면 두 번째 지갑을 등록할 길 자체가 사라진다.
const states: Array<{ name: string; snapshot: SessionSnapshot; destinations: [string | null, string | null, string | null, string | null, string | null, string | null, string | null] }> = [
  { name: "anonymous", snapshot: { source: "anonymous" }, destinations: ["/login", "/login", "/login", "/login", "/login", null, "/login"] },
  { name: "DID only", snapshot: { ...complete, walletAddress: null }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "complete", snapshot: complete, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "expired DID", snapshot: { ...complete, didExpiresAt: now }, destinations: ["/login", "/login", "/login", "/login", "/login", null, "/login"] },
  { name: "expired wallet", snapshot: { ...complete, walletExpiresAt: now }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "BE DID only", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: null }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
  { name: "BE complete", snapshot: { source: "be", didVerified: true, countryCode: "US", walletAddress: "0x123" }, destinations: [null, null, null, null, "/dashboard", "/dashboard", null] },
];

// layout은 children을 받는다. 가드는 children을 보기 전에 끝나므로 빈 children으로 세운다.
const exportEntry = () => ExportLayout({ children: null });
const pages = [ConnectWalletPage, DashboardPage, exportEntry, WalletsPage, HomePage, LoginPage, PlanPage];

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
