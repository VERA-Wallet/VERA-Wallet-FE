import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/dashboard-view";

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify },
  summaryProvider: { getSummary: ports.getSummary },
}));

function renderDashboard() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardView /></QueryClientProvider>);
}

describe("dashboard summary", () => {
  it("shows a dash instead of zero while the summary is loading", () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText("예상 손익").parentElement).toHaveTextContent("—");
    expect(screen.getByText("예상 손익").parentElement).not.toHaveTextContent("₩0");
  });

  it("shows taxable and pending-review counts together", async () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockResolvedValue({ periodPnl: "1250", computableEventCount: 4, taxableEventCount: 4, pendingReviewCount: 2, currency: "KRW", period: { from: "2025-01-01", to: "2025-01-31" } });
    renderDashboard();
    expect(await screen.findByText("4건")).toBeInTheDocument();
    // 판정 결과가 없으면 "과세 대상"이라 단정하지 않으므로 후보 라벨과 유보 문구가 붙는다.
    expect(screen.getByText(/확인 필요 항목 2건/)).toBeInTheDocument();
  });
});
