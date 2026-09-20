import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import type { TaxEstimate } from "@/lib/tax/types";

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
  listRuleSets: vi.fn(),
  estimate: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify },
  summaryProvider: { getSummary: ports.getSummary },
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
}));

function renderDashboard() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardView /></QueryClientProvider>);
}

/** 손익·건수는 세금 화면과 같은 estimate에서 파생한다. 기간 내 판정 4건·gain 합계 1,250을 담은 최소 estimate. */
function estimateWith(period: { from: string; to: string }): TaxEstimate {
  const at = period.from;
  const row = (id: string, amount: string) => ({
    eventId: id, at, asset: "1:native", symbol: "ETH", quantity: "1", amount,
    amountKind: "gain" as const, holdingDays: null, acquiredAt: null, lots: 1,
    leg: "single" as const, inPeriod: true, group: "taxable" as const, label: "과세", basis: "x",
  });
  return {
    country: "KR", countryLabel: "한국", currency: "KRW", taxYear: 2025,
    method: "거주자별 총평균법", status: "PARTIAL",
    lines: [],
    totals: { taxableGains: "1250", exemptGains: "0", incomeTotal: "0", taxableBase: "0", estimatedCharge: "0", effectiveRatePercent: "0" },
    lossCarryforward: "0", notes: [], limitations: [], openQuestions: [], requiredInputs: [],
    excludedEventIds: [], provenance: "mock", period,
    judgments: [row("e1", "500"), row("e2", "500"), row("e3", "250"), row("e4", "0")],
  };
}

describe("dashboard summary", () => {
  it("shows a dash instead of zero while the summary is loading", () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText("예상 손익").parentElement).toHaveTextContent("-");
    expect(screen.getByText("예상 손익").parentElement).not.toHaveTextContent("₩0");
  });

  it("shows taxable and pending-review counts together", async () => {
    const period = { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" };
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockResolvedValue({ periodPnl: "1250", computableEventCount: 4, taxableEventCount: 4, pendingReviewCount: 2, currency: "KRW", period });
    ports.estimate.mockResolvedValue(estimateWith(period));
    renderDashboard();
    // 계산 대상 이벤트 건수는 estimate의 기간 내 고유 판정 이벤트 수(4)에서 파생한다.
    expect(await screen.findByText("4건")).toBeInTheDocument();
    // 판정 결과가 없으면 "과세 대상"이라 단정하지 않으므로 후보 라벨과 유보 문구가 붙는다.
    expect(screen.getByText(/확인 필요 항목 2건/)).toBeInTheDocument();
  });
});
