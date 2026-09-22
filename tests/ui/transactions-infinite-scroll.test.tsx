import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "@/components/transactions/transactions-view";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 거래 목록의 **창**(render window) — 받아 둔 것을 다 세되 그리는 것만 잘라 둔다.
 *
 * 창이 없던 때는 필터가 걸러 낸 행을 전부 그렸다. 실지갑 1,300건이면 행 하나가 여러 노드라
 * DOM이 만 개 단위로 불고, 검색어 한 글자마다 그 전부를 다시 조정하느라 화면이 멎었다.
 * 이 파일이 지키는 것은 넷이다: 처음엔 50줄만 그리는가, 눌러서·스크롤해서 더 볼 수 있는가,
 * 목록의 정체가 바뀌면 처음으로 돌아가는가, **배경 갱신은 창을 접지 않는가**.
 *
 * 마지막 하나가 이 창의 진짜 위험이다 — `rows` 참조로 창을 걸면 폴링·판정 재조회가 같은 목록을
 * 새 배열로 돌려주는 순간, 사용자가 300줄까지 펼쳐 둔 목록이 저절로 50줄로 접힌다.
 *
 * 요약 기간을 `{ from: "a", to: "b" }`로 두는 이유는 검색·스팸 테스트와 같다: 달력에 없는 기간이라
 * 판정 조회가 아예 비활성이 되어, 창 규칙만 보고 세무 엔진을 끌어들이지 않는다.
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
function event(id: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    ...source,
    id,
    tx_hash: `0x${id.padEnd(8, "0")}`,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...overrides,
  };
}

const many = (count: number, overrides: Partial<NormalizedEvent> = {}) =>
  Array.from({ length: count }, (_, index) => event(`row-${index}`, overrides));

const asItems = (events: NormalizedEvent[]) => events.map((item, index) => ({ event: item, version: index + 1 }));

function summary() {
  ports.getSummary.mockResolvedValue({
    periodPnl: "1",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    // 달력에 없는 기간 — 판정 조회가 비활성이라 이 파일은 창 규칙만 본다.
    period: { from: "a", to: "b" },
  });
}

/** 한 번에 다 내려주는 목록. 커서가 없으니 수집기는 한 번 왕복하고 끝난다(truncated=false). */
function serve(events: NormalizedEvent[]) {
  ports.list.mockResolvedValue({ items: asItems(events), nextCursor: null });
  summary();
}

/**
 * 잘린 목록. 서버가 **방금 쓴 커서를 그대로** 되돌려주면 수집기가 "같은 페이지"로 보고 멈추며
 * `truncated: true`로 끝낸다(bounded-event-collector). 한 판에 두 번만 왕복하므로
 * "창이 끝에 닿으면 더 이어 받는가"를 호출 횟수로 셀 수 있다.
 */
function serveTruncated(events: NormalizedEvent[]) {
  ports.list.mockImplementation(({ cursor }: { cursor?: string }) =>
    Promise.resolve({ items: cursor === undefined ? asItems(events) : [], nextCursor: "same-cursor" }),
  );
  summary();
}

function renderTransactions(props: { initialTab?: "all" | "review"; initialSpam?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TransactionsView {...props} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const rowIds = () => [...document.querySelectorAll("[data-event-id]")].map((node) => node.getAttribute("data-event-id"));
const windowLabel = () => document.querySelector('[data-surface="list-window"]')?.textContent ?? "";
const moreButton = () => screen.queryByRole("button", { name: "더 보기" });
const searchBox = () => screen.getByLabelText("거래 검색");

/**
 * jsdom에는 IntersectionObserver가 없다. 화면은 그 사실을 알고 「더 보기」로 물러서지만,
 * 관찰자가 **있을 때** 무엇을 하는지도 봐야 한다 — 그 경로가 실제 브라우저에서 도는 경로다.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  node: Element | null = null;
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(node: Element) {
    this.node = node;
  }

  disconnect() {
    this.disconnected = true;
  }

  unobserve() {}

  /** 바닥이 뷰포트(+600px 여유)에 들어온 순간. */
  fire() {
    this.callback([{ isIntersecting: true, target: this.node } as IntersectionObserverEntry], this as never);
  }
}

/** 지금 살아 있는 관찰자. 창이 늘 때마다 새로 달리므로 마지막 것을 집는다. */
const liveObserver = () => [...FakeIntersectionObserver.instances].reverse().find((item) => !item.disconnected)!;

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.estimate.mockReset();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("목록은 창으로 잘라 그린다", () => {
  it("120건이 와도 처음에는 50줄만 그리고, 몇 줄을 보고 있는지 말한다", async () => {
    serve(many(120));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));

    // 창을 말없이 자르면 목록이 50건짜리인 척한다 — 헤더가 말하는 전량과 갈리지 않도록 함께 적는다.
    expect(windowLabel()).toContain("50/120건");
    expect(screen.getByText("120건")).toBeInTheDocument();
    // 앞에서부터 자른다. 최신순 목록이라 "가장 최근 50건"이 남아야 한다.
    expect(rowIds()[0]).toBe("row-0");
    expect(rowIds()[49]).toBe("row-49");
  });

  it("「더 보기」로 50줄씩 늘고, 끝에 닿으면 버튼도 감시 대상도 사라진다", async () => {
    serve(many(120));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));

    fireEvent.click(moreButton()!);
    expect(rowIds()).toHaveLength(100);
    expect(windowLabel()).toContain("100/120건");

    fireEvent.click(moreButton()!);
    expect(rowIds()).toHaveLength(120);
    expect(windowLabel()).toContain("120/120건");
    // 다 그린 목록에 "더 보기"가 남아 있으면 눌러도 아무 일이 없는 버튼이 된다.
    expect(moreButton()).toBeNull();
    expect(document.querySelector('[data-surface="list-sentinel"]')).toBeNull();
  });

  it("목록이 창보다 짧으면 버튼 없이 건수만 말한다", async () => {
    serve(many(3));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(windowLabel()).toContain("3/3건");
    expect(moreButton()).toBeNull();
  });
});

describe("창을 되돌리는 것은 목록의 정체뿐이다", () => {
  it("검색어를 바꾸면 처음 50줄로 돌아간다", async () => {
    serve(many(120, { asset_symbol: "ETH" }));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));
    fireEvent.click(moreButton()!);
    expect(rowIds()).toHaveLength(100);

    // 좁힌 결과가 우연히 같은 120건이어도 **다른 목록**이다. 펼쳐 둔 창을 물려받으면
    // 사용자는 자기가 방금 친 검색어의 상위 몇 건이 아니라 100줄을 한꺼번에 받는다.
    fireEvent.change(searchBox(), { target: { value: "eth" } });
    expect(rowIds()).toHaveLength(50);
    expect(windowLabel()).toContain("50/120건");
  });

  it("탭을 바꾸면 처음 50줄로 돌아간다", async () => {
    serve(many(120, { price_status: "UNKNOWN" as const, fiat_value: null }));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));
    fireEvent.click(moreButton()!);
    expect(rowIds()).toHaveLength(100);

    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(rowIds()).toHaveLength(50);
    expect(windowLabel()).toContain("50/120건");
  });

  it("배경 갱신으로 배열이 새로 와도 창은 접히지 않는다", async () => {
    const events = many(120);
    serve(events);
    const { client } = renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));
    fireEvent.click(moreButton()!);
    expect(rowIds()).toHaveLength(100);

    // 같은 사실, 새 배열. 창을 `rows` 참조로 걸었다면 여기서 50줄로 접힌다.
    ports.list.mockResolvedValue({ items: asItems(events.map((item) => ({ ...item }))), nextCursor: null });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["events", "list"] });
    });

    expect(rowIds()).toHaveLength(100);
    expect(windowLabel()).toContain("100/120건");
  });
});

describe("바닥이 보이면 알아서 늘린다", () => {
  it("감시 대상이 뷰포트에 들어오면 창이 50줄 늘어난다", async () => {
    serve(many(120));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));
    expect(liveObserver().node).toBe(document.querySelector('[data-surface="list-sentinel"]'));

    act(() => liveObserver().fire());
    expect(rowIds()).toHaveLength(100);

    act(() => liveObserver().fire());
    expect(rowIds()).toHaveLength(120);
  });

  it("창이 목록 끝까지 덮었고 서버 쪽이 남았으면 다음 페이지를 이어 받는다", async () => {
    // 60건 + truncated. 한 판에 두 번 왕복하므로(커서 반복 감지) 호출 횟수로 이어 받기를 센다.
    serveTruncated(many(60));
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(50));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "더 불러오기" })).toBeInTheDocument());
    const roundsBefore = ports.list.mock.calls.length;

    // 아직 창 안에 안 그린 행이 남아 있다 — 이때는 서버가 아니라 창을 먼저 늘린다.
    act(() => liveObserver().fire());
    expect(rowIds()).toHaveLength(60);
    expect(ports.list.mock.calls.length).toBe(roundsBefore);

    // 창이 끝에 닿았다. 이제 더 달라고 한다(상한이 오르면 쿼리 키가 바뀌어 새로 수집한다).
    act(() => liveObserver().fire());
    await vi.waitFor(() => expect(ports.list.mock.calls.length).toBeGreaterThan(roundsBefore));
  });

  it("스팸 보기에서는 이어 받지 않는다 — 이미 받아 둔 배열이다", async () => {
    serveTruncated([...many(3), event("spam-row", { classification: "SPAM" as const })]);
    renderTransactions({ initialSpam: true });
    await vi.waitFor(() => expect(rowIds()).toEqual(["spam-row"]));

    // 다 그렸고 이어 받을 것도 없으므로 감시 대상 자체가 없다.
    expect(document.querySelector('[data-surface="list-sentinel"]')).toBeNull();
    expect(windowLabel()).toContain("1/1건");
  });
});
