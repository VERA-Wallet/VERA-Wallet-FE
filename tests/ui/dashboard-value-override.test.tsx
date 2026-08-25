import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { assetLabel, formatSignedTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
  getById: vi.fn(),
  setValueOverride: vi.fn(),
}));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify, getById: ports.getById, setValueOverride: ports.setValueOverride },
  summaryProvider: { getSummary: ports.getSummary },
}));

function rowLabel(event: NormalizedEvent) {
  return `${formatSignedTokenAmount(event)} · ${assetLabel(event)}`;
}

function setup(event: NormalizedEvent, saveResult: unknown) {
  ports.list.mockResolvedValue({ items: [{ event, version: 1 }], nextCursor: null });
  ports.getSummary.mockResolvedValue({ periodPnl: "1", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 0, currency: "KRW", period: { from: "a", to: "b" } });
  ports.getById.mockResolvedValue({ event, version: 1, override_history: [] });
  ports.setValueOverride.mockResolvedValue(saveResult);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><DashboardView /></QueryClientProvider>);
  return { invalidate };
}

describe("dashboard 금액 override 편집", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("취득(RECEIVE) 거래는 취득가액 입력을 노출하고, 저장 시 override와 재계산 무효화가 일어난다", async () => {
    const event: NormalizedEvent = { ...createNormalizedEventFixtures()[0], classification: "RECEIVE", user_override: null, value_override: null };
    const { invalidate } = setup(event, { status: "ok", event: { ...event, value_override: null }, version: 2 });

    fireEvent.click(await screen.findByText(rowLabel(event)));
    await screen.findByText("거래 상세");

    const acquisition = screen.getByLabelText("취득가액 (원)");
    expect(acquisition).toBeInTheDocument();
    // 처분 전용 칸은 취득 거래에 나오지 않는다.
    expect(screen.queryByLabelText("양도가액 (원)")).not.toBeInTheDocument();

    fireEvent.change(acquisition, { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText("부대비용 (원)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "금액 저장" }));

    // 저장은 손익·확인 필요 판정을 바꾸므로 estimate·요약·목록을 다시 계산해야 한다.
    expect(await screen.findByText("금액을 저장했습니다.")).toBeInTheDocument();
    expect(ports.setValueOverride).toHaveBeenCalledWith("event-01", {
      expectedVersion: 1,
      value_override: {
        acquisition_cost: "1000000",
        disposal_value: null,
        incidental_cost: "5000",
        gas_fee: null,
        price_source: null,
        evidence_url: null,
        deemed_expense_50: false,
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tax", "estimate"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "summary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "list"] });
  });

  it("처분(SEND) 거래는 양도가액과 50% 필요경비 의제 옵션을 노출한다", async () => {
    const event: NormalizedEvent = { ...createNormalizedEventFixtures()[0], classification: "SEND", user_override: null, value_override: null };
    setup(event, { status: "ok", event, version: 2 });

    fireEvent.click(await screen.findByText(rowLabel(event)));
    await screen.findByText("거래 상세");

    expect(screen.getByLabelText("양도가액 (원)")).toBeInTheDocument();
    const deemed = screen.getByText("취득가 입증이 어려우면 양도가액의 50%를 필요경비로 인정");
    expect(deemed).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("양도가액 (원)"), { target: { value: "5000000" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "금액 저장" }));

    expect(await screen.findByText("금액을 저장했습니다.")).toBeInTheDocument();
    expect(ports.setValueOverride).toHaveBeenCalledWith("event-01", {
      expectedVersion: 1,
      value_override: {
        acquisition_cost: null,
        disposal_value: "5000000",
        incidental_cost: null,
        gas_fee: null,
        price_source: null,
        evidence_url: null,
        deemed_expense_50: true,
      },
    });
  });
});
