import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "@/components/transactions/transactions-view";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 거래 화면이 새로 지는 것들 — 검색·스팸 보기·서버가 정한 첫 탭·필터 칩.
 *
 * 요약과 갈라지기 전에는 목록을 좁히는 문이 화면에 펼쳐진 필터 네 줄뿐이었고, 스팸은 건수만 말하고
 * 무엇이 걸렸는지는 볼 수 없었다. 이 파일이 지키는 것은 그 세 가지다: 사용자가 친 글자로 찾을 수 있는가,
 * 숨긴 것을 볼 수 있는가, 다른 화면에서 "확인 필요"를 눌러 왔을 때 그 탭에서 시작하는가.
 *
 * 요약 기간을 `{ from: "a", to: "b" }`로 두는 이유: 달력에 없는 기간이라 판정 조회가 아예 비활성이 된다.
 * 여기서 보려는 것은 목록을 좁히는 규칙이지 판정이 아니므로, 세무 엔진을 끌어들이지 않는다.
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

function serve(events: NormalizedEvent[]) {
  ports.list.mockResolvedValue({ items: events.map((item, index) => ({ event: item, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    // 달력에 없는 기간 — 판정 조회가 비활성이라 이 파일은 목록 규칙만 본다.
    period: { from: "a", to: "b" },
  });
}

function renderTransactions(props: { initialTab?: "all" | "review"; initialSpam?: boolean } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TransactionsView {...props} />
    </QueryClientProvider>,
  );
}

/** 지금 그려진 행의 id. 티커는 겹칠 수 있어 라벨로는 한 행을 집지 못한다. */
const rowIds = () => [...document.querySelectorAll("[data-event-id]")].map((node) => node.getAttribute("data-event-id"));

const searchBox = () => screen.getByLabelText("거래 검색");

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.estimate.mockReset();
});

describe("거래 검색", () => {
  const eth = event("eth-row", { asset_symbol: "ETH", counterparty: "0xaaaa111111111111111111111111111111111111", tx_hash: "0xdeadbeef11111111" });
  const usdc = event("usdc-row", { asset_symbol: "USDC", counterparty: "0xbbbb222222222222222222222222222222222222", tx_hash: "0xfeedface22222222" });

  it("자산 심볼로 좁힌다", async () => {
    serve([eth, usdc]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));

    fireEvent.change(searchBox(), { target: { value: "usdc" } });
    // 대소문자는 가르지 않는다 — 사용자가 티커를 소문자로 치는 쪽이 오히려 흔하다.
    expect(rowIds()).toEqual(["usdc-row"]);
  });

  it("상대 주소와 거래 해시의 일부로도 찾는다", async () => {
    serve([eth, usdc]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));

    // 주소는 길어 전부 칠 수 없다. 앞자리 몇 글자로 찾히지 않으면 검색이 있으나 마나다.
    fireEvent.change(searchBox(), { target: { value: "0xaaaa11" } });
    expect(rowIds()).toEqual(["eth-row"]);

    fireEvent.change(searchBox(), { target: { value: "feedface" } });
    expect(rowIds()).toEqual(["usdc-row"]);
  });

  it("찾은 것이 없으면 무엇으로 찾았는지 말한다", async () => {
    serve([eth, usdc]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));

    fireEvent.change(searchBox(), { target: { value: "존재하지않는토큰" } });
    // 그냥 "표시할 거래가 없습니다"라고만 하면 사용자는 필터 탓인지 오타 탓인지 알 수 없다.
    expect(screen.getByText("'존재하지않는토큰'로 찾은 거래가 없습니다.")).toBeInTheDocument();
    expect(rowIds()).toHaveLength(0);
  });

  it("검색어를 지우면 전부 돌아온다", async () => {
    serve([eth, usdc]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));

    fireEvent.change(searchBox(), { target: { value: "eth" } });
    expect(rowIds()).toEqual(["eth-row"]);
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(rowIds()).toHaveLength(2);
  });
});

describe("스팸 보기", () => {
  const clean = event("clean-row", { asset_symbol: "ETH" });
  const spam = event("spam-row", { asset_symbol: "SCAM", classification: "SPAM" as const });

  it("스팸은 원장에서 빠지되 몇 건인지 말하고, 눌러서 볼 수 있다", async () => {
    serve([clean, spam]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toEqual(["clean-row"]));

    // 조용히 빼면 목록이 완전한 것처럼 보이면서 거래가 사라진다.
    expect(screen.getByText(/스팸으로 분류된 1건은 목록·계산에서 빼고 있습니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    // 목록이 스팸 목록으로 갈아 끼워진다 — 원장 행과 섞이지 않는다.
    expect(rowIds()).toEqual(["spam-row"]);
    expect(screen.getByText(/보기 전용이라 계산에도, 확인 필요에도 들어가지 않습니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "원장으로 돌아가기" }));
    expect(rowIds()).toEqual(["clean-row"]);
  });

  it("?spam=1로 들어오면 스팸 목록에 바로 도착한다 — 설정의 '스팸 거래 보기'가 약속한 곳", async () => {
    serve([clean, spam]);
    renderTransactions({ initialSpam: true });
    await vi.waitFor(() => expect(rowIds()).toEqual(["spam-row"]));
    expect(screen.getByRole("button", { name: "원장으로 돌아가기" })).toBeInTheDocument();
  });

  it("?spam=1이어도 스팸이 없으면 원장을 보인다 — 돌아갈 버튼 없는 빈 목록에 가두지 않는다", async () => {
    serve([clean]);
    renderTransactions({ initialSpam: true });
    await vi.waitFor(() => expect(rowIds()).toEqual(["clean-row"]));
    expect(screen.queryByText(/보기 전용이라/)).not.toBeInTheDocument();
  });

  it("스팸 행은 보기 전용이라 열리지 않는다", async () => {
    serve([clean, spam]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toEqual(["clean-row"]));
    fireEvent.click(screen.getByRole("button", { name: "보기" }));

    // 되돌리기(SPAM → 다른 분류)를 서버가 받는지 확인하지 못했다. 열리는 상세에는 재분류가 있으므로
    // 지금은 아예 열지 않는다 — 눌러도 되돌릴 수 없는 버튼은 거짓말이다.
    expect(document.querySelector('button[data-event-id="spam-row"]')).toBeNull();
    expect(document.querySelector('div[data-event-id="spam-row"]')).not.toBeNull();
    expect(screen.queryByText("거래 상세")).not.toBeInTheDocument();
    // "되돌리기"라 부르는 문은 아직 없다.
    expect(screen.queryByRole("button", { name: /되돌리기/ })).not.toBeInTheDocument();
  });

  it("스팸이 없으면 고지도 보기 버튼도 두지 않는다", async () => {
    serve([clean]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toEqual(["clean-row"]));

    // 없는 문제를 말하면 화면이 늘 무언가 잘못된 것처럼 읽힌다.
    expect(document.querySelector('[data-surface="ledger-omissions"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "보기" })).not.toBeInTheDocument();
  });
});

describe("서버가 정한 첫 탭", () => {
  const clean = event("clean-row", { asset_symbol: "ETH" });
  const needsReview = event("review-row", { asset_symbol: "USDC", price_status: "UNKNOWN" as const, fiat_value: null });

  it("`?tab=review`로 들어오면 확인 필요 탭에서 시작한다", async () => {
    serve([clean, needsReview]);
    renderTransactions({ initialTab: "review" });
    await vi.waitFor(() => expect(rowIds()).toEqual(["review-row"]));

    expect(screen.getByRole("tab", { name: "확인 필요" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "전체 거래" })).toHaveAttribute("aria-selected", "false");

    // 첫 탭만 서버가 정한다. 그 뒤의 전환은 이 화면이 쥔다.
    fireEvent.click(screen.getByRole("tab", { name: "전체 거래" }));
    expect(rowIds()).toHaveLength(2);
  });

  it("쿼리가 없으면 전체 거래에서 시작한다", async () => {
    serve([clean, needsReview]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
    expect(screen.getByRole("tab", { name: "전체 거래" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("필터는 칩 한 줄이다", () => {
  const onEthereum = event("eth-1", { chain_id: 1 });
  const onOptimism = event("op-1", { chain_id: 10 });
  const onOptimism2 = event("op-2", { chain_id: 10 });

  it("칩을 누르면 시트가 열리고 항목마다 건수가 붙는다", async () => {
    serve([onEthereum, onOptimism, onOptimism2]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(3));

    // 네 줄을 펼쳐 두던 때는 첫 거래 행이 화면 한참 아래에서 시작했다. 이제 칩 한 줄이고 시트에서 고른다.
    const chip = document.querySelector('button[data-filter="chain"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("체인");
    expect(chip).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(chip);
    const sheet = screen.getByLabelText("체인 필터");
    const options = within(sheet).getAllByRole("button");
    // 첫 줄은 "전체 체인"이고 나머지가 체인별 줄이다. 건수는 "지금 고르면 남을 행 수"다.
    expect(options[0].textContent).toBe("전체 체인3건");
    const optimism = options.find((node) => node.textContent?.includes("Optimism"))!;
    expect(optimism.textContent).toContain("2건");

    fireEvent.click(optimism);
    // 고르면 시트가 닫히고, 칩이 지금 무엇으로 좁혀져 있는지 말한다.
    expect(screen.queryByLabelText("체인 필터")).not.toBeInTheDocument();
    expect(rowIds()).toEqual(["op-1", "op-2"]);
    expect(document.querySelector('button[data-filter="chain"]')!.textContent).toContain("Optimism");
  });

  it("선택지가 하나뿐인 필터는 칩을 그리지 않는다", async () => {
    serve([onOptimism, onOptimism2]);
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(2));

    // 눌러도 고를 것이 없는 칩은 자리만 차지한다.
    expect(document.querySelector('button[data-filter="chain"]')).toBeNull();
    expect(document.querySelector('button[data-filter="wallet"]')).toBeNull();
  });
});

describe("로딩 중에는 0건을 말하지 않는다", () => {
  it("거래 목록이 아직 오지 않았으면 헤더 건수·탭 배지가 0을 말하지 않는다", () => {
    // 정착하지 않는다 — events.isLoading이 계속 true인 순간을 붙잡는다(요약 화면과 같은 규칙).
    ports.list.mockReturnValue(new Promise(() => {}));
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    renderTransactions();

    // 기준 기간을 못 정해 판정을 계산하지 않는다는 고지도 role="status"라 같은 롤로 두 개가 뜬다 —
    // 텍스트로 짚어 그중 "불러오는 중" 고지가 role="status"임을 확인한다.
    expect(screen.getByText("거래를 불러오는 중입니다")).toHaveAttribute("role", "status");
    // 제목 옆 건수, "전체 거래"·"확인 필요" 탭 배지 어디에도 "0"이 사실인 척 나오면 안 된다.
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "전체 거래" }).textContent).not.toMatch(/0/);
    expect(screen.getByRole("tab", { name: "확인 필요" }).textContent).not.toMatch(/0/);
  });
});


describe("과세 대상 탭", () => {
  it("기간 내 과세 처분과 소득만 표시하고 원가 취득 및 면세 거래는 제외한다", async () => {
    const ids = ["disposal", "income", "acquisition", "exempt", "old"];
    serve(ids.map((id) => event(id)));
    ports.getSummary.mockResolvedValue({ currency: "KRW", period: { from: "2027-01-01T00:00:00Z", to: "2027-12-31T00:00:00Z" } });
    ports.estimate.mockResolvedValue({
      currency: "KRW", period: { from: "2027-01-01T00:00:00Z", to: "2028-01-01T00:00:00Z" },
      excludedEventIds: [], limitations: [], status: "CONFIRMED",
      judgments: ids.map((eventId, i) => ({ eventId, group: ["taxable", "income", "acquire", "exempt", "taxable"][i], inPeriod: i !== 4, amountKind: "cost", amount: "0" })),
    });
    renderTransactions();
    await vi.waitFor(() => expect(rowIds()).toHaveLength(5));
    fireEvent.click(screen.getByRole("tab", { name: /과세 대상/ }));
    await vi.waitFor(() => expect(rowIds().sort()).toEqual(["disposal", "income"]));
    expect(screen.getByText(/건별 납부 금액을 뜻하지 않습니다/)).toBeInTheDocument();
  });
});
