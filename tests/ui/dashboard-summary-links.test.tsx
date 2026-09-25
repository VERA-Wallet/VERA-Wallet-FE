import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 요약이 원장으로 내보내는 **문**들.
 *
 * 목록이 거래 탭으로 떠나면서 요약에는 "여기서 더 볼 것이 있다"는 사실만 남는다. 그 문이 없으면
 * 요약은 막다른 화면이 된다 — 확인할 것이 있어도 어디로 가야 하는지 말하지 않고, 방금 무슨 일이
 * 있었는지도 보이지 않는다. 이 파일이 지키는 것은 그 문들이 있는가, 그리고 **목록 자체는 여기 없는가**다.
 *
 * 요약 기간을 `{ from: "a", to: "b" }`로 두는 이유: 달력에 없는 기간이라 판정 조회가 비활성이 된다.
 * 여기서 보려는 것은 문과 건수이지 판정이 아니므로 세무 엔진을 끌어들이지 않는다.
 */

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

const [, source] = createNormalizedEventFixtures();

/** tx_hash를 건마다 다르게 준다 — 같으면 스왑 페어링이 두 건을 한 행으로 합쳐 버린다. */
function event(id: string, day: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    ...source,
    id,
    tx_hash: `0x${id.padEnd(8, "0")}`,
    block_timestamp: `2025-01-${day}T00:00:00.000Z`,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...overrides,
  };
}

/** 1일 → 5일. 목록은 최신순이라 "최근 3건"은 05·04·03이어야 한다. */
const FIVE = [
  event("row-1", "01"),
  event("row-2", "02"),
  event("row-3", "03"),
  event("row-4", "04"),
  event("row-5", "05"),
];

function serve(events: NormalizedEvent[]) {
  ports.list.mockResolvedValue({ items: events.map((item, index) => ({ event: item, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    // 달력에 없는 기간 — 판정 조회가 비활성이라 이 파일은 문과 건수만 본다.
    period: { from: "a", to: "b" },
  });
}

function renderSummary() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DashboardView countryCode="KR" />
    </QueryClientProvider>,
  );
}

const rowIds = () => [...document.querySelectorAll("[data-event-id]")].map((node) => node.getAttribute("data-event-id"));

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.estimate.mockReset();
});

describe("요약은 원장으로 가는 문을 연다", () => {
  it("최근 거래는 세 줄만 보이고 나머지는 링크가 데려간다", async () => {
    serve(FIVE);
    renderSummary();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    // 원장을 옮겨 심은 것이 아니라 **문**이다 — 다섯 건이 있어도 세 줄만 보인다.
    expect(rowIds()).toEqual(["row-5", "row-4", "row-3"]);
    const all = screen.getByRole("link", { name: "전체 5건 보기" });
    expect(all).toHaveAttribute("href", "/transactions");
  });

  it("확인할 것이 있어도 요약에는 확인 필요 카드를 두지 않는다", async () => {
    // 가격을 확정하지 못한 건 하나 — 확인 필요 큐에는 오르지만, 그 큐를 말하는 자리는 거래 탭이다.
    serve([...FIVE, event("needs-review", "06", { price_status: "UNKNOWN" as const, fiat_value: null })]);
    renderSummary();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(document.querySelector('[data-surface="review-nudge"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /확인 필요/ })).toBeNull();
  });

  it("헤더 우측 톱니가 설정으로 데려간다", async () => {
    serve(FIVE);
    renderSummary();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    // 설정은 탭 자리를 차지할 만큼 자주 가는 곳이 아니지만, 문이 없으면 없는 화면이 된다.
    expect(screen.getByRole("link", { name: "설정" })).toHaveAttribute("href", "/settings");
  });
});

describe("요약은 목록 화면이 아니다", () => {
  it("제목이 '요약'이고 탭·필터·검색은 여기 없다", async () => {
    serve(FIVE);
    renderSummary();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(screen.getByRole("heading", { level: 1, name: "요약" })).toBeInTheDocument();
    // 목록을 좁히는 문은 전부 거래 탭에 있다. 두 화면에 같은 필터를 두면
    // 사용자는 지금 보는 수가 어느 쪽 필터에서 나온 것인지 알 수 없다.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByLabelText("거래 검색")).not.toBeInTheDocument();
    expect(document.querySelector('[data-surface="transaction-filters"]')).toBeNull();
    expect(screen.queryByText("표시 항목 안내")).not.toBeInTheDocument();
  });

  it("남길 것은 그대로 남는다 — 기간·그래프·요약 카드·금액 가리기", async () => {
    serve(FIVE);
    renderSummary();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(screen.getByRole("button", { name: /기간 바꾸기/ })).toBeInTheDocument();
    expect(screen.getByLabelText("누적 순유입")).toBeInTheDocument();
    expect(screen.getByText("예상 손익")).toBeInTheDocument();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "금액 가리기" })).toBeInTheDocument();
  });
});
