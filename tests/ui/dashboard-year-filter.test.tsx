import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "@/components/transactions/transactions-view";
import { assetTicker, chainLabel, formatSignedTokenAmount } from "@/lib/format";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 거래 화면(TransactionsView)의 연도 필터와 최신순 정렬.
 *
 * 연도는 칩 한 줄 + 바텀시트로 고른다: 칩(`button[data-filter="year"]`)을 누르면 시트가 열리고,
 * 시트 안의 옵션 묶음(`[aria-label="연도 필터"]`)에서 해를 고르면 시트가 닫히며 목록이 좁혀진다.
 * 목록을 좁히는 문은 이 연도 필터뿐이다 — 기간 선택기는 요약 화면으로 옮겨 갔다.
 *
 * 픽스처의 다음 해 배치는 실제 시계에 따라 크기가 달라지므로 두 경우를 **고정 시각**으로 만든다.
 * 시계를 그대로 쓰면 1~6월에 돌 때 두 해 시나리오가 조용히 한 해 시나리오가 되어,
 * 이 파일 전체가 아무것도 지키지 않는 상태로 통과한다.
 */
// base(2025) + next(2026) + 시행연도 쇼케이스(2027) = 세 해가 섞인다. 시행연도 쇼케이스는
// 미래 필터와 무관하게 항상 있어, now를 이르게 줘도 사라지지 않는다.
const TWO_YEARS = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, new Date(Date.UTC(FIXTURE_TAX_YEAR + 2, 0, 1)));
// 한 해짜리 집합은 base(2025)만 남긴다 — 쇼케이스(2027)가 항상 붙어 생성기만으로는 한 해를 만들 수 없다.
const ONE_YEAR = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, new Date(Date.UTC(FIXTURE_TAX_YEAR + 1, 0, 1))).filter(
  (event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR)),
);

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

// 판정은 실제 어댑터를 통과시킨다. 연도 필터가 판정과 독립인지를 보는 파일이라
// 가짜 판정을 물리면 그 독립성이 검증되지 않는다.
let currentEvents: NormalizedEvent[] = TWO_YEARS;
const engine = new TaxEngineService(() => currentEvents);

function serveEvents(next: NormalizedEvent[]) {
  currentEvents = next;
  ports.list.mockResolvedValue({ items: next.map((event) => ({ event, version: 1 })), nextCursor: null });
  // 기간은 픽스처에서 파생한다. 못 박으면 화면이 거래 없는 해를 과세연도로 잡아
  // 판정이 전부 비어도 조용히 통과한다.
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

serveEvents(TWO_YEARS);

afterEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.reclassify.mockReset();
  ports.estimate.mockReset();
  serveEvents(TWO_YEARS);
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
const yearOf = (event: NormalizedEvent) => Number(event.block_timestamp.slice(0, 4));
function rowLabel(event: NormalizedEvent) {
  // 목록 티커 줄과 같은 규칙: 스왑은 "보낸 → 받은", 브릿지는 "출발 → 도착 · 자산",
  // NFT는 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커.
  if (event.swap_to_symbol !== null) return `${assetTicker(event)} → ${event.swap_to_symbol}`;
  if (event.bridge_dest_chain_id !== null) return `${formatSignedTokenAmount(event)} ${assetTicker(event)} · ${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`;
  if (event.token_id !== null) return assetTicker(event);
  return `${formatSignedTokenAmount(event)} ${assetTicker(event)}`;
}

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

/** 연도 시트에서 한 해의 줄을 집는다. */
function yearOption(sheet: HTMLElement, value: number) {
  const found = optionsOf(sheet).find((option) => option.label === `${value}년`);
  expect(found, `${value}년 옵션`).toBeDefined();
  return found!;
}

/** 판정이 정착했는가 — 모든 카드가 "판정 확인 중"에서 벗어나면 도착한 것이다. */
async function settled(container: HTMLElement) {
  await waitFor(
    () => {
      const cards = cardsOf(container);
      expect(cards.length).toBeGreaterThan(0);
      // 배지가 목록에서 빠진 뒤로 정착 신호는 손익 블록의 존재다(보류면 렌더되지 않는다).
      expect(cards.every((card) => card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    },
    { timeout: 5000 },
  );
}

describe("목록은 최신이 위다", () => {
  it("픽스처가 오래된 순으로 와도 화면은 최신순으로 그린다", async () => {
    const { container } = renderTransactions();
    await settled(container);

    const newestFirst = [...TWO_YEARS].sort(
      (left, right) => Date.parse(right.block_timestamp) - Date.parse(left.block_timestamp),
    );
    // 두 순서가 실제로 다름을 먼저 확인한다 — 같으면 이 단언은 아무것도 지키지 않는다.
    expect(newestFirst[0].id).not.toBe(TWO_YEARS[0].id);
    const labels = cardsOf(container).map((card) => card.querySelector("[data-event-label]")?.textContent ?? "");
    expect(labels).toEqual(newestFirst.map(rowLabel));
  });
});

describe("연도 필터", () => {
  it("여러 해가 섞여 있으면 연도 시트로 한 해만 남긴다", async () => {
    const { container } = renderTransactions();
    await settled(container);

    const options = optionsOf(openSheet(container, "year", "연도 필터"));
    // 줄은 최신 연도가 먼저다. 목록이 최신순인데 시트만 오래된 순이면 화면이 두 이야기를 한다.
    // 시행연도 쇼케이스(2027)까지 세 해가 있으므로 2027·2026·2025 순으로 온다.
    expect(options[0].label).toBe("전체 연도");
    expect(options.slice(1).map((option) => option.label)).toEqual([
      `${FIXTURE_TAX_YEAR + 2}년`,
      `${FIXTURE_TAX_YEAR + 1}년`,
      `${FIXTURE_TAX_YEAR}년`,
    ]);

    const all = cardsOf(container).length;
    expect(all).toBe(TWO_YEARS.length);

    // 옵션 건수는 **지금 눌렀을 때 남을 카드 수**여야 한다.
    const nextYearCount = TWO_YEARS.filter((event) => yearOf(event) === FIXTURE_TAX_YEAR + 1).length;
    expect(nextYearCount).toBeGreaterThan(0);
    expect(yearOption(screen.getByLabelText("연도 필터"), FIXTURE_TAX_YEAR + 1).count).toBe(nextYearCount);

    fireEvent.click(yearOption(screen.getByLabelText("연도 필터"), FIXTURE_TAX_YEAR + 1).node);
    // 고르면 시트가 닫힌다 — 결과를 가린 채로 두면 무엇이 걸렸는지 확인할 수 없다.
    expect(screen.queryByLabelText("연도 필터")).not.toBeInTheDocument();
    expect(cardsOf(container)).toHaveLength(nextYearCount);
    expect(cardsOf(container).length).toBeLessThan(all);
    // 건수만 맞고 다른 해가 섞이면 필터가 아니다 — 어느 거래가 남았는지 전수로 본다.
    const shownIds = new Set(cardsOf(container).map((card) => card.getAttribute("data-event-id")));
    for (const event of TWO_YEARS) {
      expect(shownIds.has(event.id), event.id).toBe(yearOf(event) === FIXTURE_TAX_YEAR + 1);
    }

    // 같은 줄을 다시 누르면 풀린다.
    fireEvent.click(yearOption(openSheet(container, "year", "연도 필터"), FIXTURE_TAX_YEAR + 1).node);
    expect(cardsOf(container)).toHaveLength(all);
  });

  it("연도를 걸어도 행 내용과 확인 필요 건수는 흔들리지 않는다", async () => {
    // 연도는 표시 필터다. 판정·요약까지 좁히면 사용자가 고른 해의 세금을 본 것으로 오해한다.
    // 요약 카드("예상 손익")는 대시보드로 떨어져 나가 이 화면에 없다. 그래서 요약 금액 불변 대신
    // 거래 화면 안에서 확인할 수 있는 불변 둘로 같은 사실을 지킨다:
    //   (1) 남은 행의 렌더 내용(손익 블록 포함)이 그대로일 것 — 판정이 연도에 흔들리지 않았다는 뜻.
    //   (2) "확인 필요" 탭 배지 건수가 그대로일 것 — 확인 필요 큐가 연도와 무관하게 원장 전체를 센다는 뜻.
    // 행을 id로 특정한다 — 티커는 NFT 번호가 빠져 중복될 수 있어 라벨로는 한 행을 못 집는다.
    const { container } = renderTransactions();
    await settled(container);
    const reviewBadge = () => screen.getByRole("tab", { name: "확인 필요" }).querySelector("span")?.textContent;
    const badgeBefore = reviewBadge();
    // 배지가 0이면 "그대로다"가 아무것도 지키지 않는다.
    expect(badgeBefore).not.toBe("0");
    const target = TWO_YEARS.filter((event) => yearOf(event) === FIXTURE_TAX_YEAR + 1).at(-1)!;
    const rowOf = (id: string) => container.querySelector(`[data-event-id="${id}"]`)!;
    const rowBefore = rowOf(target.id).textContent;

    fireEvent.click(yearOption(openSheet(container, "year", "연도 필터"), FIXTURE_TAX_YEAR + 1).node);

    expect(reviewBadge()).toBe(badgeBefore);
    // 필터 후에도 그 해의 행은 남고, 손익·수량 등 렌더 내용이 그대로여야 한다(연도는 표시만 좁힌다).
    expect(rowOf(target.id).textContent).toBe(rowBefore);
  });

  it("연도가 하나뿐이면 칩 자체를 숨긴다", async () => {
    serveEvents(ONE_YEAR);
    const { container } = renderTransactions();
    await settled(container);

    expect(new Set(ONE_YEAR.map(yearOf)).size).toBe(1);
    // 누를 것이 하나뿐인 칩은 자리만 차지한다(체인 필터와 같은 규칙).
    expect(chipOf(container, "year")).toBeNull();
    expect(cardsOf(container)).toHaveLength(ONE_YEAR.length);
  });

  it("고른 연도가 이 탭에 없으면 조용히 빈 목록을 만들지 않는다", async () => {
    // 두 해 모두 확인 필요 항목을 갖고 있으므로, 이 시나리오는 픽스처를 기다리지 않고 직접 만든다.
    // "확인 필요가 없는 해"를 고른 뒤 확인 필요 탭으로 옮기면 필터를 유지할 근거가 없다 —
    // 유지하면 빈 목록만 남고 사용자는 자기가 건 필터 때문인지 거래가 없는 건지 알 수 없다.
    const cleanNextYear = TWO_YEARS.filter(
      (event) =>
        yearOf(event) === FIXTURE_TAX_YEAR + 1 &&
        event.classification !== "UNKNOWN" &&
        event.price_status !== "UNKNOWN" &&
        event.confidence >= 0.5 &&
        // 방향·분류 모순도 확인 필요 항목이다 — "확인 필요 없는 해"를 만들려면 함께 걸러야 한다.
        !(event.classification === "RECEIVE" && event.direction === "OUT") &&
        !(event.classification === "SEND" && event.direction === "IN"),
    );
    expect(cleanNextYear.length).toBeGreaterThan(0);
    const baseYear = TWO_YEARS.filter((event) => yearOf(event) === FIXTURE_TAX_YEAR);
    serveEvents([...baseYear, ...cleanNextYear]);

    const { container } = renderTransactions();
    await settled(container);
    fireEvent.click(yearOption(openSheet(container, "year", "연도 필터"), FIXTURE_TAX_YEAR + 1).node);
    // 전체 탭에서는 고른 해만 남는다.
    expect(cardsOf(container)).toHaveLength(cleanNextYear.length);

    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(screen.queryByText("확인이 필요한 거래가 없습니다.")).not.toBeInTheDocument();
    // 남은 것은 기준 연도의 확인 필요 항목이다 — 걸어둔 연도가 스스로 풀렸다는 뜻이다.
    const reviewCards = cardsOf(container);
    expect(reviewCards.length).toBeGreaterThan(0);
    const reviewIds = new Set(reviewCards.map((card) => card.getAttribute("data-event-id")));
    expect([...reviewIds].every((id) => baseYear.some((event) => event.id === id))).toBe(true);
    // 이 탭에는 확인 필요 항목이 있는 해가 하나뿐이라 칩도 사라진다(체인 필터와 같은 규칙).
    expect(chipOf(container, "year")).toBeNull();
  });
});
