import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 요약 화면이 보고 있는 **기간**을 사용자가 정한다.
 *
 * 이 파일이 지키는 것은 기간이 한 곳에서만 정해진다는 사실이다 — 헤더에서 고르든
 * 그래프 버튼으로 고르든 헤더 문구와 선이 **같은 기간**을 말해야 한다.
 * 둘 중 하나만 따라 움직이면 한 화면이 두 기간을 동시에 주장하게 된다.
 *
 * 전체 거래 목록은 거래 탭(`/transactions`)으로 떠났고, 기간 선택은 더 이상 목록을 좁히지 않는다 —
 * 목록을 좁히는 문은 그쪽 연도 필터 하나뿐이다. 그래서 "좁아졌다"는 사실을 예전처럼 목록 날짜
 * 머리글로 보지 않고, 그래프가 말하는 **그 기간의 순유입**(testid `flow-change`)으로 본다.
 *
 * 픽스처는 1/10 +100만 → 2/10 −40만 → 3/10 +20만이라 기간마다 합이 갈린다:
 * 전체(1/10~3/10)는 +80만, 1/1~2/28은 +60만, 1개월(2/8~3/10)은 1/10까지의 누적(+100만)을
 * 기준선으로 두고 그 뒤 −40만 +20만만 재므로 −20만이다.
 */

function event(overrides: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  const merged: NormalizedEvent = {
    tx_hash: `0x${overrides.id}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2025-01-10T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "IN",
    asset_type: "NATIVE",
    asset_contract: null,
    asset_symbol: "ETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "1000000000000000000",
    counterparty: "0x2222222222222222222222222222222222222222",
    gas_fee_native: "0.001",
    classification: "RECEIVE",
    confidence: 0.9,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "1000000",
    fiat_currency: "KRW",
    income_kind: null,
    group_id: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...overrides,
  };
  if (overrides.direction === undefined) {
    merged.direction = merged.classification === "SEND" ? "OUT" : "IN";
  }
  return merged;
}

/** 1/10 +100만 → 2/10 −40만 → 3/10 +20만. 세 달에 하나씩이라 어느 기간이 잘렸는지 눈으로 갈린다. */
const wallet: NormalizedEvent[] = [
  event({ id: "a", classification: "RECEIVE", fiat_value: "1000000", block_timestamp: "2025-01-10T00:00:00.000Z" }),
  event({ id: "b", classification: "SEND", fiat_value: "400000", block_timestamp: "2025-02-10T00:00:00.000Z" }),
  event({ id: "c", classification: "RECEIVE", fiat_value: "200000", block_timestamp: "2025-03-10T00:00:00.000Z" }),
];

const PERIOD = { from: "2025-01-10T00:00:00.000Z", to: "2025-03-10T00:00:00.000Z" };

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

function estimateWith(period: { from: string; to: string }): TaxEstimate {
  return {
    country: "KR",
    countryLabel: "한국",
    currency: "KRW",
    taxYear: 2025,
    method: "거주자별 총평균법",
    status: "PARTIAL",
    lines: [],
    totals: {
      taxableGains: "0",
      exemptGains: "0",
      incomeTotal: "0",
      taxableBase: "0",
      estimatedCharge: "0",
      effectiveRatePercent: "0",
    },
    lossCarryforward: "0",
    notes: [],
    limitations: [],
    openQuestions: [],
    requiredInputs: [],
    excludedEventIds: [],
    provenance: "mock",
    period,
    judgments: [],
  };
}

function renderDashboard() {
  ports.list.mockResolvedValue({ items: wallet.map((item) => ({ event: item, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "800000",
    computableEventCount: 3,
    taxableEventCount: 1,
    pendingReviewCount: 0,
    currency: "KRW",
    period: PERIOD,
  });
  ports.estimate.mockResolvedValue(estimateWith(PERIOD));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DashboardView />
    </QueryClientProvider>,
  );
}

/** 헤더의 기간 문. 접근 가능한 이름에 지금 기간이 그대로 들어 있다. */
const periodButton = () => screen.getByRole("button", { name: /기간 바꾸기/ });
/** 그래프가 말하는 **이 기간의 순유입**. 기간이 좁아졌는지는 이 수가 갈리는 것으로 안다. */
const flowChange = () => screen.getByTestId("flow-change").textContent ?? "";

/** 첫 그림이 다 그려진 상태 — 헤더는 요약 기간을, 선은 세 달 전부(+80만)를 말한다. */
async function waitForFullPeriod() {
  await waitFor(() => expect(periodButton()).toHaveTextContent("2025-01-10 ~ 2025-03-10"));
  await waitFor(() => expect(flowChange()).toContain("+₩800,000"));
}

describe("요약 기간 고르기", () => {
  it("고르기 전에는 요약이 말하는 기간을 그대로 보인다", async () => {
    renderDashboard();
    await waitForFullPeriod();
    // 좁히지 않았으므로 세 달이 모두 선에 들어간다: +100만 −40만 +20만 = +80만.
    expect(periodButton()).toHaveTextContent("2025-01-10 ~ 2025-03-10");
    expect(flowChange()).toContain("+₩800,000");
  });

  it("직접 지정한 날짜로 헤더와 그래프가 함께 좁아진다", async () => {
    renderDashboard();
    await waitForFullPeriod();

    fireEvent.click(periodButton());
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2025-02-28" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    // 헤더는 이제 요약 기간이 아니라 **고른 기간**을 말한다.
    expect(periodButton()).toHaveTextContent("2025-01-01 ~ 2025-02-28");
    // 선도 같은 기간이다: 1/10 +100만 → 2/10 −40만 = +60만. 3월 건은 선에서 빠졌다.
    expect(flowChange()).toContain("+₩600,000");
    // 프리셋 어느 것도 아니라는 사실을 그래프가 숨기지 않는다.
    expect(screen.getByText("직접 지정")).toBeInTheDocument();
  });

  it("그래프의 기간 버튼을 눌러도 헤더가 함께 따라온다", async () => {
    renderDashboard();
    await waitForFullPeriod();

    fireEvent.click(screen.getByRole("button", { name: "1개월" }));

    // 마지막 거래(3/10)에서 30일 뒤로 = 2/8. 그래프만 좁아지고 헤더가 그대로면 두 기간이 된다.
    expect(periodButton()).toHaveTextContent("2025-02-08 ~ 2025-03-10");
    // 1/10까지의 누적 +100만이 기준선이 되고 그 뒤 −40만 +20만만 재므로 −20만이다.
    expect(flowChange()).toContain("-₩200,000");
  });

  it("기간이 될 수 없는 날짜는 왜 안 되는지 말하고 화면을 바꾸지 않는다", async () => {
    renderDashboard();
    await waitForFullPeriod();

    fireEvent.click(periodButton());
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2025-03-31" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2025-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(screen.getByRole("alert")).toHaveTextContent("종료일이 시작일보다 앞섭니다.");
    // 조용히 통과시키면 존재하지 않는 기간의 선을 "그 기간의 전부"라고 말하게 된다.
    expect(periodButton()).toHaveTextContent("2025-01-10 ~ 2025-03-10");
    expect(flowChange()).toContain("+₩800,000");
  });

  it("좁힌 기간은 되돌릴 문이 같은 자리에 있다", async () => {
    renderDashboard();
    await waitForFullPeriod();

    fireEvent.click(screen.getByRole("button", { name: "1개월" }));
    expect(flowChange()).toContain("-₩200,000");

    fireEvent.click(periodButton());
    fireEvent.click(screen.getByRole("button", { name: "전체 기간" }));

    expect(flowChange()).toContain("+₩800,000");
    expect(periodButton()).toHaveTextContent("2025-01-10 ~ 2025-03-10");
  });

  it("기간을 좁혔다는 사실과 그 대가를 같은 자리에서 말한다", async () => {
    renderDashboard();
    await waitForFullPeriod();

    fireEvent.click(screen.getByRole("button", { name: "1개월" }));

    // 전에는 "고른 기간의 거래 2건 · 날짜를 모르는 m건은 빠집니다"가 이 사실을 말했다. 목록이
    // 거래 탭으로 떠나면서 요약에는 좁힐 목록이 없어졌고, 그 고지도 함께 사라졌다.
    // 그래서 좁혔다는 사실은 선이 말하고(전체 +80만 → 2/8~3/10 −20만),
    // 기간을 좁혀도 **무엇이 안 따라오는지**는 고르는 자리(패널)가 그대로 말한다.
    // 기간을 좁혔는데 손익이 그대로면 사용자는 계산이 틀렸다고 읽는다 — 무엇이 안 바뀌는지 밝힌다.
    expect(flowChange()).toContain("-₩200,000");
    fireEvent.click(periodButton());
    expect(screen.getByText(/손익과 계산 대상 건수는 과세연도 기준으로 표시됩니다/)).toBeInTheDocument();
  });
});
