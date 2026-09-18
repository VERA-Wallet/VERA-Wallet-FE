import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportView } from "@/components/report/report-view";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { ruleSetListSchema, taxEstimateSchema } from "@/lib/http/tax-dto";
import type { TaxEstimate } from "@/lib/tax/types";
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

// 시나리오 출처는 computeTaxEstimate가 직접 계산한다 — deemedFmv를 그대로 소비하므로 재계산이 진짜 반영된다.
const scenarioEstimate = (input: TaxEstimateRequest) =>
  taxEstimateSchema.parse(
    computeTaxEstimate({
      ...input,
      events: createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country)),
    }),
  );

function resetPorts() {
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.estimate.mockImplementation(async (input: TaxEstimateRequest) => scenarioEstimate(input));
}
resetPorts();
afterEach(resetPorts);

const DEEMED_LIMITATION = /시행일 전 취득분을 소비한 처분/;

describe("P0-4 연말 시가 입력 → 의제취득가액 반영", () => {
  it("엔진: 시가를 입력하면 의제취득가액 한계가 사라진다(재계산 반영)", () => {
    const base = { country: "KR", taxYear: 2027, events: createTaxScenarioEvents(2027, scenarioScaleFor("KR")) };
    const before = computeTaxEstimate(base);
    const deemedCount = (estimate: TaxEstimate) =>
      estimate.limitations.filter((row) => row.message.includes("의제취득가액")).length;
    // 시가 미입력이면 의제취득가액 한계가 떠 있다(손익이 과대될 수 있음).
    expect(deemedCount(before)).toBeGreaterThan(0);

    const gainAssets = [...new Set(before.judgments.filter((row) => row.amountKind === "gain").map((row) => row.asset))];
    const deemedFmv = Object.fromEntries(gainAssets.map((asset) => [asset, "999999999"]));
    const after = computeTaxEstimate({ ...base, deemedFmv });
    // 자산별 시가가 채워지면 의제취득가액을 반영해 그 한계가 없어진다(건수 변화).
    expect(deemedCount(after)).toBe(0);
  });

  it("UI: 연말 시가 폼 입력이 deemedFmv로 흘러가 의제취득가액 한계가 사라진다", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ReportView countryCode="KR" currentYear={2027} walletConnected={false} />
      </QueryClientProvider>,
    );

    // 시행 후(2027) 한국 계산이 도착하면 의제취득가액 한계가 답 옆에 떠 있다.
    await screen.findByText("한국 · 2027");
    await screen.findByText(DEEMED_LIMITATION);

    // 연말 시가 입력 폼이 처분 자산별로 뜬다(자산·수량·시가·출처).
    const section = screen.getByLabelText("연말 시가 입력");
    const fmvInputs = within(section).getAllByPlaceholderText("예: 4000000");
    expect(fmvInputs.length).toBeGreaterThan(0);

    // 각 자산에 2026-12-31 시가를 입력한다.
    for (const input of fmvInputs) {
      fireEvent.change(input, { target: { value: "999999999" } });
    }

    // 입력값이 deemedFmv로 estimate 요청에 실린다.
    await waitFor(() =>
      expect(
        ports.estimate.mock.calls.some(([input]) => input?.deemedFmv && Object.keys(input.deemedFmv).length > 0),
      ).toBe(true),
    );
    // 재계산되면 의제취득가액 한계가 사라진다(반영 확인).
    await waitFor(() => expect(screen.queryByText(DEEMED_LIMITATION)).toBeNull());
  });
});
