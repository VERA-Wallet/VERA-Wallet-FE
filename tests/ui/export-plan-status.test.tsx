import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planDefinition, type Plan } from "@/lib/plan/use-plan";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEstimate } from "@/lib/tax/types";

// 구독 상태 카드·과세연도별 결제 카드만 본다. 잠금 판정(export-plan-lock.test.tsx)과
// estimate 배선(export-report.test.tsx)은 이미 다른 테스트가 덮으므로 여기서 다시 보지 않는다.
const state = vi.hoisted(() => ({ plan: null as Plan | null }));
const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
}));

vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: state.plan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ReportView } from "@/components/report/report-view";

const estimate: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2026,
  method: "거주자별 총평균법",
  status: "PARTIAL",
  lines: [
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: { taxableGains: "833333.33", exemptGains: "0", incomeTotal: "0", taxableBase: "833333.33", estimatedCharge: "183333.34", effectiveRatePercent: "5.5" },
  lossCarryforward: "0",
  notes: [],
  limitations: [],
  openQuestions: [],
  requiredInputs: [],
  excludedEventIds: [],
  provenance: "mock",
  period: { from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "disp",
      at: "2026-06-01T00:00:00.000Z",
      asset: "1:native",
      symbol: "ETH",
      quantity: "1",
      amount: "3000000",
      amountKind: "gain",
      holdingDays: null,
      acquiredAt: null,
      lots: 1,
      leg: "single",
      inPeriod: true,
      group: "taxable",
      label: "과세 · 기타소득 20%",
      basis: "소득세법 제64조의3제2항",
      breakdown: { proceeds: "5000000", cost: "2000000", fee: "0" },
    },
  ],
};

function summaryWith(computableEventCount: number, periodStartYear = 2026) {
  return {
    periodPnl: "0",
    computableEventCount,
    taxableEventCount: computableEventCount,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: `${periodStartYear}-01-01T00:00:00.000Z`, to: `${periodStartYear}-03-01T00:00:00.000Z` },
  };
}

const plusPlan: Plan = { tier: "plus", taxYear: 2026, activatedAt: "2026-08-19T00:00:00.000Z" };

function renderWith(computableEventCount: number, plan: Plan | null, periodStartYear = 2026) {
  state.plan = plan;
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summaryWith(computableEventCount, periodStartYear));
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
  // 진입 귀속연도는 이제 서버가 파생해 prop으로 내려준다(`app/export/page.tsx`의 latestActivityTaxYear).
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReportView countryCode="KR" currentYear={2026} latestActivityYear={periodStartYear} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockReset();
  state.plan = null;
});

describe("리포트 구독 상태 카드", () => {
  it("구독 중이면 플랜·귀속연도·사용량 게이지를 보여준다", async () => {
    renderWith(250, plusPlan);

    const card = await screen.findByText("플러스 플랜 · 2026년 귀속");
    expect(card.closest("[data-surface='plan-status']")).toBeInTheDocument();
    expect(screen.getByText("1,000건 중 250건 사용")).toBeInTheDocument();
    expect(screen.getByText("과세연도당 한 번 결제")).toBeInTheDocument();

    const gauge = screen.getByRole("progressbar", { name: "내보내기 사용량" });
    expect(gauge).toHaveAttribute("aria-valuemin", "0");
    expect(gauge).toHaveAttribute("aria-valuemax", "100");
    expect(gauge).toHaveAttribute("aria-valuenow", "25");
  });

  it("한도를 넘으면 게이지는 100%에서 멈춘다 — 초과 사실은 기존 한도 문구가 말한다", async () => {
    renderWith(planDefinition("plus").exportLimit + 1, plusPlan);

    await screen.findByText("플러스 플랜 · 2026년 귀속");
    const gauge = screen.getByRole("progressbar", { name: "내보내기 사용량" });
    expect(gauge).toHaveAttribute("aria-valuenow", "100");
  });

  it("미구독이면 구독 상태 카드와 과세연도별 결제 섹션을 그리지 않는다", async () => {
    const { container } = renderWith(50, null);

    await waitFor(() => expect(ports.getSummary).toHaveBeenCalled());
    // 미구독이어도 계산은 보인다 — 없는 것은 결제 관련 두 카드뿐이다.
    await screen.findByText("기타소득 계산");
    expect(container.querySelector("[data-surface='plan-status']")).toBeNull();
    expect(container.querySelector("[data-surface='plan-payments']")).toBeNull();
  });

  it("요약을 아직 못 읽었으면 구독 상태 카드의 건수·게이지는 그리지 않는다 — 근거 없는 숫자는 없다", () => {
    state.plan = plusPlan;
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getProof.mockResolvedValue(null);
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReportView countryCode="KR" currentYear={2026} latestActivityYear={2026} />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("progressbar", { name: "내보내기 사용량" })).toBeNull();
    expect(screen.queryByText(/건 중 .*건 사용/)).toBeNull();
  });

  it("보는 연도가 활성 플랜 연도와 다르면 사실만 한 줄 보여준다", async () => {
    // 진입 귀속연도(2027)와 활성 플랜(2026년 귀속)이 서로 갈린다.
    renderWith(10, plusPlan, 2027);

    await screen.findByText("플러스 플랜 · 2026년 귀속");
    expect(screen.getByText("활성 플랜은 2026년 귀속입니다 — 지금 보는 연도는 2027년")).toBeInTheDocument();
  });

  it("보는 연도가 활성 플랜 연도와 같으면 불일치 문구를 보이지 않는다", async () => {
    renderWith(10, plusPlan, 2026);

    await screen.findByText("플러스 플랜 · 2026년 귀속");
    expect(screen.queryByText(/지금 보는 연도는/)).toBeNull();
  });

  it("과세연도별 결제 섹션은 활성 플랜 1행만 실데이터로 보여준다", async () => {
    renderWith(10, plusPlan);

    expect(await screen.findByText("과세연도별 결제")).toBeInTheDocument();
    expect(screen.getByText("2026년 귀속 · 플러스 플랜 · 활성화 2026. 8. 19.")).toBeInTheDocument();
    expect(screen.getByText(/지난 연도 결제 이력과 내보내기 스냅샷 보관은 아직 제공하지 않습니다/)).toBeInTheDocument();
  });
});
