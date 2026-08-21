import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaxSimulator } from "@/components/tax/tax-simulator";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { TaxYearProvider, useTaxYear } from "@/lib/tax/tax-year-context";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { taxEstimateSchema, ruleSetListSchema } from "@/lib/http/tax-dto";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
  getById: vi.fn(),
  listRuleSets: vi.fn(),
  estimate: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify, getById: ports.getById },
  summaryProvider: { getSummary: ports.getSummary },
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
}));

const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR);
// 요약 기간은 픽스처와 맞춘다 — 어긋나면 대시보드가 거래 없는 해를 과세연도로 잡는다.
const FIXTURE_PERIOD = { from: events[0].block_timestamp, to: events.at(-1)!.block_timestamp };
const walletEngine = new TaxEngineService(() => events);

const defaultEstimate = async (input: TaxEstimateRequest) =>
  input.source === "wallet"
    ? taxEstimateSchema.parse(await walletEngine.estimate(input))
    : taxEstimateSchema.parse(
        computeTaxEstimate({
          ...input,
          events: createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country)),
        }),
      );

function resetPorts() {
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.estimate.mockImplementation(defaultEstimate);
  ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1000",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    period: FIXTURE_PERIOD,
  });
  ports.getById.mockResolvedValue({ event: events[0], version: 1, override_history: [] });
}

resetPorts();
afterEach(resetPorts);

/** 훅이 실제로 무엇을 공유하는지 보는 최소 소비자. */
function YearProbe({ label, fallback }: { label: string; fallback: number }) {
  const [year, setYear] = useTaxYear(fallback);
  return (
    <button type="button" onClick={() => setYear(year + 1)}>
      {label}:{year}
    </button>
  );
}

describe("전역 귀속연도 단일 소스", () => {
  it("프로바이더 아래의 두 소비자는 한 연도를 공유한다", () => {
    render(
      <TaxYearProvider>
        <YearProbe label="a" fallback={2025} />
        <YearProbe label="b" fallback={2025} />
      </TaxYearProvider>,
    );
    // 아직 아무도 고르지 않았다 — 둘 다 자기 기본값을 쓴다.
    expect(screen.getByText("a:2025")).toBeInTheDocument();
    expect(screen.getByText("b:2025")).toBeInTheDocument();

    // 한 소비자가 바꾸면 다른 소비자도 즉시 같은 연도를 본다(옛 연도 잔존 없음).
    fireEvent.click(screen.getByText("a:2025"));
    expect(screen.getByText("a:2026")).toBeInTheDocument();
    expect(screen.getByText("b:2026")).toBeInTheDocument();
  });

  it("프로바이더가 없으면 소비자는 서로 독립이다(모듈 전역으로 새지 않는다)", () => {
    render(
      <>
        <YearProbe label="a" fallback={2025} />
        <YearProbe label="b" fallback={2025} />
      </>,
    );
    fireEvent.click(screen.getByText("a:2025"));
    // a만 바뀌고 b는 자기 기본값 그대로여야 한다.
    expect(screen.getByText("a:2026")).toBeInTheDocument();
    expect(screen.getByText("b:2025")).toBeInTheDocument();
  });

  it("세금 화면 셀렉터를 바꾸면 대시보드가 같은 귀속연도로 다시 계산한다", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxYearProvider>
          <TaxSimulator currentYear={FIXTURE_TAX_YEAR} />
          <DashboardView />
        </TaxYearProvider>
      </QueryClientProvider>,
    );

    // 대시보드(거주국 KR·지갑 출처)는 처음엔 파생 연도(요약 기간 = 2025)로 판정을 조회한다.
    await waitFor(() =>
      expect(
        ports.estimate.mock.calls.some(
          ([input]) => input.source === "wallet" && input.country === "KR" && input.taxYear === FIXTURE_TAX_YEAR,
        ),
      ).toBe(true),
    );
    // 아직 2022로 조회한 적은 없다 — 파생 연도가 2025이기 때문이다.
    expect(
      ports.estimate.mock.calls.some(([input]) => input.country === "KR" && input.taxYear === 2022),
    ).toBe(false);

    // 세금 화면의 과세연도 셀렉터를 2022로 바꾼다.
    const details = (await screen.findByText("계산 조건 바꾸기")).closest("details")!;
    details.open = true;
    fireEvent.click(within(details).getByRole("button", { name: "2022" }));

    // 대시보드도 같은 소스를 구독하므로 KR/2022로 다시 조회해야 한다(desync 해소).
    await waitFor(() =>
      expect(
        ports.estimate.mock.calls.some(
          ([input]) => input.source === "wallet" && input.country === "KR" && input.taxYear === 2022,
        ),
      ).toBe(true),
    );
  });
});

describe("거주자 전제·잠정 배지", () => {
  async function renderSimulator() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <TaxSimulator currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    return view;
  }

  it("계산 전제(method)를 답 위에 상시 배지로 두고, 확정 룰셋에는 잠정 표기를 붙이지 않는다", async () => {
    await renderSimulator();
    // 독일은 CONFIRMED — 전제 배지는 있고, 잠정 칩은 없다.
    expect(screen.getByTestId("method-premise").textContent).toBe("FIFO (지갑별)");
    expect(screen.queryByTestId("provisional-charge")).not.toBeInTheDocument();
  });

  it("한국(부분확정) 세액 근처에 거주자·총평균 전제와 잠정 표기를 함께 보인다", async () => {
    await renderSimulator();

    fireEvent.click(screen.getByRole("button", { name: /한국/ }));
    await screen.findByText("한국 · 2025");
    const details = screen.getByText("계산 조건 바꾸기").closest("details")!;
    details.open = true;
    fireEvent.click(await screen.findByRole("button", { name: /2027/ }));
    await screen.findByText("한국 · 2027");

    // 전제 배지는 엔진 method에서 파생한다 — 하드코딩이 아니라 "거주자별 총평균법"을 그대로 읽는다.
    const premise = screen.getByTestId("method-premise").textContent ?? "";
    expect(premise).toContain("거주자");
    expect(premise).toContain("총평균법");

    // status PARTIAL이면 단가·부담이 잠정임을 답 옆에 계속 말한다(엔진 note가 근거).
    const provisional = await screen.findByTestId("provisional-charge");
    expect(provisional.textContent).toContain("잠정");

    // 금지 용어("세액")를 배지로 새로 들이지 않는다.
    expect(document.body.textContent ?? "").not.toContain("세액");
  });
});
