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
  /**
   * 로딩에는 두 단계가 있고, 이유가 다르다(대시보드 주석 참고):
   * 거래 목록 자체가 아직 없으면 무엇을 셀지조차 모르는 상태라 스켈레톤을 보인다 — "0건"·"-"은
   * 둘 다 "무언가 안다"는 인상을 준다. 거래는 왔고 판정(estimate)만 다시 도는 중이면
   * 옛 값을 최신인 척 단정하지 않으려 "-"를 그대로 쓴다. 이 스위트는 그 둘을 갈라 본다.
   */
  it("이벤트 목록 자체가 로딩 중이면 0건이라 말하지 않고 스켈레톤을 보인다", () => {
    // 어느 것도 정착하지 않는다 — events.isLoading이 계속 true인 순간을 붙잡는다.
    ports.list.mockReturnValue(new Promise(() => {}));
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    // "불러오는 중"이라는 사실은 role="status" 한 줄이 말한다.
    expect(screen.getByRole("status")).toHaveTextContent("거래를 불러오는 중입니다");
    // 모르는 건수를 0이라 말하는 링크·배지가 없어야 한다.
    expect(screen.queryByRole("link", { name: /전체 .*건 보기/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/0건/)).not.toBeInTheDocument();
    // 값 자리는 스켈레톤(장식, aria-hidden)이지 "—"가 아니다 — "—"도 "무언가 안다"는 인상을 준다.
    expect(screen.getByText("예상 손익").parentElement).not.toHaveTextContent("-");
    expect(document.querySelectorAll('[data-surface="recent-transaction-skeleton"]')).toHaveLength(3);
  });

  it("판정만 늦게 도착하면(거래는 왔음) 값 자리는 대시로 남는다", async () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    // 거래 목록이 도착했다는 신호(0건도 이제는 실제 사실이라 링크가 생긴다).
    await screen.findByRole("link", { name: "전체 0건 보기" });
    expect(screen.getByText("예상 손익").parentElement).toHaveTextContent("-");
    expect(screen.getByText("예상 손익").parentElement).not.toHaveTextContent("₩0");
  });

  it("실제로 0건이면 로딩과 구분해 0건이라고 말한다", async () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    const link = await screen.findByRole("link", { name: "전체 0건 보기" });
    expect(link).toHaveAttribute("href", "/transactions");
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
    expect(screen.getByText(/과세 여부는/)).toBeInTheDocument();
    // 요약의 다리 단위 건수(pendingReviewCount)는 화면에 나오지 않는다 — 확인 필요 건수는 행 단위 한 값만 말한다.
    expect(screen.queryByText(/확인 필요 항목/)).not.toBeInTheDocument();
  });
});
