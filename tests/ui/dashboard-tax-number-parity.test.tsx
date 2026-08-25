import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { TaxYearProvider } from "@/lib/tax/tax-year-context";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { ruleSetListSchema, taxEstimateSchema } from "@/lib/http/tax-dto";
import { estimateConfidence, estimateHeadline } from "@/lib/tax/estimate-summary";
import { formatFiat } from "@/lib/format";
import { isZero, sum } from "@/lib/tax/decimal";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { TaxEstimate } from "@/lib/tax/types";

// 한 해치 목록만 본다 — 다음 해 배치가 열리기 전 시각을 줘 25건만 남긴다.
const SINGLE_YEAR_NOW = new Date(`${FIXTURE_TAX_YEAR + 1}-01-01T00:00:00.000Z`);
const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, SINGLE_YEAR_NOW);
const FIXTURE_PERIOD = { from: events[0].block_timestamp, to: events.at(-1)!.block_timestamp };

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

// 대시보드가 소비하는 estimate와 오라클이 같은 엔진·같은 이벤트를 쓰게 한다.
const engine = new TaxEngineService(() => events);
const defaultEstimate = async (input: TaxEstimateRequest) => taxEstimateSchema.parse(await engine.estimate(input));

function resetPorts() {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1000", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 1,
    currency: "KRW", period: FIXTURE_PERIOD,
  });
  ports.getById.mockResolvedValue({ event: events[0], version: 1, override_history: [] });
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.estimate.mockImplementation(defaultEstimate);
}

resetPorts();
afterEach(resetPorts);

describe("P1-5 화면 간 숫자 통일", () => {
  it("estimateHeadline은 엔진의 손익(원장 gain 합계)과 기간 내 고유 이벤트 수를 그대로 낸다", async () => {
    const estimate = await engine.estimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, source: "wallet" });
    const headline = estimateHeadline(estimate);

    // 손익 = gain 판정 합계 = 엔진이 lot 매칭·총평균으로 낸 실현 손익. 순현금흐름 근사가 아니다.
    const gainSum = sum(estimate.judgments.filter((row) => row.amountKind === "gain").map((row) => row.amount));
    expect(headline.periodPnl).toBe(gainSum);
    // 기간 내 판정이 실제로 존재해야 통일할 대상이 있다.
    expect(headline.computableEventCount).toBeGreaterThan(0);
    // 건수는 기간 내 고유 판정 이벤트 수와 일치한다(부호·건수 불일치 없음의 건수 축).
    const inPeriodEvents = new Set(estimate.judgments.filter((row) => row.inPeriod).map((row) => row.eventId));
    expect(headline.computableEventCount).toBe(inPeriodEvents.size);
  });

  it("대시보드 헤드라인이 같은 귀속연도 estimate 값과 일치한다", async () => {
    const estimate = await engine.estimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, source: "wallet" });
    const headline = estimateHeadline(estimate);

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxYearProvider>
          <DashboardView countryCode="KR" />
        </TaxYearProvider>
      </QueryClientProvider>,
    );

    // 건수 카드가 estimate 파생 건수를 그대로 보인다.
    await waitFor(() =>
      expect(screen.getByText("계산 대상 이벤트").parentElement?.textContent).toContain(
        `${headline.computableEventCount}건`,
      ),
    );
    // 손익 카드가 estimate 파생 손익을 그대로 보인다(0이면 "계산할 거래 없음"으로 갈리므로 그때만 예외).
    if (!isZero(headline.periodPnl)) {
      const pnlCard = screen.getByText("예상 손익").parentElement?.textContent ?? "";
      expect(pnlCard).toContain(formatFiat(headline.periodPnl, estimate.currency));
    }
  });
});

describe("P1-9 대시보드 신뢰도 칩", () => {
  const period = { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" };
  const gainRow = {
    eventId: "g1", at: period.from, asset: "1:native", symbol: "ETH", quantity: "1", amount: "1000",
    amountKind: "gain" as const, holdingDays: null, acquiredAt: null, lots: 1,
    leg: "single" as const, inPeriod: true, group: "taxable" as const, label: "과세", basis: "x",
  };
  // 미반영 2 · 원가0원 1 · 부분집계(PARTIAL)를 담은 estimate. 문구가 아니라 구조에서 칩을 낸다.
  const estimate: TaxEstimate = {
    country: "KR", countryLabel: "한국", currency: "KRW", taxYear: 2025,
    method: "거주자별 총평균법", status: "PARTIAL",
    lines: [],
    totals: { taxableGains: "1000", exemptGains: "0", incomeTotal: "0", taxableBase: "0", estimatedCharge: "0", effectiveRatePercent: "0" },
    lossCarryforward: "0", notes: [],
    limitations: [
      { kind: "zero_basis", message: "z1: 원장에 없는 수량 취득가액 0으로 계산했습니다.", eventIds: ["z1"] },
      { kind: "approximation", message: "근사", eventIds: [] },
    ],
    openQuestions: [], requiredInputs: [], excludedEventIds: ["x1", "x2"], provenance: "mock", period,
    judgments: [gainRow],
  };

  it("칩 건수가 estimate의 미반영·원가0원·부분집계와 일치한다", async () => {
    ports.estimate.mockResolvedValue(estimate);
    const confidence = estimateConfidence(estimate);
    expect(confidence).toEqual({ notReflected: 2, zeroBasis: 1, partial: true });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxYearProvider>
          <DashboardView countryCode="KR" />
        </TaxYearProvider>
      </QueryClientProvider>,
    );

    const chip = await screen.findByLabelText("계산 신뢰도");
    expect(chip.textContent).toContain(`미반영 ${confidence.notReflected}`);
    expect(chip.textContent).toContain(`원가0원 ${confidence.zeroBasis}`);
    expect(chip.textContent).toContain("부분집계");
  });

  it("흔들릴 게 없으면 신뢰도 칩을 달지 않는다", async () => {
    ports.estimate.mockResolvedValue({
      ...estimate,
      status: "CONFIRMED",
      limitations: [],
      excludedEventIds: [],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaxYearProvider>
          <DashboardView countryCode="KR" />
        </TaxYearProvider>
      </QueryClientProvider>,
    );

    // 헤드라인은 떠도(계산 대상 이벤트 건수) 신뢰도 칩은 없어야 한다.
    await screen.findByText("계산 대상 이벤트");
    await waitFor(() => expect(screen.queryByLabelText("계산 신뢰도")).toBeNull());
  });
});
