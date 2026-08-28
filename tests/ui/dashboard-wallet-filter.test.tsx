import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { shortHash } from "@/lib/format";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 지갑 필터.
 *
 * 사용자는 지갑을 여러 개 등록할 수 있고 거래는 등록된 지갑 전체에서 합산돼 내려온다. 한 목록에 섞여
 * 있으면 "이 지갑에서 무슨 일이 있었나"를 볼 방법이 없으므로 드롭다운으로 보는 대상을 바꾼다.
 *
 * 시각을 고정하는 이유는 연도 필터 파일과 같다 — 픽스처의 다음 해 배치가 실제 시계에 따라 커지고 작아지면
 * 건수 단언이 계절에 따라 다른 것을 지킨다.
 */
const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";

const ALL = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, new Date(Date.UTC(FIXTURE_TAX_YEAR + 2, 0, 1)));
// 짝수 번째를 두 번째 지갑으로 옮긴다. 생성기는 이벤트마다 tx_hash가 달라 스왑 페어링이 없으므로
// 이 분할이 한 트랜잭션을 두 지갑으로 가르지 않는다.
const SPLIT: NormalizedEvent[] = ALL.map((event, index) => (index % 2 === 0 ? { ...event, wallet_address: WALLET_B } : event));
const IN_B = SPLIT.filter((event) => event.wallet_address === WALLET_B).length;
const IN_A = SPLIT.length - IN_B;

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

let currentEvents: NormalizedEvent[] = SPLIT;
const engine = new TaxEngineService(() => currentEvents);

function serveEvents(next: NormalizedEvent[]) {
  currentEvents = next;
  ports.list.mockResolvedValue({ items: next.map((event) => ({ event, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1000",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    period: { from: next[0].block_timestamp, to: next.at(-1)!.block_timestamp },
  });
  ports.getById.mockImplementation(async (id: string) => ({
    event: next.find((event) => event.id === id)!,
    version: 1,
    override_history: [],
  }));
  ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
}

serveEvents(SPLIT);

afterEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.reclassify.mockReset();
  ports.estimate.mockReset();
  serveEvents(SPLIT);
});

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardView countryCode="DE" />
    </QueryClientProvider>,
  );
}

const cardsOf = (container: HTMLElement) => [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];

async function settled(container: HTMLElement) {
  await waitFor(
    () => {
      const cards = cardsOf(container);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    },
    { timeout: 5000 },
  );
}

describe("지갑 필터", () => {
  it("지갑이 하나뿐이면 드롭다운을 두지 않는다", async () => {
    serveEvents(ALL);
    const { container } = renderDashboard();
    await settled(container);

    // 선택지가 하나인 드롭다운은 고를 것이 없으면서 자리만 차지한다(체인 칩과 같은 규칙).
    expect(container.querySelector('[data-surface="wallet-filter"]')).toBeNull();
  });

  it("지갑이 여럿이면 드롭다운에 각 지갑과 건수를 보인다", async () => {
    const { container } = renderDashboard();
    await settled(container);

    const select = screen.getByLabelText("지갑") as HTMLSelectElement;
    const options = [...select.options].map((option) => option.textContent);
    expect(options[0]).toBe(`전체 지갑 · ${SPLIT.length}건`);
    expect(options).toContain(`${shortHash(WALLET_A)} · ${IN_A}건`);
    expect(options).toContain(`${shortHash(WALLET_B)} · ${IN_B}건`);
  });

  it("지갑을 고르면 그 지갑의 거래만 남고, 전체로 되돌리면 합이 맞는다", async () => {
    const { container } = renderDashboard();
    await settled(container);
    expect(cardsOf(container)).toHaveLength(SPLIT.length);

    const select = screen.getByLabelText("지갑");
    fireEvent.change(select, { target: { value: WALLET_B.toLowerCase() } });
    await waitFor(() => expect(cardsOf(container)).toHaveLength(IN_B));

    fireEvent.change(select, { target: { value: WALLET_A.toLowerCase() } });
    await waitFor(() => expect(cardsOf(container)).toHaveLength(IN_A));

    // 두 지갑을 합치면 전체가 된다 — 어느 한쪽이 조용히 빠지면 여기서 어긋난다.
    expect(IN_A + IN_B).toBe(SPLIT.length);

    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(cardsOf(container)).toHaveLength(SPLIT.length));
  });

  it("체인 칩 건수는 고른 지갑을 기준으로 다시 센다", async () => {
    const { container } = renderDashboard();
    await settled(container);

    const chainChipTotal = () =>
      [...(container.querySelector('[aria-label="체인 필터"]')?.querySelectorAll("button") ?? [])]
        .slice(1) // 첫 칩은 "전체 체인"이라 건수를 달지 않는다.
        .reduce((sum, chip) => sum + Number(chip.textContent?.match(/(\d+)$/)?.[1] ?? 0), 0);

    expect(chainChipTotal()).toBe(SPLIT.length);

    fireEvent.change(screen.getByLabelText("지갑"), { target: { value: WALLET_B.toLowerCase() } });
    // 칩 건수가 전체 기준에 머물면 드롭다운은 한 지갑 건수를 말하는데 칩은 전체를 말하게 된다.
    await waitFor(() => expect(chainChipTotal()).toBe(IN_B));
  });
});
