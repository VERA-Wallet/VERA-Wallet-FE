import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEstimate } from "@/lib/tax/types";
import { TaxYearProvider, useTaxYear } from "@/lib/tax/tax-year-context";

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  getProof: vi.fn(),
  estimate: vi.fn(),
  listRuleSets: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
}));

vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  const plusPlan = { tier: "plus" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" };
  return { ...actual, usePlan: () => ({ plan: plusPlan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ReportPages } from "@/tests/ui/helpers/report-pages";

// 데이터(요약 기간)는 2025년이라 진입 귀속연도 = 2025. 시행연도(2027)는 룰셋에서 온다.
function estimateFor(taxYear: number, assumeEffective = false): TaxEstimate {
  // 시행 후(2027~) 또는 "시행 가정"을 켠 시행 전 연도는 실제 총평균 값을 낸다.
  const effective = taxYear >= 2027 || assumeEffective;
  const scheduled = !effective;
  return {
    country: "KR",
    countryLabel: "한국",
    currency: "KRW",
    taxYear,
    method: assumeEffective && taxYear < 2027 ? "거주자별 총평균법 · 2027 시행 가정" : "거주자별 총평균법",
    status: scheduled ? "SCHEDULED" : "PARTIAL",
    lines: [
      { key: "income_tax", label: "소득세", amount: scheduled ? "0" : "166666.67", rate: "20%" },
      { key: "local_tax", label: "개인지방소득세", amount: scheduled ? "0" : "16666.67" },
    ],
    totals: {
      taxableGains: scheduled ? "0" : "833333.33",
      exemptGains: "0",
      incomeTotal: "0",
      taxableBase: scheduled ? "0" : "833333.33",
      estimatedCharge: scheduled ? "0" : "183333.34",
      effectiveRatePercent: scheduled ? "0" : "5.5",
    },
    lossCarryforward: "0",
    notes: [],
    limitations: [],
    openQuestions: [],
    requiredInputs: [],
    excludedEventIds: [],
    provenance: "mock",
    period: { from: `${taxYear}-01-01T00:00:00.000Z`, to: `${taxYear + 1}-01-01T00:00:00.000Z` },
    judgments: [
      {
        eventId: "disp",
        at: `${taxYear}-06-01T00:00:00.000Z`,
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
}

// 데이터가 있는 해는 2025다 — 서버가 그 해를 진입 귀속연도로 내려준다.
const summary = {
  periodPnl: "3000000",
  computableEventCount: 1,
  taxableEventCount: 1,
  pendingReviewCount: 0,
  currency: "KRW",
  period: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
};

function renderReport() {
  // 귀속연도 칩과 시행 가정 배너는 메인 화면의 것이다.
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReportPages pages={["main"]} countryCode="KR" currentYear={2025} latestActivityYear={2025} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockImplementation(async (input: { taxYear: number; assumeEffective?: boolean }) =>
    estimateFor(input.taxYear, input.assumeEffective ?? false),
  );
  // 룰셋이 시행연도(2027)를 선언한다 — 화면이 하드코딩하지 않고 여기서 받는다.
  ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
});

/** 전역 소스가 실제로 공유되는지 보는 최소 소비자. */
function YearProbe() {
  const [year] = useTaxYear(0);
  return <div data-testid="probe">probe:{year}</div>;
}

describe("리포트 귀속연도 선택기", () => {
  it("귀속연도 칩을 탭하면 연도 목록(시행연도 2027 포함)이 열린다", async () => {
    renderReport();

    // 처음엔 데이터 연도(2025)를 귀속연도로 요청한다.
    await waitFor(() => expect(ports.estimate).toHaveBeenCalledWith(expect.objectContaining({ country: "KR", taxYear: 2025, source: "wallet" })));
    const chip = await screen.findByRole("button", { name: /2025년 귀속/ });

    fireEvent.click(chip);

    // 바텀시트가 열리고, 시행연도(2027)가 후보에 있어야 시행 후 계산을 볼 수 있다.
    const dialog = await screen.findByRole("dialog", { name: "귀속연도 선택" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /2027년 귀속/ })).toBeInTheDocument();
  });

  it("연도를 바꾸면 그 연도로 estimate를 재요청하고 시행 후 계산을 노출한다", async () => {
    renderReport();
    const chip = await screen.findByRole("button", { name: /2025년 귀속/ });

    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole("button", { name: /2027년 귀속/ }));

    // 선택 연도(2027)로 estimate를 다시 부른다 — 시행 후 계산이라 가정이 실리지 않는다.
    await waitFor(() =>
      expect(ports.estimate).toHaveBeenCalledWith({
        country: "KR",
        taxYear: 2027,
        source: "wallet",
        profile: expect.anything(),
      }),
    );
    // 헤더 칩도 선택 연도를 따른다.
    expect(await screen.findByRole("button", { name: /2027년 귀속/ })).toBeInTheDocument();
    // 시행 후(PARTIAL) 계산이 리포트에 실린다 — 예상 부담 실제값.
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toContain("₩183,333.34"));
    // 시행 후를 보는 중에는 "가정"이 성립하지 않으므로 배너도 없다.
    expect(document.querySelector("[data-surface='assume-effective']")).toBeNull();
  });

  it("시행 예정 룰셋의 시행 전 연도는 시행 가정을 켠 채로 열고, 끄면 사실로 돌아간다", async () => {
    renderReport();

    // 시행 전(2025)이어도 첫 요청부터 assumeEffective가 실린다(2026-09-17 사용자 결정).
    await waitFor(() =>
      expect(ports.estimate).toHaveBeenCalledWith(
        expect.objectContaining({ country: "KR", taxYear: 2025, source: "wallet", assumeEffective: true }),
      ),
    );
    // 가정임을 배너로 계속 말하고, 총평균 실제 부담(=시행 후 계산값)이 리포트에 실린다.
    expect(await screen.findByText(/시행 가정으로 보는 중입니다/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toContain("₩183,333.34"));
    // 시행 전이라는 사실은 지워지지 않고 접힘 안에 남는다.
    expect(screen.getByText("시행 전인 지금 실제 부담은")).toBeInTheDocument();

    // 끄면 사실(시행 전)로 돌아간다 — 같은 연도를 가정 없이 재요청한다.
    fireEvent.click(screen.getByRole("button", { name: "가정 끄기" }));
    await waitFor(() =>
      expect(ports.estimate).toHaveBeenCalledWith({
        country: "KR",
        taxYear: 2025,
        source: "wallet",
        profile: expect.anything(),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toBe("과세 대상 아님"));
    expect(screen.getByRole("button", { name: "시행 가정으로 보기" })).toBeInTheDocument();
  });

  it("선택 연도를 전역 소스에 써서 요약·거래 화면과 같은 소스를 공유한다", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxYearProvider>
          <ReportPages pages={["main"]} countryCode="KR" currentYear={2025} latestActivityYear={2025} />
          <YearProbe />
        </TaxYearProvider>
      </QueryClientProvider>,
    );

    // 아직 아무도 고르지 않았다 — fallback은 소비자별이라 전역으로 새지 않는다(probe는 자기 기본값 0).
    await screen.findByRole("button", { name: /2025년 귀속/ });
    expect(screen.getByTestId("probe").textContent).toBe("probe:0");

    fireEvent.click(await screen.findByRole("button", { name: /2025년 귀속/ }));
    fireEvent.click(await screen.findByRole("button", { name: /2027년 귀속/ }));

    // 리포트에서 고른 연도는 전역 소스에 써져, 별개 소비자(=요약·거래 화면 대역)도 즉시 본다.
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("probe:2027"));
  });
});
