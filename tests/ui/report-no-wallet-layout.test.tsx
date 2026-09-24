import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/dal", () => ({
  requireCompletedOnboarding: vi.fn(async () => null),
  requireDidSession: vi.fn(async () => ({ countryCode: "KR", walletAddress: null })),
  getSessionCookieHeaderForEventReader: vi.fn(),
}));
vi.mock("@/lib/composition-root.server", () => ({ summaryProvider: {} }));
vi.mock("@/lib/adapters/http/event-repository.server", () => ({ warmUpBeEventSync: vi.fn() }));
vi.mock("@/components/report/report-context", () => ({
  ReportInputsProvider: () => { throw new Error("No-wallet page must not start the tax calculator"); },
}));
import ExportLayout from "@/app/export/layout";
it("shows wallet connection instead of a synthetic report for a DID-only account", async () => {
  render(await ExportLayout({ children: <div>예상 부담 추정 ₩1,480,518</div> }));
  expect(screen.getByRole("link", { name: "지갑 연결하기" })).toHaveAttribute("href", "/connect-wallet");
  expect(screen.queryByText(/1,480,518/)).not.toBeInTheDocument();
});
