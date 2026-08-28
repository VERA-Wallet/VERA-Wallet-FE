import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { assetTicker, chainLabel, formatDate, formatFiat, formatSignedTokenAmount, formatTokenAmount, nativeSymbol, UTC_NOTICE } from "@/lib/format";
import { isoDay } from "@/lib/period";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { MockEventStore } from "@/tests/support/doubles/mock-event-store";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { effectiveClassification as effectiveClassificationOf, needsReview, reviewReason } from "@/lib/review";
import { computeTaxEstimate, taxYearFor } from "@/lib/tax/engine";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

// 화면에 나오면 즉시 눈에 띄도록 픽스처 금액과 겹치지 않는 값을 쓴다.
const LEAK_SENTINEL_AMOUNT = "987654.32";
/**
 * 이 스위트는 **한 해치 목록**을 본다. 픽스처는 기준 연도 뒤에 다음 해 배치를 붙이지만,
 * 그 해가 열리기 전 시각을 주면 배치가 비어 25건만 남는다.
 * 여기 오라클(`derived.excludedEventIds` 등)은 "픽스처의 해 == 화면이 판정하는 해"를 전제로 하고,
 * 두 해가 섞이면 2026년 거래가 "기간 밖"이 되어 오라클이 조용히 다른 것을 세게 된다.
 * 연도가 둘인 경우는 아래 "연도 필터" 스위트가 따로 본다.
 */
const SINGLE_YEAR_NOW = new Date(`${FIXTURE_TAX_YEAR + 1}-01-01T00:00:00.000Z`);
const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, SINGLE_YEAR_NOW);
const derived = deriveTaxEvents(events);
// 요약 기간이 픽스처와 어긋나면 화면이 거래 없는 해를 과세연도로 잡는다.
// 그러면 판정이 전부 비어도 테스트는 조용히 통과한다 — 기간은 픽스처에서 파생한다.
const FIXTURE_PERIOD = {
  from: events[0].block_timestamp,
  to: events.at(-1)!.block_timestamp,
};

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

// 실제 어댑터를 통과시켜 판정 계약(그룹·라벨·기간 스코프)까지 함께 검증한다.
// 판정 소스를 **현재 목록**에 연동한다. 원본 events에 고정하면
// 목록만 바꾼 테스트가 정착 후 옛 도장이 되돌아와도 통과해버린다.
let currentEvents: NormalizedEvent[] = events;
const engine = new TaxEngineService(() => currentEvents);

function setListEvents(next: NormalizedEvent[]) {
  currentEvents = next;
  ports.list.mockResolvedValue({ items: next.map((event) => ({ event, version: 1 })), nextCursor: null });
}
ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
ports.getSummary.mockResolvedValue({
  periodPnl: "1000",
  computableEventCount: 1,
  taxableEventCount: 1,
  pendingReviewCount: 1,
  currency: "KRW",
  period: FIXTURE_PERIOD,
});
ports.getById.mockImplementation(async (id: string) => ({
  event: events.find((event) => event.id === id)!,
  version: 1,
  override_history: [],
}));
ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));

let client0: QueryClient;

function renderDashboard(countryCode = "DE") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client0 = client;
  return render(
    <QueryClientProvider client={client}>
      <DashboardView countryCode={countryCode} />
    </QueryClientProvider>,
  );
}

function resetPorts() {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.reclassify.mockReset();
  ports.estimate.mockReset();
  currentEvents = events;
  ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "1000",
    computableEventCount: 1,
    taxableEventCount: 1,
    pendingReviewCount: 1,
    currency: "KRW",
    period: FIXTURE_PERIOD,
  });
  ports.getById.mockImplementation(async (id: string) => ({
    event: events.find((event) => event.id === id)!,
    version: 1,
    override_history: [],
  }));
  ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
}

// 테스트가 전역 목을 바꾸고 assertion 뒤에 되돌리면, 실패 한 번에 이후 전부가 오염된다.
afterEach(() => {
  vi.useRealTimers();
  resetPorts();
});

/** 목록 재조회 → 세금 엔진 재계산 → 재렌더 한 왕복이 정착하는 데 주는 시간. */
const SETTLE_TIMEOUT = 5000;

/**
 * 판정이 정착했는가.
 *
 * 예전에는 "독일 룰셋으로 판정 중"이라는 기준 카드 문구를 신호로 썼다. 그 카드는 세금 금액을
 * 내역 화면에 두 번째로 두는 자리였고 지금은 없다. 신호는 문구가 아니라 **행의 상태**다 —
 * 모든 카드가 "판정 확인 중"에서 벗어나면 판정이 도착한 것이다.
 */
async function settled() {
  await waitFor(
    () => {
      const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
      expect(cards.length).toBeGreaterThan(0);
      // 배지가 목록에서 빠진 뒤로 정착 신호는 텍스트가 아니라 **손익 블록의 존재**다.
      // 판정이 보류(inPeriod===null·중복/제외 아님)면 오른쪽 손익 블록(data-surface="event-gain")을
      // 아예 렌더하지 않는다 — 모든 카드가 그 블록을 가지면 판정이 정착한 것이다.
      expect(cards.every((card) => card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    },
    { timeout: SETTLE_TIMEOUT },
  );
}

function rowLabel(event: NormalizedEvent) {
  // 목록 티커 줄과 같은 규칙: 스왑은 "보낸 → 받은", 브릿지는 "출발 → 도착 · 자산",
  // NFT는 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커.
  if (event.swap_to_symbol !== null) return `${assetTicker(event)} → ${event.swap_to_symbol}`;
  if (event.bridge_dest_chain_id !== null) return `${formatSignedTokenAmount(event)} ${assetTicker(event)} · ${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`;
  if (event.token_id !== null) return assetTicker(event);
  return `${formatSignedTokenAmount(event)} ${assetTicker(event)}`;
}

/** 행을 id로 집는다 — 티커는 NFT 번호가 빠져 중복될 수 있어 라벨로는 한 행을 못 집는다. */
function rowById(id: string): HTMLButtonElement {
  const button = document.querySelector(`[data-event-id="${id}"]`);
  if (!button) throw new Error(`행을 찾지 못했다: ${id}`);
  return button as HTMLButtonElement;
}

/**
 * 행을 열어 거래 상세 시트를 반환한다.
 * 목록 재설계로 판정 도장·경고(취득/양도·계산 제외·중복·이동·미검증 등)가 목록에서 빠졌으므로,
 * 그 상태들은 이제 이 시트에서 확인한다.
 */
async function openDetail(id: string): Promise<HTMLElement> {
  fireEvent.click(rowById(id));
  await screen.findByText("거래 상세");
  return screen.getByText("거래 상세").closest("div")!.parentElement!;
}

describe("거래 탭이 세금 대신 판정 도장을 찍는다", () => {
  it("세금 금액은 내역 화면 어디에도 없다 — 그 자리에는 지갑 이력 그래프가 있다", async () => {
    // UI 계약은 엔진 구현과 분리한다. 같은 함수로 기대값을 만들면 엔진 결함이 함께 통과한다.
    const FIXED_CHARGE = "4242.42";
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return { ...base, totals: { ...base.totals, estimatedCharge: FIXED_CHARGE }, status: "SUPPORTED" as const };
    });
    renderDashboard("DE");
    await settled();

    // 부담·과세연도·기준 카드는 세금 탭 한 곳에서만 답한다. 내역이 같은 금액을 또 말하면
    // 두 화면 중 어느 쪽이 최신인지 알 수 없다.
    const body = document.body.textContent ?? "";
    expect(body, "세금 금액이 내역 화면에 새면 안 된다").not.toContain(formatFiat(FIXED_CHARGE, "EUR"));
    expect(body).not.toMatch(/년 세금/);
    expect(screen.queryByLabelText("판정 기준")).not.toBeInTheDocument();

    // 빈자리를 남기지 않는다 — 지갑 이력이 그린 선이 그 자리에 있다.
    expect(screen.getByLabelText("누적 순유입")).toBeInTheDocument();

    // 도장 자체는 남는다 — 금액만 사라진 것이지 판정까지 사라진 것이 아니다.
    // 목록 재설계로 도장은 목록이 아니라 상세에서 말한다: 매수(취득) 행을 열어 확인한다.
    const acquired = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "ACQUIRE"))!;
    const sheet = await openDetail(acquired.id);
    await waitFor(() => expect(sheet.textContent).toMatch(/이 손익이 계산에서 어떻게 쓰였나/), { timeout: SETTLE_TIMEOUT });
  });

  it("시행 전 국가에서도 내역은 부담을 말하지 않고 행 도장만 남긴다", async () => {
    // 한국은 2027-01-01 시행이라 2025년 발생분에는 부담이 존재하지 않는다.
    // 그 사실을 말할 자리는 세금 탭이고, 내역은 행마다 도장을 찍는다.
    const { container } = renderDashboard("KR");
    await settled();
    // 시행 가정 토글은 세금 탭의 것이라 대시보드엔 없다. 부담(세금 금액)도 내역에 없다.
    expect(screen.queryByRole("button", { name: "시행 가정으로 보기" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/년 세금|과세 대상 아님 · 부담|산출 불가/);
    expect(container.textContent).not.toContain("₩0");
    // "과세 대상 아님 · 2027 시행 전" 판정 도장은 목록에서 빠지고 이제 상세에서 말한다 —
    // 어느 처분의 거래 상세엔가 그 도장이 남아 있어야 한다(도장까지 사라진 것은 아니다).
    const rows = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")] as HTMLElement[];
    let stamped = false;
    for (const row of rows) {
      fireEvent.click(row);
      const sheet = (await screen.findByText("거래 상세")).closest("div")!.parentElement!;
      if (/2027 시행 전/.test(sheet.textContent ?? "")) {
        stamped = true;
        break;
      }
    }
    expect(stamped, "시행 전 판정 도장이 어느 거래 상세엔가 있어야 한다").toBe(true);
  });

  it("목록은 검증된 자산에 딱지를 남기지 않고 처리 방식 배지는 상세로 보낸다", async () => {
    renderDashboard("KR");
    // 픽스처 첫 건은 추정가이고, event-07은 사용자가 수동 분류한 건이다.
    const estimated = events.find((event) => event.price_status === "ESTIMATED")!;
    const overridden = events.find((event) => event.user_override !== null)!;
    const card = (await screen.findByText(rowLabel(estimated))).closest("button")!;

    // 정상(검증됨)은 기본값의 확인이라 소음이다 — 문제만 배지로 만든다(B1).
    // 픽스처는 전부 asset_verified: true이므로 목록에 "검증됨"·"미검증 토큰" 어느 쪽도 없어야 한다.
    expect(within(card).queryByText("검증됨")).not.toBeInTheDocument();
    expect(within(card).queryByText("미검증 토큰")).not.toBeInTheDocument();
    // 처리 방식(추정가·수동 분류)은 목록에서 빠지고 상세에서만 말한다.
    expect(within(card).queryByText("추정가")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("수동 분류됨");

    fireEvent.click(screen.getByText(rowLabel(overridden)));
    await screen.findByText("거래 상세");
    const sheet = screen.getByText("거래 상세").closest("div")!.parentElement!;
    expect(sheet.textContent).toContain("(추정)");
    expect(sheet.textContent).toContain("사용자 확정");
  });

  it("목록이 토큰을 심볼로 부른다", async () => {
    renderDashboard("KR");
    // 8453(Base)의 ERC20 픽스처 — "ERC20"이 아니라 토큰 이름이어야 한다.
    const token = events.find((event) => event.asset_type === "ERC20" && event.chain_id === 8453)!;
    expect(token.asset_symbol).toBe("USDC");
    expect(await screen.findByText(`${formatSignedTokenAmount(token)} USDC`)).toBeInTheDocument();

    // NFT는 컬렉션 심볼로 부른다. 개체 번호(#134)는 목록에서 빼고 거래 상세에서만 말한다.
    const nft = events.find((event) => event.token_id !== null && event.chain_id === 42161)!;
    expect(within(rowById(nft.id)).getByText(assetTicker(nft))).toBeInTheDocument();
    expect(within(rowById(nft.id)).queryByText(new RegExp(`#${nft.token_id}`))).not.toBeInTheDocument();
  });

  it("쓴 것과 얻은 것을 부호로 가른다", async () => {
    renderDashboard("KR");
    const received = events.find((event) => effectiveClassificationOf(event) === "RECEIVE" && event.token_id === null)!;
    const sent = events.find((event) => effectiveClassificationOf(event) === "SEND" && event.token_id === null)!;
    const moved = events.find((event) => effectiveClassificationOf(event) === "INTERNAL_TRANSFER")!;

    // 목록 재설계로 수량 티커는 muted(색으로 흐름을 말하지 않는다) — 흐름은 **부호(+/-)**로만 가른다.
    // 색만으로 구분하면 색을 못 보는 사용자에게는 아무 정보가 아니므로, 부호를 접근성 신호로 남긴다.
    expect(rowLabel(received).startsWith("+")).toBe(true);
    expect(rowLabel(sent).startsWith("-")).toBe(true);
    // 자기 지갑 간 이체는 처분이 아니라 부호를 붙이지 않는다.
    expect(rowLabel(moved)).not.toMatch(/^[+-]/);

    // 화면에도 그 부호가 그대로 실린다.
    expect(await screen.findByText(rowLabel(received))).toBeInTheDocument();
    expect(await screen.findByText(rowLabel(sent))).toBeInTheDocument();
  });

  it("체인별로 걸러 보고, 판정 필터와 겹쳐 걸 수 있다", async () => {
    const { container } = renderDashboard("KR");
    await settled();
    const cards = () => container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
    const all = cards();

    const chainRow = screen.getByLabelText("체인 필터");
    fireEvent.click(within(chainRow).getByRole("button", { name: /^Base/ }));
    const baseOnly = events.filter((event) => event.chain_id === 8453).length;
    expect(cards()).toBe(baseOnly);
    expect(cards()).toBeLessThan(all);
    // 체인은 이름 텍스트가 아니라 로고 배지로만 말한다(aria-hidden, data-chain-icon).
    for (const card of container.querySelectorAll("section .mt-3.grid.gap-3 > button")) {
      expect(card.querySelector('[data-chain-icon="8453"]')).not.toBeNull();
    }

    // 같은 칩을 다시 누르면 전체로 돌아온다.
    fireEvent.click(within(chainRow).getByRole("button", { name: /^Base/ }));
    expect(cards()).toBe(all);
  });

  it("목록이 자산마다 표식을 붙이고, 이미지가 없는 NFT는 NFT 박스로 그린다", async () => {
    renderDashboard("KR");
    // 로고는 (체인·컨트랙트)로만 해석한다. 네이티브 ETH는 컨트랙트 없이 체인으로 공식 로고를 얻는다.
    const nativeEth = events.find(
      (event) => event.asset_type === "NATIVE" && event.token_id === null && [1, 10, 8453, 42161].includes(event.chain_id),
    )!;
    // 픽스처의 ERC20은 합성 컨트랙트라 레지스트리에 없다 — 기억으로 로고를 그리지 않고 심볼 이니셜로 남긴다.
    const unregisteredToken = events.find(
      (event) => event.asset_type === "ERC20" && event.token_id === null && event.swap_to_symbol === null,
    )!;
    const nft = events.find((event) => event.token_id !== null)!;
    await settled();

    expect(rowById(nativeEth.id).querySelector('[data-token-icon="ETH"]')).not.toBeNull();
    expect(rowById(nativeEth.id).querySelector('[data-asset-mark="symbol"]')).toBeNull();
    // 미등록 컨트랙트는 대체 마크가 그 자리를 채운다(지어내지 않는다).
    expect(rowById(unregisteredToken.id).querySelector('[data-asset-mark="symbol"]')).not.toBeNull();
    expect(rowById(unregisteredToken.id).querySelector("[data-token-icon]")).toBeNull();
    const nftMark = rowById(nft.id).querySelector('[data-asset-mark="nft"]')!;
    expect(nftMark.textContent).toBe("NFT");

    // 마크 글자가 티커에 섞이면 목록이 자산 이름을 잘못 부르게 된다 — 티커는 심볼(번호 없음)뿐이어야 한다.
    expect(within(rowById(nft.id)).getByText(rowLabel(nft)).textContent).toBe(rowLabel(nft));
  });

  it("거래 행은 도장만 찍고, 금액이 세금이 아님은 상세가 라벨로 밝힌다", async () => {
    renderDashboard("DE");
    await settled();
    // 첫 매수 이벤트는 취득 판정을 받는다.
    const acquired = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "ACQUIRE"));
    expect(acquired).toBeDefined();
    const row = rowById(acquired!.id);
    // 취득은 처분이 아니라 실현 손익이 없다. 대신 목록은 손익 셀에 **거래 당시 평가액(₩)**을 보인다
    // (가격을 잃지 않는다). 이 값은 세금·취득가액이 아니라 거래 시점 평가액이다.
    const gainCell = row.querySelector('[data-surface="event-gain"]')!;
    expect(gainCell.textContent ?? "", "취득 행은 실현 손익 대신 거래 평가액을 보인다").toContain(
      formatFiat(acquired!.fiat_value, acquired!.fiat_currency),
    );
    // 손익 셀 밖에는 통화 금액이 새면 안 된다 — 취득가액 등 계산 근거는 상세에서만.
    const outside = row.cloneNode(true) as HTMLElement;
    outside.querySelector('[data-surface="event-gain"]')?.remove();
    expect(outside.textContent ?? "", "취득 행의 손익 셀 밖에는 통화 금액이 새면 안 된다").not.toMatch(/[€₩$]/);
    // 도장(취득)과 그 금액이 세금이 아니라 **취득가액**임은 이제 상세에서 밝힌다.
    fireEvent.click(row);
    const section = (await screen.findByText("이 손익이 계산에서 어떻게 쓰였나")).parentElement!;
    await waitFor(() => expect(section.textContent).toContain("취득가액"), { timeout: SETTLE_TIMEOUT });
    await waitFor(() => expect(section.textContent).toMatch(/취득/), { timeout: SETTLE_TIMEOUT });
  });

  it("계산에서 빠진 이벤트는 계산 제외 도장을 받고 확인 필요 탭과 같은 집합이다", async () => {
    renderDashboard("DE");
    await settled();
    expect(derived.excludedEventIds.length).toBeGreaterThan(0);
    const excluded = events.find((event) => derived.excludedEventIds.includes(event.id))!;
    // 확인 필요 탭에 반드시 있어야 한다(제외 ⊆ 확인 필요).
    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(rowById(excluded.id)).toBeInTheDocument();
    // "계산 제외" 도장은 이제 목록이 아니라 상세에서 말한다.
    const sheet = await openDetail(excluded.id);
    expect(sheet.textContent).toMatch(/계산에 들어가지 않았습니다/);
  });

  it("기존 탭 접근가능 이름과 거래 카드 구조를 유지한다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    expect(screen.getByRole("tab", { name: "전체 거래" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "확인 필요" })).toBeInTheDocument();
    // e2e 로케이터가 의존하는 구조.
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);
  });

  it("그룹 필터가 목록을 좁힌다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    const all = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
    const chip = screen.getByRole("button", { name: /^계산 제외/ });
    fireEvent.click(chip);
    const filtered = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
    expect(filtered).toBe(derived.excludedEventIds.length);
    expect(filtered).toBeLessThan(all);
  });
});

describe("판정도 제외도 아닌 거래가 침묵하지 않는다", () => {
  it("자기 지갑 간 이체는 처분이 아님을 상세에서 밝힌다", async () => {
    const internal = events.find((event) => event.classification === "INTERNAL_TRANSFER");
    expect(internal, "픽스처에 내부 이체가 있어야 한다").toBeDefined();
    // 내부 이체는 계산에도 제외 목록에도 없다 — 화면이 이유를 말하지 않으면 사용자는 누락으로 읽는다.
    expect(derived.events.some((tax) => tax.id === internal!.id)).toBe(false);
    expect(derived.excludedEventIds).not.toContain(internal!.id);

    renderDashboard("DE");
    await settled();
    // "이동 · 처분 아님" 도장은 목록에서 빠지고, 그 이유는 이제 상세가 문장으로 밝힌다.
    const sheet = await openDetail(internal!.id);
    expect(sheet.textContent).toMatch(/자기 지갑 간 이체라 처분으로 보지 않았습니다/);
  });
});

describe("아키텍트가 지적한 P1 경계", () => {
  it("비역년 국가는 룰셋 기간 기준으로 과세연도를 정한다", () => {
    // 영국 2025 과세연도는 2025-04-06~2026-04-06. 달력 연도를 쓰면 FY2024 거래를 2025로 오인한다.
    expect(taxYearFor("GB", "2025-01-10T00:00:00.000Z")).toBe(2024);
    expect(taxYearFor("GB", "2025-05-10T00:00:00.000Z")).toBe(2025);
    expect(taxYearFor("AU", "2025-03-10T00:00:00.000Z")).toBe(2024);
    expect(taxYearFor("AU", "2025-08-10T00:00:00.000Z")).toBe(2025);
    expect(taxYearFor("DE", "2025-03-10T00:00:00.000Z")).toBe(2025);
  });

  it("어느 거래도 상세에서 침묵하지 않는다 — 판정·상태를 상세가 반드시 밝힌다", async () => {
    // 목록 재설계로 판정 도장이 목록에서 빠졌으므로, "침묵하는 카드가 없다"는 이제 상세에서 지킨다:
    // 모든 거래의 상세는 판정(취득·과세…)이나 상태(제외·중복·이동·보류)를 문장/도장으로 말해야 한다.
    const { container } = renderDashboard("DE");
    await settled();
    const rows = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")] as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    // 판정 유무는 편집 폼의 "취득가액" 같은 라벨이 아니라, 판정을 말하는 섹션·상태 문장으로 가른다.
    const stated = /이 손익이 계산에서 어떻게 쓰였나|손익은 이렇게 나왔습니다|계산에 들어가지 않았습니다|처분으로 보지 않았습니다|같은 이벤트 id가 두 번 이상|판정 결과를 아직 불러오는 중입니다|판정 결과를 불러오지 못했습니다|과세기간 계산에서 판정을 찾지 못했습니다|밖이라 이 계산에|기준 기간을 확인하지 못해/;
    for (const row of rows) {
      fireEvent.click(row);
      const sheet = (await screen.findByText("거래 상세")).closest("div")!.parentElement!;
      await waitFor(
        () => expect(stated.test(sheet.textContent ?? ""), `상세가 침묵한 거래: ${row.getAttribute("data-event-id")}`).toBe(true),
        { timeout: SETTLE_TIMEOUT },
      );
    }
  });

  it("자기 지갑 간 이체는 실현손익에도 들어가지 않는다", () => {
    const internal: NormalizedEvent = {
      ...events[0],
      id: "internal-pnl",
      classification: "INTERNAL_TRANSFER",
      user_override: null,
      price_status: "RESOLVED",
      fiat_value: "1000.00",
      direction: "OUT",
    };
    // 판정은 "처분 아님"인데 손익에 +1,000이 잡히면 화면이 두 이야기를 한다.
    const summary = new MockEventStore([internal]).summary();
    expect(summary.periodPnl).toBe("0");
    expect(deriveTaxEvents([internal]).events).toHaveLength(0);
  });

  it("재분류 성공 시 세금 판정 캐시를 무효화한다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const target = events.find((event) => event.classification === "UNKNOWN") ?? events[0];
    ports.reclassify.mockResolvedValue({
      status: "ok",
      event: { ...target, classification: "RECEIVE" },
      version: 2,
    });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    // 분류가 바뀌면 판정 도장도 바뀌어야 하므로 tax estimate 캐시를 버려야 한다.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tax", "estimate"] }));
  });
});

describe("2차 리뷰 P1 경계", () => {
  it("중복 id는 확인 필요에 잡히고 첫 건의 판정을 재사용하지 않는다", async () => {
    const base = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    const dupes = [
      { event: base, version: 1 },
      { event: { ...base }, version: 1 },
    ];
    ports.list.mockResolvedValueOnce({ items: dupes, nextCursor: null });
    renderDashboard("DE");
    await settled();

    const cards = screen.getAllByText(rowLabel(base)).map((node) => node.closest("button")!);
    expect(cards).toHaveLength(2);
    // 두 번째 레코드는 첫 건의 판정을 물려받지 않는다 — "중복 · 확인 필요"는 이제 상세가 밝힌다.
    fireEvent.click(cards[1]);
    const sheet = (await screen.findByText("거래 상세")).closest("div")!.parentElement!;
    expect(sheet.textContent).toMatch(/같은 이벤트 id가 두 번 이상 들어와/);
    // 확인 필요 탭에도 반드시 잡혀야 한다 — 아니면 사용자가 고칠 곳이 없다.
    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(screen.getAllByText(rowLabel(base)).length).toBeGreaterThan(0);
  });

  it("재분류 충돌 응답에도 판정 캐시를 무효화한다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const target = events[0];
    ports.reclassify.mockResolvedValueOnce({
      status: "conflict",
      event: { ...target, classification: "SEND" },
      version: 2,
    });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    // 충돌 응답도 최신 이벤트를 실어 오므로 옛 도장이 남으면 안 된다.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tax", "estimate"] }));
  });

  it("판정이 아직 없으면 계산 결과 없음이라 단정하지 않는다", async () => {
    // estimate가 끝내 도착하지 않으면 기간 판단을 보류해야 한다.
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    const { container } = renderDashboard("DE");
    // 이벤트 목록은 도착하지만 판정은 계속 pending인 상태를 만든다.
    await screen.findByText(rowLabel(events[0]));
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    // 보류(판정 미도착)는 목록에서 '손익 블록의 부재'로 나타난다 — 값을 단정하지 않는다.
    // 중복·제외처럼 판정과 무관하게 이미 결정된 카드만 손익 블록을 가질 수 있는데, 여기선 그런 카드가 없다.
    const pending = cards.filter((card) => !card.querySelector('[data-surface="event-gain"]'));
    expect(pending.length).toBeGreaterThan(0);
    // 상세도 "계산 결과 없음"이라 단정하지 않고, 아직 불러오는 중이라 밝힌다.
    const sheet = await openDetail(events[0].id);
    expect(sheet.textContent).not.toMatch(/계산 결과 없음/);
    expect(sheet.textContent).toMatch(/판정 결과를 아직 불러오는 중입니다/);
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  });
});

describe("중복 판정이 필터에 따라 뒤집히지 않는다", () => {
  it("확인 필요 탭에서도 두 번째 레코드가 첫 건의 판정을 물려받지 않는다", async () => {
    // 첫 건은 확인 필요가 아니고 두 번째만 중복이라, 확인 필요 탭에는 두 번째만 남는다.
    // 렌더 순서로 중복을 다시 계산하면 그 한 건이 "첫 건"이 되어 판정을 물려받는 결함이 있었다.
    const clean = events.find(
      (event) => !needsReview(event) && derived.events.some((tax) => tax.id === event.id),
    )!;
    ports.list.mockResolvedValueOnce({
      items: [
        { event: clean, version: 1 },
        { event: { ...clean }, version: 1 },
      ],
      nextCursor: null,
    });
    renderDashboard("DE");
    await settled();

    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    const cards = screen.getAllByText(rowLabel(clean)).map((node) => node.closest("button")!);
    expect(cards).toHaveLength(1);
    // '중복'은 이제 상세가 밝히고, 첫 건의 '취득' 판정을 물려받지 않는다.
    fireEvent.click(cards[0]);
    const sheet = (await screen.findByText("거래 상세")).closest("div")!.parentElement!;
    expect(sheet.textContent).toMatch(/같은 이벤트 id가 두 번 이상 들어와/);
    // 중복은 판정 섹션(취득 도장)을 물려받지 않는다 — 폼 라벨이 아니라 판정 섹션 유무로 본다.
    expect(sheet.textContent).not.toMatch(/이 손익이 계산에서 어떻게 쓰였나/);
  });
});

describe("3차 리뷰 P1 경계", () => {
  const highConfidenceInternal = {
    ...events[0],
    id: "internal-dup",
    classification: "INTERNAL_TRANSFER" as const,
    user_override: null,
    price_status: "RESOLVED" as const,
    fiat_value: "1000.00",
    confidence: 0.9,
  };

  it("중복 레코드 상세는 내부 이체보다 중복을 먼저 말한다", async () => {
    ports.list.mockResolvedValueOnce({
      items: [
        { event: highConfidenceInternal, version: 1 },
        { event: { ...highConfidenceInternal }, version: 1 },
      ],
      nextCursor: null,
    });
    renderDashboard("DE");
    await settled();
    const cards = screen.getAllByText(rowLabel(highConfidenceInternal)).map((n) => n.closest("button")!);
    fireEvent.click(cards[1]);
    // "중복 · 확인 필요"는 이제 상세가 밝힌다. 상세가 "확인이 필요한 건이 아니라"고 하면 정면 모순이다.
    expect(await screen.findByText(/같은 이벤트 id가 두 번 이상 들어와/)).toBeInTheDocument();
    expect(screen.queryByText(/확인이 필요한 건이 아니라/)).not.toBeInTheDocument();
  });

  it("중복 레코드는 취득 같은 판정 그룹 필터에 끼지 않는다", async () => {
    const clean = events.find(
      (event) => !needsReview(event) && derived.events.some((tax) => tax.id === event.id),
    )!;
    ports.list.mockResolvedValueOnce({
      items: [
        { event: clean, version: 1 },
        { event: { ...clean }, version: 1 },
      ],
      nextCursor: null,
    });
    const { container } = renderDashboard("DE");
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^취득/ }));
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    // 칩 건수는 고유 이벤트 기준이므로 카드도 1장이어야 한다.
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).not.toMatch(/중복 id/);
  });

  it("판정 조회가 실패하면 로딩이라 말하지 않는다", async () => {
    // 재시도까지 전부 실패시켜야 isError가 뜬다.
    ports.estimate.mockRejectedValue(new Error("boom"));
    const { container } = renderDashboard("DE");
    await screen.findByText(/세금 판정을 불러오지 못해/, undefined, { timeout: 3000 });
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    // 오류에도 목록은 값을 지어내지 않는다 — 판정 손익 블록을 렌더하지 않는다(보류와 같은 '부재').
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => !card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    // 상세는 '로딩 중'이 아니라 '불러오지 못했다'고 밝힌다 — 오류를 로딩으로 위장하지 않는다.
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    const sheet = await openDetail(target.id);
    expect(sheet.textContent).toMatch(/판정 결과를 불러오지 못했습니다/);
    expect(sheet.textContent).not.toMatch(/아직 불러오는 중/);
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  });
});

describe("그룹 칩 건수가 실제 카드 수와 같은가", () => {
  it("중복 레코드가 있어도 모든 칩에서 건수와 카드 수가 일치한다", async () => {
    const clean = events.find(
      (event) => !needsReview(event) && derived.events.some((tax) => tax.id === event.id),
    )!;
    ports.list.mockResolvedValueOnce({
      items: [
        ...events.map((event) => ({ event, version: 1 })),
        { event: { ...clean }, version: 1 },
      ],
      nextCursor: null,
    });
    const { container } = renderDashboard("DE");
    await settled();

    // 전체 탭과 확인 필요 탭 모두에서, 체인 칩·판정 칩 어느 쪽을 눌러도 칩 건수 == 카드 수여야 한다.
    for (const tabName of ["전체 거래", "확인 필요"] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tabName }));
      // 스냅샷 NodeList를 재사용하면 리렌더로 교체된 노드를 눌러 아무 일도 일어나지 않는다.
      // 필터가 둘로 늘어난 뒤 실제로 그 증상이 났다 — 매번 다시 조회한다.
      const allChips = () => [
        ...container.querySelectorAll('[aria-label="체인 필터"] button, [aria-label="판정 필터"] button'),
      ];
      const chipsNow = () => allChips().filter((chip) => !/^전체/.test(chip.textContent ?? ""));
      // 필터 하나를 재는 동안 다른 하나가 걸려 있으면 안 된다. 매번 두 줄을 모두 푼다.
      const reset = () => {
        for (const label of ["전체 체인", "전체"]) {
          const button = allChips().find((chip) => chip.textContent === label);
          if (button) fireEvent.click(button);
        }
      };
      for (let index = 0; index < chipsNow().length; index += 1) {
        reset();
        const label = chipsNow()[index].textContent ?? "";
        const expected = Number(label.match(/(\d+)\s*$/)?.[1]);
        expect(Number.isFinite(expected), `칩 라벨에 건수가 없다: ${label}`).toBe(true);
        fireEvent.click(chipsNow()[index]);
        const cards = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
        expect(cards, `${tabName} 탭 칩 "${label}"의 건수와 카드 수가 다르다`).toBe(expected);
      }
      reset();
    }
  });

  it("판정 조회가 실패하면 그룹 필터가 조용히 빈 목록을 만들지 않는다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^취득/ }));
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);

    ports.estimate.mockRejectedValue(new Error("boom"));
    await client0.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await screen.findByText(/세금 판정을 불러오지 못해/, undefined, { timeout: 3000 });
    // 필터를 유지하면 빈 목록만 남아 원인을 알 수 없다.
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  });
});

describe("4차 리뷰 P1 경계 — 오래된 상태가 최신인 척하지 않는다", () => {
  it("판정 조회가 실패하면 캐시된 옛 도장을 쓰지 않는다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    // 먼저 성공시켜 도장을 받는다 — 판정(취득) 섹션은 이제 상세에 있다.
    await settled();
    const sheet = await openDetail(target.id);
    expect(sheet.textContent).toMatch(/이 손익이 계산에서 어떻게 쓰였나/);

    // 이후 재조회를 실패시키면 옛 도장이 최신 진실인 척하면 안 된다.
    ports.estimate.mockRejectedValue(new Error("boom"));
    await client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    rerender(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/세금 판정을 불러오지 못해/, undefined, { timeout: 3000 });
    // 열린 상세가 옛 판정(취득) 섹션을 남기지 않고 오류를 밝힌다(로딩으로도 위장하지 않는다).
    await waitFor(() => expect(sheet.textContent).toMatch(/판정 결과를 불러오지 못했습니다/), { timeout: SETTLE_TIMEOUT });
    expect(sheet.textContent).not.toMatch(/이 손익이 계산에서 어떻게 쓰였나/);
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  });

  it("선택한 거래가 목록에서 사라지면 시트가 옛 데이터를 계속 보여주지 않는다", async () => {
    const target = events[0];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");

    // 목록이 갱신되어 해당 거래가 사라진 상황.
    ports.list.mockResolvedValue({
      items: events.filter((event) => event.id !== target.id).map((event) => ({ event, version: 1 })),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });
    await waitFor(() =>
      expect(screen.getByText(/이 거래가 목록에서 사라졌습니다/)).toBeInTheDocument(),
    );
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });

  it("요약 조회가 실패하면 옛 집계를 최신인 척 보이지 않는다", async () => {
    ports.getSummary.mockRejectedValue(new Error("boom"));
    renderDashboard("DE");
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    // 한 카드만 비고 다른 카드가 옛 값을 유지해도 통과하면 안 된다.
    expect(screen.getByText("예상 손익").parentElement?.textContent).toContain("—");
    // 요약이 실패하면 "과세 대상"이라 단정할 근거도 없다.
    expect(screen.getByText("계산 대상 이벤트").parentElement?.textContent).toContain("—");
    // 요약 카드에 옛 집계가 남으면 안 된다(행의 거래액은 별개다).
    expect(screen.getByText("예상 손익").parentElement?.textContent).not.toMatch(/\d/);
    expect(screen.getByText("계산 대상 이벤트").parentElement?.textContent).not.toContain("1건");
    ports.getSummary.mockResolvedValue({
      periodPnl: "1000",
      computableEventCount: 1,
      taxableEventCount: 1,
      pendingReviewCount: 1,
      currency: "KRW",
      period: FIXTURE_PERIOD,
    });
  });
});

describe("5차 리뷰 P1 경계 — 열린 시트가 외부 변경을 반영한다", () => {
  it("다른 곳에서 분류가 바뀌면 시트가 최신 분류로 따라가고 경고한다", async () => {
    const target = events.find((event) => effectiveClassificationOf(event) === "RECEIVE")!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    expect((screen.getByLabelText("분류") as HTMLSelectElement).value).toBe("RECEIVE");

    // 외부에서 같은 id를 SEND/version 2로 바꿨다.
    ports.list.mockResolvedValue({
      items: events.map((event) =>
        event.id === target.id
          ? { event: { ...event, classification: "SEND" as const, user_override: null }, version: 2 }
          : { event, version: 1 },
      ),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });

    // 목록은 송금인데 시트가 수신을 보이면 화면이 두 이야기를 한다.
    await waitFor(() =>
      expect((screen.getByLabelText("분류") as HTMLSelectElement).value).toBe("SEND"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("다른 곳에서 변경됨, 다시 확인");
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });

  it("탭에 없는 그룹 필터는 조용히 빈 목록을 만들지 않는다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    // 취득 칩은 전체 탭에만 있고 확인 필요 탭에는 없다.
    fireEvent.click(screen.getByRole("button", { name: /^취득/ }));
    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(screen.queryByText("확인이 필요한 거래가 없습니다.")).not.toBeInTheDocument();
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);
  });
});

describe("자기 변경을 외부 변경으로 오인하지 않는다", () => {
  it("내가 재분류해 version이 올라도 '다른 곳에서 변경됨' 경고를 띄우지 않는다", async () => {
    const target = events[0];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    ports.reclassify.mockResolvedValueOnce({
      status: "ok",
      event: { ...target, classification: "SEND" },
      version: 2,
    });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    // 내가 만든 변경이므로 "다른 곳에서 변경됨"은 거짓이다.
    await waitFor(() => expect(screen.getByText("분류를 저장했습니다.")).toBeInTheDocument());
    expect(screen.queryByText("다른 곳에서 변경됨, 다시 확인")).not.toBeInTheDocument();

    // 이후 목록이 새 version으로 갱신돼도 마찬가지다.
    ports.list.mockResolvedValue({
      items: events.map((event) =>
        event.id === target.id
          ? { event: { ...event, classification: "SEND" as const }, version: 2 }
          : { event, version: 1 },
      ),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });
    await waitFor(() => expect(screen.getByText(rowLabel(target))).toBeInTheDocument());
    expect(screen.queryByText("다른 곳에서 변경됨, 다시 확인")).not.toBeInTheDocument();
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("6차 리뷰 P1 경계", () => {
  it("목록 버전이 오르면 옛 도장을 최신 분류 옆에 남기지 않는다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    // 초기 상태: RECEIVE(취득) 행이 최신순 라벨(+)로 있다. '취득' 도장 자체는 이제 상세에 있다.
    expect(rowById(target.id)).toBeInTheDocument();

    // 외부에서 분류가 바뀌어 목록만 갱신된 상태.
    // 판정 소스까지 함께 바꿔야 "정착 후에도 옛 도장이 없다"를 증명할 수 있다.
    // 분류가 바뀌면 카드 제목의 부호도 함께 바뀐다(RECEIVE `+` → SEND `-`) — 갱신 후 라벨로 찾아야 한다.
    const updatedTarget = { ...target, classification: "SEND" as const, user_override: null };
    const updated = events.map((event) => (event.id === target.id ? updatedTarget : event));
    currentEvents = updated;
    ports.list.mockResolvedValue({
      items: updated.map((event) => ({ event, version: event.id === target.id ? 2 : 1 })),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });

    // 판정이 정착할 때까지 기다린 뒤, 최신 분류 옆에 옛 판정이 없는지 본다.
    // 목록 무효화 → 재조회 → 세금 엔진 재계산 → 재렌더 왕복이라 병렬 부하에서 1초를 넘길 수 있다.
    // 단언은 그대로 두고 이 대기에만 인내심을 준다(전역으로 늘리면 무관한 실패 진단이 늦어진다).
    await waitFor(
      () => {
        // 최신 분류(SEND, 부호 -)로 행이 찾힌다는 것 자체가 옛 취득(+) 라벨이 남지 않았다는 뜻이고,
        // 손익 블록이 있으면(보류 아님) 판정이 정착해 옛 도장을 최신인 척 달지 않은 것이다.
        const card = screen.getByText(rowLabel(updatedTarget)).closest("button")!;
        expect(card.querySelector('[data-surface="event-gain"]')).not.toBeNull();
      },
      { timeout: SETTLE_TIMEOUT },
    );
  });

  it("커서가 남으면 다음 페이지까지 이어 받는다", async () => {
    const half = Math.floor(events.length / 2);
    ports.list.mockImplementation(async (input: { cursor?: string }) =>
      input?.cursor
        ? { items: events.slice(half).map((event) => ({ event, version: 1 })), nextCursor: null }
        : { items: events.slice(0, half).map((event) => ({ event, version: 1 })), nextCursor: "c1" },
    );
    const { container } = renderDashboard("DE");
    await settled();
    // 커서를 버리면 뒷페이지 거래가 화면에서 통째로 사라진다.
    await waitFor(() =>
      expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBe(events.length),
    );
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("목록을 다 못 받았으면 그 사실을 말한다", () => {
  it("커서가 반복되면 멈추고 일부만 불러왔다고 알린다", async () => {
    // 서버가 같은 커서를 계속 주면 같은 페이지를 무한히 쌓게 된다.
    ports.list.mockImplementation(async () => ({
      items: events.slice(0, 2).map((event) => ({ event, version: 1 })),
      nextCursor: "same",
    }));
    renderDashboard("DE");
    expect(await screen.findByText(/일부만 불러옴/)).toBeInTheDocument();
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("7차 리뷰 P1 경계 — 보류 중에 옛 사실을 단정하지 않는다", () => {
  it("제외였던 거래가 유효 분류로 바뀌면 옛 '계산 제외' 도장이 남지 않는다", async () => {
    const excluded = events.find((event) => derived.excludedEventIds.includes(event.id))!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    // 초기: '계산 제외'는 이제 상세가 문장으로 밝힌다.
    const sheet = await openDetail(excluded.id);
    expect(sheet.textContent).toMatch(/계산에 들어가지 않았습니다/);

    // 외부에서 유효 분류로 확정됐고 목록만 먼저 갱신된 상태.
    const fixed = {
      ...excluded,
      classification: "RECEIVE" as const,
      price_status: "RESOLVED" as const,
      fiat_value: "1000.00",
      user_override: null,
    };
    // 판정 소스도 함께 바꿔야 "정착 후에도 제외가 아니다"를 증명할 수 있다.
    const updated = events.map((event) => (event.id === excluded.id ? fixed : event));
    currentEvents = updated;
    ports.list.mockResolvedValue({
      items: updated.map((event) => ({ event, version: event.id === excluded.id ? 2 : 1 })),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });

    await waitFor(
      () => {
        // 정착 후, 열린 상세가 옛 '계산 제외'를 남기지 않고 판정(취득) 섹션으로 바뀐다(옛 도장을 최신인 척 달지 않는다).
        expect(sheet.textContent).toMatch(/이 손익이 계산에서 어떻게 쓰였나/);
        expect(sheet.textContent).not.toMatch(/계산에 들어가지 않았습니다/);
      },
      { timeout: SETTLE_TIMEOUT },
    );
  });

  it("외부 버전 변경 시 요약 카드도 함께 갱신한다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    invalidate.mockClear();

    ports.list.mockResolvedValue({
      items: events.map((event, index) => ({ event, version: index === 0 ? 2 : 1 })),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });

    // 요약만 옛 건수를 말하면 화면이 두 이야기를 한다.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "summary"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tax", "estimate"] });
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("판정 보류 중에는 칩도 함께 보류한다", () => {
  it("카드가 '판정 확인 중'이면 그룹 칩이 옛 건수를 단정하지 않는다", async () => {
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    const { container } = renderDashboard("DE");
    await screen.findByText(rowLabel(events[0]));

    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    // 판정 보류는 목록에서 손익 블록의 '부재'로 나타난다(적어도 한 카드가 보류다).
    expect(cards.some((card) => !card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    // 카드가 판정을 모른다는데 칩이 "취득 10"이라 하면 두 이야기다.
    const chips = [...container.querySelectorAll('[aria-label="판정 필터"] button[aria-pressed]')].filter(
      (chip) => !/^전체/.test(chip.textContent ?? ""),
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([]);
    // 체인은 판정이 아니라 온체인 사실이라 판정을 기다리는 동안에도 고를 수 있다.
    expect(container.querySelector('[aria-label="체인 필터"]')).not.toBeNull();
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  });
});

describe("남은 WATCH 항목 회귀", () => {
  it("편집 중인 입력을 외부 동기화가 덮어쓰지 않는다", async () => {
    const target = events[0];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");

    // 사용자가 편집 중이다.
    fireEvent.change(screen.getByLabelText("분류"), { target: { value: "EXCHANGE" } });
    fireEvent.change(screen.getByLabelText(/사유/), { target: { value: "작업중" } });

    ports.list.mockResolvedValue({
      items: events.map((event) =>
        event.id === target.id
          ? { event: { ...event, classification: "SEND" as const, user_override: null }, version: 2 }
          : { event, version: 1 },
      ),
      nextCursor: null,
    });
    await client.invalidateQueries({ queryKey: ["events", "list"] });

    // 경고는 뜨되 작업하던 입력은 살아있어야 한다.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("다른 곳에서 변경됨"));
    expect((screen.getByLabelText("분류") as HTMLSelectElement).value).toBe("EXCHANGE");
    expect((screen.getByLabelText(/사유/) as HTMLInputElement).value).toBe("작업중");
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });

  it("목록이 잘렸으면 더 불러올 수 있다", async () => {
    let calls = 0;
    ports.list.mockImplementation(async () => {
      calls += 1;
      return { items: events.slice(0, 2).map((event) => ({ event, version: 1 })), nextCursor: `c${calls}` };
    });
    renderDashboard("DE");
    await screen.findByText(/일부만 불러옴/);
    const before = calls;
    fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
    // 경고만 띄우고 막으면 "전체 거래"가 거짓이다. 계속 받을 수 있어야 한다.
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("파생 표면 전체가 '지금 것인가'를 지킨다", () => {
  it("판정 재조회 중에는 행이 옛 도장을 최신인 척 달지 않는다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    // 판정이 도착하면 행 오른쪽에 손익 블록이 있다(취득은 "—").
    expect(rowById(target.id).querySelector('[data-surface="event-gain"]')).not.toBeNull();

    // 재조회를 멈춰 세운다. 이때 옛 판정을 최신인 척 남기면 거짓이다 —
    // 목록은 손익 블록을 거두어(보류로 되돌아감) 옛 값을 최신인 척 달지 않는다.
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await waitFor(() => expect(rowById(target.id).querySelector('[data-surface="event-gain"]')).toBeNull());
  });

  it("비교 국가와 한계 기여도도 재조회 중이면 옛 값을 보이지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    await screen.findByText("다른 나라였다면");
    // 비교 국가 결과가 정착할 때까지 기다린다.
    await waitFor(() =>
      expect(screen.getByText("다른 나라였다면").parentElement!.textContent).not.toMatch(/확인하는 중입니다/),
    );

    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await waitFor(() => {
      const sheet = screen.getByText("다른 나라였다면").parentElement!;
      expect(sheet.textContent).toMatch(/확인하는 중입니다/);
    });
  });

  it("상세 재조회 중에는 옛 재분류 이력을 현재 이력처럼 보이지 않는다", async () => {
    const target = events[0];
    ports.getById.mockResolvedValue({
      event: target,
      version: 1,
      override_history: [
        { from: "UNKNOWN", to: "RECEIVE", reason: "예전이력", overridden_at: "2025-01-01T00:00:00.000Z" },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    await screen.findByText(/예전이력/);

    ports.getById.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["events", "detail", target.id] });
    await waitFor(() => expect(screen.queryByText(/예전이력/)).not.toBeInTheDocument());
  });
});

describe("믿을 수 있는 기간이 없으면 과세연도를 단정하지 않는다", () => {
  it("요약이 실패하면 화면이 판정을 계산하지 않았다고 밝힌다", async () => {
    ports.getSummary.mockRejectedValue(new Error("boom"));
    renderDashboard("DE");
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    // 지갑 기간을 모르는데 "2026년 세금"이라 말하면 근거 없는 단정이다.
    expect(document.body.textContent ?? "").not.toMatch(/년 세금/);
    // 요청조차 하지 않았으므로 "불러오는 중"이라 말하면 없는 진행을 지어내는 것이다.
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/세금 판정을 불러오지 못해/)).not.toBeInTheDocument();

    // 목록도 같은 말을 해야 한다. 기준 기간을 모르면 판정을 계산하지 않으므로,
    // 모든 행이 손익 블록을 갖지 않는다(값을 단정하지 않음 — 보류를 진행 중이라 말하지 않는다).
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => !card.querySelector('[data-surface="event-gain"]'))).toBe(true);
    // 상세도 "기준 기간을 확인하지 못해 판정을 계산하지 않았습니다"라 밝힌다(대표 행으로 확인).
    const sheet = await openDetail(events[0].id);
    expect(sheet.textContent).toMatch(/기준 기간을 확인하지 못해 이 거래의 판정을 계산하지 않았습니다/);
  });
});

describe("부담이 0이어도 내역 화면은 부담을 말하지 않는다", () => {
  it("'부담 없음'조차 내역에는 없다 — 0도 금액이다", async () => {
    // 손실만 있는 지갑을 만들어 부담을 0으로 만든다.
    // 취득만 있는 지갑은 처분·소득이 없어 부담이 반드시 0이다.
    const acquireOnly = events
      // 방향이 IN인 진짜 취득만 고른다 — RECEIVE인데 OUT인 건은 방향·분류 모순으로 게이트돼
      // "취득"이 아니라 "계산 제외"로 찍힌다.
      .filter((event) => event.classification === "RECEIVE" && event.direction === "IN" && event.price_status !== "UNKNOWN")
      .slice(0, 2);
    expect(acquireOnly.length, "픽스처에 취득 이벤트가 있어야 한다").toBeGreaterThan(0);
    setListEvents(acquireOnly);
    const { container } = renderDashboard("DE");
    await settled();
    // 처분·소득이 없어 부담은 0이다. 그 0을 말할 자리는 세금 탭이고 내역에는 없다.
    expect(container.textContent ?? "").not.toContain("부담 없음");
    expect(container.textContent ?? "").not.toMatch(/년 세금/);
    // 취득 판정 자체는 목록이 아니라 상세에서 말한다 — 각 취득 행의 상세에 판정 섹션이 있어야 한다.
    const rows = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")] as HTMLElement[];
    for (const row of rows) {
      fireEvent.click(row);
      const sheet = (await screen.findByText("거래 상세")).closest("div")!.parentElement!;
      await waitFor(() => expect(sheet.textContent).toMatch(/이 손익이 계산에서 어떻게 쓰였나/), { timeout: SETTLE_TIMEOUT });
    }
  });
});

describe("한계 기여도도 재조회 중 옛 값을 보이지 않는다", () => {
  it("'이 거래가 없었다면' 값이 보류 중에는 사라진다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    await waitFor(() => expect(screen.getByText("이 거래가 없었다면")).toBeInTheDocument());

    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    // 옛 델타가 최신인 척 남으면 안 된다.
    await waitFor(() => expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument());
  });
});

describe("3세대 P1 경계", () => {
  it("목록 갱신에 실패하면 보이는 내용이 마지막 상태임을 밝힌다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    const internal = events.find((event) => event.classification === "INTERNAL_TRANSFER")!;
    // 정착 상태: 내부 이체 행에도 손익 블록이 있다(이동은 "—"). "처분 아님" 이유는 이제 상세가 밝힌다.
    expect(rowById(internal.id).querySelector('[data-surface="event-gain"]')).not.toBeNull();

    // 재조회가 실패하면 캐시된 행이 남는다. 그걸 현재 사실로 단정하면 거짓이다.
    ports.list.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "list"] });
    await screen.findByText(/갱신하지 못했습니다 — 마지막으로 받은 상태 표시/, undefined, {
      timeout: 3000,
    });
    // 내부 이체 행도 예외가 아니다 — 목록이 stale이면 판정을 보류해 손익 블록을 거둔다.
    await waitFor(() => expect(rowById(internal.id).querySelector('[data-surface="event-gain"]')).toBeNull());
    // 전 카드가 판정을 보류해야 한다(어느 행도 손익 블록을 갖지 않는다).
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.every((card) => !card.querySelector('[data-surface="event-gain"]'))).toBe(true);

    // 목록이 stale이면 상세의 파생 계산도 근거가 없다.
    // 내부 이체는 정상 상태에서도 한계 기여도가 없으므로, 실제로 생기는 이벤트로 확인한다.
    const withMarginal = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    fireEvent.click(screen.getByText(rowLabel(withMarginal)));
    await screen.findByText("거래 상세");
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    // 두 비교 국가 각각을 확인한다. 한 곳만 비활성이어도 통과하면 안 된다.
    expect(screen.getByText("기준 기간을 확인하지 못해 IN 판정 정보를 계산하지 않았습니다.")).toBeInTheDocument();
    expect(screen.getByText("기준 기간을 확인하지 못해 PT 판정 정보를 계산하지 않았습니다.")).toBeInTheDocument();
  });

  it("믿을 기간이 없으면 상세의 파생 계산도 돌리지 않는다", async () => {
    ports.getSummary.mockRejectedValue(new Error("boom"));
    renderDashboard("DE");
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    const before = ports.estimate.mock.calls.length;

    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    // 근거 없는 연도로 한계 기여도·나라별 비교를 계산하면 안 된다.
    await waitFor(() => expect(screen.getByText("다른 나라였다면")).toBeInTheDocument());
    expect(ports.estimate.mock.calls.length, "근거 없는 연도로 추가 계산을 돌리면 안 된다").toBe(before);
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
  });
});

describe("4세대 P1 — 비활성 쿼리의 캐시가 답을 말하지 않는다", () => {
  it("먼저 캐시를 만든 뒤 기준 기간이 사라지면 상세가 옛 계산을 보이지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    // 1) 정상 상태에서 상세를 열어 한계 기여도·나라별 비교 캐시를 만든다.
    await settled();
    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    await waitFor(() => expect(screen.getByText("이 거래가 없었다면")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText("다른 나라였다면").parentElement!.textContent).not.toMatch(/확인하는 중입니다/),
    );
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    // 2) 기준 기간을 잃는다. 캐시가 남아 있어도 그건 근거 없는 계산이다.
    ports.getSummary.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "summary"] });
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });

    // 요약이 사라지면 과세연도 자리표시자가 바뀌어 키도 달라진다.
    // 그러면 "캐시가 새는가"를 시험할 수 없으므로, 그 키를 **직접 채워** 실제 유입을 재현한다.
    // 연말 경계에서 seed 키와 컴포넌트 키가 갈리지 않도록 시계를 고정한다.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-06-15T00:00:00.000Z") });
    const placeholderYear = taxYearFor("DE", new Date().toISOString());
    const seeded = computeTaxEstimate({
      country: "DE",
      taxYear: placeholderYear,
      events: derived.events,
      excludedEventIds: derived.excludedEventIds,
    });
    for (const input of [
      { country: "DE", taxYear: placeholderYear, source: "wallet" as const, includeMarginal: true },
      { country: "DE", taxYear: placeholderYear, source: "wallet" as const },
      { country: "IN", taxYear: placeholderYear, source: "wallet" as const },
      { country: "PT", taxYear: placeholderYear, source: "wallet" as const },
    ]) {
      client.setQueryData(["tax", "estimate", input], {
        ...seeded,
        marginalContributions: { [events[0].id]: LEAK_SENTINEL_AMOUNT },
      });
    }

    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    // 옛 캐시로 "이 거래가 없었다면"을 답하면 거짓이다.
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    // 계산하지 않은 것을 "불러오는 중"이라 말해서도 안 된다.
    // raw 값이 아니라 **실제로 렌더링될 문자열**로 검사해야 유입을 잡는다.
    const leakText = formatFiat(LEAK_SENTINEL_AMOUNT, "EUR");
    expect(document.body.textContent ?? "").not.toContain(leakText);
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    const comparison = screen.getByText("다른 나라였다면").parentElement!;
    expect(comparison.textContent).not.toMatch(/확인하는 중입니다/);
    // 비교 두 나라 모두 "계산하지 않았다"고 정확히 밝혀야 한다.
    expect(screen.getByText(/^기준 기간을 확인하지 못해 IN 판정 정보를 계산하지 않았습니다\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^기준 기간을 확인하지 못해 PT 판정 정보를 계산하지 않았습니다\.$/)).toBeInTheDocument();
    // 상세 판정 문구도 정확히 확인한다.
    expect(
      screen.getByText("기준 기간을 확인하지 못해 이 거래의 판정을 계산하지 않았습니다."),
    ).toBeInTheDocument();
  });
});

describe("5세대 P2 — 비활성·보류를 진행 중이라 말하지 않는다", () => {
  it("판정이 보류면 상세가 '처분 아님'을 단정하지 않는다", async () => {
    const internal = events.find((event) => event.classification === "INTERNAL_TRANSFER")!;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    fireEvent.click(rowById(internal.id));
    await screen.findByText(/자기 지갑 간 이체라 처분으로 보지 않았습니다/);

    // 판정 재조회가 멈춰 서면 그 설명도 근거를 잃는다.
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await waitFor(() =>
      expect(screen.queryByText(/자기 지갑 간 이체라 처분으로 보지 않았습니다/)).not.toBeInTheDocument(),
    );
  });
});

describe("7세대 — 복합 장애에서도 모든 표면이 같은 말을 한다", () => {
  it("기준 기간 상실 + 판정 오류가 겹쳐도 기준 카드와 행이 일치한다", async () => {
    // 첫 렌더 전에 시각을 고정한다. 그래야 요약 상실 후 폴백 과세연도가 바뀌면서
    // 쿼리 키가 갈려 오류 상태가 슬쩍 사라지는 일이 없다.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2025-06-15T00:00:00.000Z") });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();

    // 판정 조회를 실패시키고, 이어서 기준 기간까지 잃는다.
    ports.estimate.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await screen.findByText(/세금 판정을 불러오지 못해/, undefined, { timeout: 3000 });

    ports.getSummary.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "summary"] });
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });

    // 기준 기간이 없으면 애초에 요청하지 않았다. 옛 오류를 현재 상태로 말하면 안 된다.
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/세금 판정을 불러오지 못해/)).not.toBeInTheDocument();

    // 행도 같은 말을 해야 한다 — 기준 기간을 모르면 판정을 계산하지 않으므로,
    // 어느 행도 손익 블록을 갖지 않는다(옛 판정 오류를 현재 상태로 말하지 않는다). 전수로 본다.
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => !card.querySelector('[data-surface="event-gain"]'))).toBe(true);
  });

  it("캐시가 있어도 기준 기간이 없으면 안내·행이 답하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await settled();
    expect(screen.getByText(rowLabel(events[0])).closest("button")!.textContent).not.toMatch(/판정 확인 중/);

    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-06-15T00:00:00.000Z") });
    const placeholderYear = taxYearFor("DE", new Date().toISOString());
    const seeded = computeTaxEstimate({
      country: "DE",
      taxYear: placeholderYear,
      events: derived.events,
      excludedEventIds: derived.excludedEventIds,
    });
    client.setQueryData(["tax", "estimate", { country: "DE", taxYear: placeholderYear, source: "wallet" }], seeded);

    ports.getSummary.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "summary"] });
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });

    // 캐시가 남아 있어도 근거가 없으면 답하지 않는다.
    expect(document.body.textContent ?? "").not.toMatch(/년 세금/);
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.some((card) => /취득 · 원가 기록/.test(card.textContent ?? ""))).toBe(false);
  });
});

describe("부담을 산출하지 않는 룰셋은 한계 기여도를 답하지 않는다", () => {
  it("한국 상세가 '부담에 영향 없음'이라 말하지 않는다", async () => {
    // 테스트 계정 거주국이 KR이므로 이건 기본 경로다. 2027-01-01 시행 전이라 부담 자체가 없다.
    renderDashboard("KR");
    await settled();

    // 이 건수는 가격·분류만 보고 센 수다. 판정이 갈리기 전에 "과세 대상"이라 하면 단정이다.
    expect(screen.queryByText("과세 대상 이벤트")).not.toBeInTheDocument();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();

    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    await screen.findByText("다른 나라였다면");

    // 결정적 검증: 애초에 한계 기여도를 **요청하지 않아야** 한다.
    // 부재만 보면 비동기 응답이 늦게 도착하는 구현에서도 통과해버린다.
    const marginalCalls = ports.estimate.mock.calls.filter(([input]) => input?.includeMarginal === true);
    expect(marginalCalls, "부담을 산출하지 않는 룰셋에 한계 기여도를 요청하면 안 된다").toEqual([]);
    // 헤더가 "과세 대상 아님"인데 상세가 "영향 없음"이라 하면 정면 모순이다.
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    expect(screen.queryByText(/부담에 영향 없음/)).not.toBeInTheDocument();
  });

  it("확정 룰셋에서도 '과세 대상'이라 단정하지 않는다", async () => {
    // 이 건수는 가격·분류가 확정돼 계산에 들어간 수일 뿐,
    // 취득·비과세·상계 소멸까지 포함한다. "과세 대상"이라 부르면 과장이다.
    renderDashboard("DE");
    await settled();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();
    expect(screen.queryByText("과세 대상 이벤트")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").toContain("과세 여부는 아래 판정에서 갈립니다");
  });

  it("중복 레코드는 첫 건의 한계 기여도·나라별 비교를 물려받지 않는다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id))!;
    setListEvents([target]);
    ports.list.mockResolvedValue({
      items: [
        { event: target, version: 1 },
        { event: { ...target }, version: 1 },
      ],
      nextCursor: null,
    });
    renderDashboard("DE");
    await settled();

    const cards = screen.getAllByText(rowLabel(target)).map((node) => node.closest("button")!);
    expect(cards).toHaveLength(2);
    fireEvent.click(cards[1]);
    await screen.findByText(/같은 이벤트 id가 두 번 이상 들어와/);
    // 결정적 검증: 중복 레코드는 한계 기여도를 요청조차 하지 않는다.
    const marginalCalls = ports.estimate.mock.calls.filter(([input]) => input?.includeMarginal === true);
    expect(marginalCalls, "중복 레코드에 한계 기여도를 요청하면 안 된다").toEqual([]);
    // id로 키가 잡히는 결과를 물려받으면 두 번째 레코드가 남의 계산을 자기 것처럼 보인다.
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    expect(screen.queryByText("다른 나라였다면")).not.toBeInTheDocument();
  });
});

describe("없는 것을 계산된 것처럼 말하지 않는다", () => {
  it("계산할 거래가 없으면 ₩0을 손익이라 하지 않는다", async () => {
    // 손익·건수는 세금 화면과 같은 estimate에서 파생하므로, "계산할 것 없음"도 estimate로 낸다 —
    // 목록·엔진을 함께 비워야(setListEvents) estimate에 기간 내 판정이 없어 카드가 "계산할 거래 없음"이 된다.
    setListEvents([]);
    ports.getSummary.mockResolvedValue({
      periodPnl: "0",
      computableEventCount: 0,
      taxableEventCount: 0,
      pendingReviewCount: 3,
      currency: "KRW",
      period: FIXTURE_PERIOD,
    });
    renderDashboard("DE");
    expect(await screen.findByText("계산할 거래 없음")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("₩0");
    expect(screen.getByText(/가격·분류를 확정한 거래가 아직 없습니다/)).toBeInTheDocument();
  });

  it("판정 결과가 오기 전에는 '과세 대상'이라 단정하지 않는다", async () => {
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    renderDashboard("DE");
    await screen.findByText(rowLabel(events[0]));
    // 요약이 먼저 도착해도 과세 여부는 아직 모른다.
    expect(screen.queryByText("과세 대상 이벤트")).not.toBeInTheDocument();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();
    expect(document.body.textContent ?? "").toContain("과세 여부는 아직 판단하지 않았습니다");
  });

  it("기간이 비어 있으면 근거로 쓰지 않는다", async () => {
    ports.getSummary.mockResolvedValue({
      periodPnl: "0",
      computableEventCount: 0,
      taxableEventCount: 0,
      pendingReviewCount: 0,
      currency: "KRW",
      period: { from: "", to: "" },
    });
    const { container } = renderDashboard("DE");
    // 기준 기간이 없으면 estimate를 아예 요청하지 않아 손익 카드는 "—"다.
    // 정착 신호는 요약이 도착해야 뜨는 헤더의 "기간 미정"으로 잡는다(판정 미계산 배너는 로딩 중에도 떠서 이르다).
    await screen.findByText("기간 미정");
    // 헤더에 ` ~ `만 보이면 기간이 있는 것처럼 말하는 셈이다.
    const header = container.querySelector('[data-surface="dashboard-summary"]')!;
    expect(header.textContent).toContain("기간 미정");
    expect(header.textContent).not.toMatch(/\s~\s*$/);
    // 빈 기간을 그대로 쓰면 "NaN년 세금"이 된다.
    expect(container.textContent ?? "").not.toMatch(/NaN/);
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
  });
});

describe("잘못된 기간에서 헤더와 판정 안내가 갈리지 않는다", () => {
  for (const period of [
    { from: "2025", to: "2025-12-31" },
    { from: "2025-02-30", to: "2025-03-31" },
    { from: "2025-13-01", to: "2025-12-31" },
    // 접두사는 멀쩡하지만 전체가 파싱되지 않는 오프셋 — 그대로 쓰면 "NaN년 세금"이 된다.
    { from: "2025-01-01T00:00:00+25:00", to: "2025-12-31" },
  ]) {
    it(`${JSON.stringify(period)}: 헤더가 '기간 미정'이면 판정도 계산하지 않는다`, async () => {
      ports.getSummary.mockResolvedValue({
        periodPnl: "0",
        computableEventCount: 0,
        taxableEventCount: 0,
        pendingReviewCount: 0,
        currency: "KRW",
        period,
      });
      const { container } = renderDashboard("DE");
      // 기준 기간이 없으면 estimate를 요청하지 않아 손익 카드는 "—"다.
      // 정착 신호는 요약이 도착해야 뜨는 헤더의 "기간 미정"으로 잡는다(판정 미계산 배너는 로딩 중에도 떠서 이르다).
      await screen.findByText("기간 미정");

      const header = container.querySelector('[data-surface="dashboard-summary"]')!;
      expect(header.textContent).toContain("기간 미정");
      // 헤더는 "기간 미정"인데 판정 안내가 "2025년 세금"이라 하면 같은 화면이 두 이야기를 한다.
      expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
      expect(container.textContent ?? "").not.toMatch(/년 세금|NaN/);
    });
  }
});

describe("여러 취득분을 소비한 처분을 화면이 어떻게 말하는가", () => {
  it("보유일이 섞이면 침묵하지 않고 그렇다고 말한다", async () => {
    // holdingDays가 null인 이유는 둘이다 — 취득 기록이 없거나, lot마다 달라서.
    // "—"만 두면 두 사실이 구분되지 않는다.
    const target = events[0];
    ports.estimate.mockImplementation(async () => {
      const base = await engine.estimate({ country: "DE", taxYear: 2025, source: "wallet" });
      return {
        ...base,
        judgments: [
          {
            eventId: target.id,
            at: target.block_timestamp,
            asset: "eip155:1/native",
            symbol: "ETH",
            quantity: "2",
            amountKind: "gain" as const,
            holdingDays: null,
            acquiredAt: null,
            lots: 3,
            leg: "single" as const,
            inPeriod: true,
            group: "taxable" as const,
            label: "과세 대상",
            basis: "§23 EStG",
            amount: "1000",
          },
        ],
      };
    });

    renderDashboard("DE");
    await settled();
    const card = await screen.findByText(rowLabel(target));
    // 목록은 도장만 찍는다. 보유일이 섞였다는 사실은 상세의 손익 근거표가 말해야 한다.
    fireEvent.click(card.closest("button")!);
    const section = (await screen.findByText("손익은 이렇게 나왔습니다")).parentElement!;
    await waitFor(
      () => expect(section.textContent).toMatch(/취득분마다 다름/),
      { timeout: SETTLE_TIMEOUT },
    );
    // 보유일·취득일이 하나로 정해지지 않은 이유는 소비한 취득분이 여럿이기 때문이다.
    expect(section.textContent).toMatch(/소비한 취득분/);
    expect(section.textContent).toMatch(/3개/);
  });
});

describe("금액을 말하지 않는 화면은 그 금액의 한계도 옮겨오지 않는다", () => {
  it("계산의 한계는 세금 탭에만 있고 내역 화면에 새지 않는다", async () => {
    // 내역은 부담 금액을 말하지 않는다. 금액이 없는데 "이 금액이 흔들린다"고 하면 무엇이 흔들리는지 알 수 없다.
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return {
        ...base,
        limitations: [
          { kind: "zero_basis" as const, message: "부인된 손실을 대체 취득분 원가에 더하지 않았습니다.", eventIds: ["x"] },
          { kind: "approximation" as const, message: "추정가로 평가된 이벤트가 있습니다.", eventIds: [] },
        ],
      };
    });

    renderDashboard("DE");
    await settled();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/흔들리는 지점/);
    expect(body).not.toContain("부인된 손실을 대체 취득분 원가에 더하지 않았습니다.");
    // 대신 한계를 볼 문은 세금 탭이다. 내역이 자기 자리에서 답하려 들면 두 화면이 갈린다.
    expect(document.querySelector('a[href="/tax"]')).toBeNull();
  });
});

describe("상세 시트가 손익 계산 4줄을 보인다", () => {
  it("양도가액 − 취득가액 − 수수료 = 손익을 그대로 그린다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "DISPOSE"))!;
    // fallback으로 아무 이벤트에나 가짜 행을 붙이면 실제 처분 경로가 검증되지 않는다.
    expect(target, "처분 이벤트가 픽스처에 없다").toBeDefined();
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return {
        ...base,
        judgments: [
          {
            eventId: target.id,
            at: target.block_timestamp,
            asset: "eip155:1/native",
            symbol: "ETH",
            quantity: "1",
            amountKind: "gain" as const,
            holdingDays: 400,
            acquiredAt: "2024-01-01T00:00:00.000Z",
            lots: 1,
            leg: "single" as const,
            inPeriod: true,
            breakdown: { proceeds: "3000", cost: "1000", fee: "20" },
            group: "taxable" as const,
            label: "과세 대상",
            basis: "§23 EStG",
            amount: "1980",
          },
        ],
      };
    });

    renderDashboard("DE");
    await settled();
    fireEvent.click(screen.getByText(rowLabel(target)).closest("button")!);
    await screen.findByText("거래 상세");

    const sheet = (await screen.findByText("손익은 이렇게 나왔습니다")).closest("section")!;
    // 시트 전체 문자열이 아니라 breakdown dl 안에서 각 줄의 값을 짝지어 확인한다.
    const grid = within(sheet).getByText("양도가액").closest("dl")!;
    const rowValue = (label: string) =>
      within(grid).getByText(label).parentElement!.querySelector("dd")!.textContent;
    expect(rowValue("양도가액")).toBe("€3,000.00");
    expect(rowValue("− 취득가액")).toBe("€1,000.00");
    expect(rowValue("− 수수료")).toBe("€20.00");
    expect(rowValue("= 손익")).toBe("€1,980.00");
  });
});
describe("거래 카드는 온체인 사실 네 가지와 도장만 말한다", () => {
  /** e2e가 카드를 식별할 때 쓰는 훅. 순서 기반 선택자로 되돌아가면 레이아웃 변경마다 깨진다. */
  const labelOf = (card: Element) => card.querySelector("[data-event-label]")?.textContent ?? "";
  const cardsOf = (container: HTMLElement) => [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
  /** 화면이 그리는 순서. 목록은 최신이 위이고 픽스처는 오래된 순이라 둘은 서로 뒤집힌 것이다. */
  const newestFirst = [...events].sort(
    (left, right) => Date.parse(right.block_timestamp) - Date.parse(left.block_timestamp),
  );

  it("날짜는 UTC 하루 머리글에 한 번만 찍고 그 사실을 화면이 밝힌다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    const headings = [...container.querySelectorAll("section .mt-3.grid.gap-3 > h3")];
    const days = [...new Set(newestFirst.map((event) => isoDay(event.block_timestamp)))];
    expect(headings.map((node) => node.textContent)).toEqual(days.map((day) => formatDate(`${day}T00:00:00.000Z`)));
    // 시간대를 안 밝히면 사용자는 자기 시간대로 읽는다 — 과세연도 경계에서 다른 해가 된다.
    expect(container.textContent).toContain(UTC_NOTICE);
    // 머리글이 날짜를 맡았으니 카드가 같은 날짜를 또 반복하면 안 된다.
    for (const card of cardsOf(container)) expect(card.textContent).not.toMatch(/\d{4}\. \d{1,2}\./);
  });

  it("체인·수량·거래방법·실현 손익(₩)을 싣고, 그 밖의 통화 금액은 싣지 않는다", async () => {
    const { container } = renderDashboard("DE");
    await settled();
    const cards = cardsOf(container);
    expect(cards).toHaveLength(events.length);

    for (const [index, card] of cards.entries()) {
      const event = newestFirst[index];
      const text = card.textContent ?? "";
      expect(labelOf(card), event.id).toBe(rowLabel(event));
      // 체인은 이름 텍스트가 아니라 로고 배지로만 말한다(목록 재설계 — 체인 이름 제거).
      expect(card.querySelector(`[data-chain-icon="${event.chain_id}"]`), event.id).not.toBeNull();
      // 계산에 들어가지 않는 값은 목록에 없다. 가스는 픽스처 전 건이 같은 값이라 25줄을 채우고도
      // 아무것도 구분해주지 않으며, 어떤 판정도 바꾸지 않는다 — 상세에서만 답한다.
      expect(text, event.id).not.toContain("가스");
      // 카드는 이제 실현 손익(₩)을 summ의 Gain 컬럼처럼 도장과 함께 보인다 — 그 자리에만 통화 금액이 허용된다.
      // 손익 줄(data-surface="event-gain")을 뺀 나머지에 통화 기호가 새면 사용자는 그 숫자를 세금·평가액으로 읽는다.
      const withoutGain = card.cloneNode(true) as HTMLElement;
      withoutGain.querySelector('[data-surface="event-gain"]')?.remove();
      expect(withoutGain.textContent ?? "", event.id).not.toMatch(/[€₩$]/);
    }
  });

  it("확인이 필요한 건은 확인 필요 탭에 모이고, 사유는 상세가 review.ts 판정 그대로 밝힌다", async () => {
    // 목록 재설계로 사유 배지("가격 확인 필요" 등)는 목록에서 빠졌다. 두 안전 신호를 함께 지킨다:
    // (1) 확인 필요 탭이 고칠 건을 모으고, (2) 거래 상세가 review.ts 판정 사유를 그대로 밝힌다.
    renderDashboard("DE");
    await settled();
    // 가격 미확인 이벤트가 픽스처에 없으면 이 단언은 아무것도 지키지 않는다.
    expect(events.filter((event) => reviewReason(event) === "가격 확인 필요").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    const shown = new Set(
      [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")].map((card) => card.getAttribute("data-event-id")),
    );
    for (const event of events) {
      // 확인이 필요한 건은 반드시 큐에 있어야 한다 — 아니면 사용자가 고칠 곳이 없다.
      if (needsReview(event)) expect(shown.has(event.id), `확인 필요인데 큐에 없음: ${event.id}`).toBe(true);
    }

    // 사유 자체도 유실되지 않는다 — 확인 필요 건 하나를 열면 상세가 review.ts 판정 사유를 그대로 보인다.
    const reviewable = events.find((event) => needsReview(event));
    expect(reviewable, "확인 필요 픽스처가 있어야 이 단언이 의미가 있다").toBeDefined();
    const sheet = await openDetail(reviewable!.id);
    expect(sheet.textContent).toContain(reviewReason(reviewable!));
  });

  it("계산에 안 들어간 가스는 상세에서 손익 근거 옆에 답한다", async () => {
    renderDashboard("DE");
    await settled();
    const target = events[0];
    fireEvent.click(screen.getByText(rowLabel(target)).closest("button")!);
    await screen.findByText("거래 상세");
    // `− 수수료 €0.00`이 왜 0인지 답할 수 있는 건 네이티브 수량뿐이다.
    const gas = (await screen.findByText("가스")).parentElement!;
    expect(gas.textContent).toContain(`${formatTokenAmount(target.gas_fee_native, 0)} ${nativeSymbol(target.chain_id)}`);
  });
});

describe("DeFi 수익은 종류 배지로 드러난다", () => {
  it("income_kind 이벤트 카드는 수신 대신 수익 종류를 주 배지로 찍는다", async () => {
    renderDashboard("DE");
    await settled();

    const cases: Array<{ kind: NormalizedEvent["income_kind"]; label: string }> = [
      { kind: "STAKING", label: "스테이킹 보상" },
      { kind: "DEFI_REWARD", label: "디파이 보상" },
      { kind: "LENDING", label: "대여 이자" },
    ];
    for (const { kind, label } of cases) {
      const income = events.find((event) => event.income_kind === kind);
      expect(income, `픽스처에 ${kind} 수익 이벤트가 있어야 한다`).toBeDefined();
      const card = screen.getByText(rowLabel(income!)).closest("button")!;
      // 목록에서 한눈에 무슨 DeFi 수익인지 보여야 한다.
      expect(within(card).getByText(label)).toBeInTheDocument();
      // 종류가 주 배지이므로 "수신"이 그 자리를 대신 차지하면 안 된다.
      expect(within(card).queryByText("수신")).not.toBeInTheDocument();
    }
  });

  it("income_kind가 없는 수신은 기존 '수신' 배지 그대로다", async () => {
    renderDashboard("DE");
    await settled();
    const plainReceive = events.find(
      (event) => event.income_kind === null && effectiveClassificationOf(event) === "RECEIVE",
    );
    expect(plainReceive, "income_kind 없는 수신 이벤트가 픽스처에 있어야 한다").toBeDefined();
    const card = screen.getByText(rowLabel(plainReceive!)).closest("button")!;
    expect(within(card).getByText("수신")).toBeInTheDocument();
    expect(within(card).queryByText(/스테이킹 보상|디파이 보상|대여 이자/)).not.toBeInTheDocument();
  });

  it("상세는 수익 종류 행을 두고 분류 배지는 유지한다", async () => {
    renderDashboard("DE");
    await settled();
    const income = events.find((event) => event.income_kind === "STAKING")!;
    fireEvent.click(screen.getByText(rowLabel(income)).closest("button")!);
    await screen.findByText("거래 상세");
    const kindRow = (await screen.findByText("수익 종류")).parentElement!;
    expect(kindRow.textContent).toContain("스테이킹 보상");
    // 분류(수신)는 상세 상단 배지에 그대로 남는다(재분류 select의 option과 구분해 span 배지를 확인한다).
    const sheet = screen.getByText("거래 상세").closest("div")!.parentElement!;
    expect(within(sheet).getAllByText("수신").some((node) => node.tagName === "SPAN")).toBe(true);
  });
});

describe("목록이 실현 손익(₩)을 상세와 같은 소스에서 뽑아 노출한다", () => {
  it("처분 행에 실현 손익 금액(부호·색)을 찍고, 무손익 행은 거래 평가액을·가격 미확인만 —로 둔다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "DISPOSE"))!;
    expect(target, "처분 이벤트가 픽스처에 있어야 한다").toBeDefined();
    // 상세 손익 근거표와 같은 판정 행을 심는다: 손익 1,980(양도 3,000 − 취득 1,000 − 수수료 20), 수익률 +198%.
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return {
        ...base,
        judgments: [
          {
            eventId: target.id,
            at: target.block_timestamp,
            asset: "eip155:1/native",
            symbol: "ETH",
            quantity: "1",
            amountKind: "gain" as const,
            holdingDays: 400,
            acquiredAt: "2024-01-01T00:00:00.000Z",
            lots: 1,
            leg: "single" as const,
            inPeriod: true,
            breakdown: { proceeds: "3000", cost: "1000", fee: "20" },
            group: "taxable" as const,
            label: "과세 대상",
            basis: "§23 EStG",
            amount: "1980",
          },
        ],
      };
    });

    renderDashboard("DE");
    await settled();

    const gainCard = rowById(target.id);
    const gainRow = gainCard.querySelector('[data-surface="event-gain"]')!;
    // 우측 손익 칸은 라벨 없이 값과 수익률만 보인다(목록 재설계 — 좌: 타입·티커 / 우: 손익·%).
    // 손익 금액이 주(主)다 — 부호(+)와 통화 금액을 함께 보인다. 상세 손익과 같은 소스라 값이 일치한다.
    const gainText = formatFiat("1980", "EUR");
    expect(gainRow.textContent).toContain(`+${gainText}`);
    // 상승은 색으로도 표시하되(브랜드 receive), 색만으로 구분하지 못하도록 부호를 함께 둔다.
    const stamp = gainRow.querySelector(".text-receive");
    expect(stamp, "상승 손익은 receive 색을 쓴다").not.toBeNull();
    // 수익률(%)은 금액 옆에 보조로만 덧댄다.
    expect(gainRow.textContent).toContain("+198%");

    // 목록의 손익이 상세의 손익 근거표와 같은 값인지 대조한다(같은 판정 행이 소스).
    fireEvent.click(gainCard);
    const evidence = (await screen.findByText("손익은 이렇게 나왔습니다")).parentElement!;
    await waitFor(() => expect(evidence.textContent).toContain(`= 손익${gainText}`), { timeout: SETTLE_TIMEOUT });

    // 실현 손익이 없어도 가격을 잃지 않는다 — 가격이 확인된 무손익 행(이동 등)은 거래 평가액(₩)을 보인다.
    const pricedNoGain = events.find(
      (event) => effectiveClassificationOf(event) === "INTERNAL_TRANSFER" && event.fiat_value !== null,
    )!;
    expect(pricedNoGain, "가격이 확인된 이동 이벤트가 픽스처에 있어야 한다").toBeDefined();
    const pricedCell = rowById(pricedNoGain.id).querySelector('[data-surface="event-gain"]')!;
    expect(pricedCell.textContent).toContain(formatFiat(pricedNoGain.fiat_value, pricedNoGain.fiat_currency));

    // 가격조차 미확인인 무손익 행만 —로 둔다(손익도 평가액도 없음).
    const unpricedNoGain = events.find((event) => event.fiat_value === null)!;
    const unpricedCell = rowById(unpricedNoGain.id).querySelector('[data-surface="event-gain"]')!;
    expect(unpricedCell.textContent).toContain("—");
    expect(unpricedCell.textContent ?? "").not.toMatch(/[€₩$]/);
  });

  it("잔액 가리기를 켜면 행 손익도 마스킹한다(요약 손익·이력 그래프와 같은 규칙)", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "DISPOSE"))!;
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return {
        ...base,
        judgments: [
          {
            eventId: target.id,
            at: target.block_timestamp,
            asset: "eip155:1/native",
            symbol: "ETH",
            quantity: "1",
            amountKind: "gain" as const,
            holdingDays: 400,
            acquiredAt: "2024-01-01T00:00:00.000Z",
            lots: 1,
            leg: "single" as const,
            inPeriod: true,
            breakdown: { proceeds: "3000", cost: "1000", fee: "20" },
            group: "taxable" as const,
            label: "과세 대상",
            basis: "§23 EStG",
            amount: "1980",
          },
        ],
      };
    });
    renderDashboard("DE");
    await settled();
    // 가리기를 켜면 카드 제목(수량)도 마스킹되어 라벨로 못 찾는다 — data-event-id로 카드를 붙잡는다.
    const card = screen.getByText(rowLabel(target)).closest("button")!;
    const eventId = card.getAttribute("data-event-id")!;
    fireEvent.click(screen.getByRole("button", { name: "금액 가리기" }));

    // 손익 금액은 돈이므로 잔액 가리기에서 요약 손익·이력 선과 같이 마스킹된다.
    await waitFor(() => {
      const gainRow = document.querySelector(`button[data-event-id="${eventId}"] [data-surface="event-gain"]`)!;
      expect(gainRow.textContent).toContain("•••••");
      expect(gainRow.textContent ?? "").not.toMatch(/[€₩$]/);
    });
  });
});
