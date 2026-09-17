import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "@/components/transactions/transactions-view";
import { shortHash } from "@/lib/format";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 거래 화면(TransactionsView)의 지갑 필터.
 *
 * 사용자는 지갑을 여러 개 등록할 수 있고 거래는 등록된 지갑 전체에서 합산돼 내려온다. 한 목록에 섞여
 * 있으면 "이 지갑에서 무슨 일이 있었나"를 볼 방법이 없으므로 필터로 보는 대상을 바꾼다.
 *
 * 필터 UI는 칩 한 줄 + 바텀시트다: 칩(`button[data-filter="wallet"]`)을 누르면 시트가 열리고,
 * 시트 안의 옵션 묶음(`[aria-label="지갑 필터"]`)에서 지갑을 고르면 시트가 닫히며 필터가 걸린다.
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

function renderTransactions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionsView countryCode="DE" />
    </QueryClientProvider>,
  );
}

const cardsOf = (container: HTMLElement) => [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];

/** 필터 칩 한 개. 선택지가 하나뿐인 필터는 칩 자체를 그리지 않으므로 null이 온다. */
const chipOf = (container: HTMLElement, key: string) =>
  container.querySelector<HTMLButtonElement>(`[data-surface="transaction-filters"] button[data-filter="${key}"]`);

/** 칩을 눌러 시트를 열고 그 안의 옵션 묶음을 돌려준다. */
function openSheet(container: HTMLElement, key: string, label: string) {
  const chip = chipOf(container, key);
  expect(chip, `${key} 칩`).not.toBeNull();
  fireEvent.click(chip!);
  return screen.getByLabelText(label);
}

/** 시트 옵션 한 줄은 `<span>라벨</span><span>n건</span>`이다 — 스팬 단위로 나눠 읽는다. */
function optionsOf(sheet: HTMLElement) {
  return [...sheet.querySelectorAll("button")].map((node) => ({
    node,
    label: node.children[0]?.textContent ?? "",
    count: node.children[1] === undefined ? null : Number(node.children[1].textContent?.replace(/\D/g, "")),
  }));
}

/** 시트에서 라벨로 옵션 한 줄을 집는다. */
function optionOf(sheet: HTMLElement, label: string) {
  const found = optionsOf(sheet).find((option) => option.label === label);
  expect(found, `${label} 옵션`).toBeDefined();
  return found!;
}

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
  it("지갑이 하나뿐이면 칩을 두지 않는다", async () => {
    serveEvents(ALL);
    const { container } = renderTransactions();
    await settled(container);

    // 선택지가 하나인 필터는 눌러도 고를 것이 없으면서 자리만 차지한다(체인 칩과 같은 규칙).
    expect(chipOf(container, "wallet")).toBeNull();
  });

  it("지갑이 여럿이면 시트에 각 지갑과 건수를 보인다", async () => {
    const { container } = renderTransactions();
    await settled(container);

    const options = optionsOf(openSheet(container, "wallet", "지갑 필터"));
    // 첫 줄은 되돌릴 문이다. 칩 시절과 달리 여기에도 건수가 붙는다.
    expect(options[0]).toMatchObject({ label: "전체 지갑", count: SPLIT.length });
    const rest = options.slice(1).map(({ label, count }) => ({ label, count }));
    expect(rest).toContainEqual({ label: shortHash(WALLET_A), count: IN_A });
    expect(rest).toContainEqual({ label: shortHash(WALLET_B), count: IN_B });
  });

  it("지갑을 고르면 그 지갑의 거래만 남고, 전체로 되돌리면 합이 맞는다", async () => {
    const { container } = renderTransactions();
    await settled(container);
    expect(cardsOf(container)).toHaveLength(SPLIT.length);

    fireEvent.click(optionOf(openSheet(container, "wallet", "지갑 필터"), shortHash(WALLET_B)).node);
    // 고르면 시트가 닫힌다 — 닫히지 않으면 사용자는 결과를 보지 못한 채 시트에 갇힌다.
    expect(screen.queryByLabelText("지갑 필터")).not.toBeInTheDocument();
    await waitFor(() => expect(cardsOf(container)).toHaveLength(IN_B));

    fireEvent.click(optionOf(openSheet(container, "wallet", "지갑 필터"), shortHash(WALLET_A)).node);
    await waitFor(() => expect(cardsOf(container)).toHaveLength(IN_A));

    // 두 지갑을 합치면 전체가 된다 — 어느 한쪽이 조용히 빠지면 여기서 어긋난다.
    expect(IN_A + IN_B).toBe(SPLIT.length);

    fireEvent.click(optionOf(openSheet(container, "wallet", "지갑 필터"), "전체 지갑").node);
    await waitFor(() => expect(cardsOf(container)).toHaveLength(SPLIT.length));
  });

  it("체인 시트 건수는 고른 지갑을 기준으로 다시 센다", async () => {
    const { container } = renderTransactions();
    await settled(container);

    const chainOptionTotal = () =>
      optionsOf(openSheet(container, "chain", "체인 필터"))
        .slice(1) // 첫 줄은 "전체 체인"이라 나머지 합과 이중으로 세지 않는다.
        .reduce((sum, option) => sum + (option.count ?? 0), 0);

    expect(chainOptionTotal()).toBe(SPLIT.length);

    fireEvent.click(optionOf(openSheet(container, "wallet", "지갑 필터"), shortHash(WALLET_B)).node);
    // 건수가 전체 기준에 머물면 지갑 시트는 한 지갑 건수를 말하는데 체인 시트는 전체를 말하게 된다.
    await waitFor(() => expect(chainOptionTotal()).toBe(IN_B));
  });
});
