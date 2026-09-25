import { expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ warmup: vi.fn(), ledger: vi.fn(), summary: vi.fn() }));
vi.mock("@/lib/dal", () => ({
  requireDidSession: async () => ({ countryCode: "KR", walletAddress: "0x123" }),
  requireCompletedOnboarding: async () => ({ countryCode: "KR", walletAddress: "0x123" }),
  getSessionCookieHeaderForEventReader: async () => "session",
}));
vi.mock("@/lib/adapters/http/event-repository.server", () => ({ warmUpBeEventSync: ports.warmup, readBeWalletEvents: ports.ledger }));
vi.mock("@/lib/composition-root.server", () => ({ summaryProvider: { getSummary: ports.summary } }));
vi.mock("@/lib/api-mode", () => ({ apiProvenance: async () => "live", isMockApiMode: () => false, reportAnchorGateEnabled: () => true }));
import Dashboard from "@/app/dashboard/page";
import Transactions from "@/app/transactions/page";
import Wallets from "@/app/wallets/page";
import Settings from "@/app/settings/page";
import ExportLayout from "@/app/export/layout";
it("renders tab entry points after session checks without scanning the ledger on the server", async () => {
  await Promise.all([Dashboard(), Transactions(), Wallets(), Settings(), ExportLayout({ children: null })]);
  expect(ports.warmup).not.toHaveBeenCalled();
  expect(ports.ledger).not.toHaveBeenCalled();
  expect(ports.summary).not.toHaveBeenCalled();
});
