import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { assetLabel, formatFiat, formatTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { MockTaxEngine } from "@/lib/mock/tax-engine";
import { MockEventStore } from "@/lib/mock/store";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { effectiveClassification as effectiveClassificationOf, needsReview } from "@/lib/review";
import { computeTaxEstimate, taxYearFor } from "@/lib/tax/engine";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

// 화면에 나오면 즉시 눈에 띄도록 픽스처 금액과 겹치지 않는 값을 쓴다.
const LEAK_SENTINEL_AMOUNT = "987654.32";
const events = createNormalizedEventFixtures();
const derived = deriveTaxEvents(events);

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
const engine = new MockTaxEngine(() => currentEvents);

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
  period: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-26T00:00:00.000Z" },
});
ports.getById.mockImplementation(async (id: string) => ({
  event: events.find((event) => event.id === id)!,
  version: 1,
  override_history: [],
}));
ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));

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
    period: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-26T00:00:00.000Z" },
  });
  ports.getById.mockImplementation(async (id: string) => ({
    event: events.find((event) => event.id === id)!,
    version: 1,
    override_history: [],
  }));
  ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
}

// 테스트가 전역 목을 바꾸고 assertion 뒤에 되돌리면, 실패 한 번에 이후 전부가 오염된다.
afterEach(() => {
  vi.useRealTimers();
  resetPorts();
});

/** 목록 재조회 → 세금 엔진 재계산 → 재렌더 한 왕복이 정착하는 데 주는 시간. */
const SETTLE_TIMEOUT = 5000;

function rowLabel(event: NormalizedEvent) {
  return `${formatTokenAmount(event.raw_amount, event.decimals)} · ${assetLabel(event)}`;
}

describe("거래 탭이 세금 대신 판정 도장을 찍는다", () => {
  it("판정 기준을 국가와 함께 밝히고 세금 총액은 한 줄만 둔다", async () => {
    // UI 계약은 엔진 구현과 분리한다. 같은 함수로 기대값을 만들면 엔진 결함이 함께 통과한다.
    const FIXED_CHARGE = "4242.42";
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => {
      const base = await engine.estimate(input);
      return { ...base, totals: { ...base.totals, estimatedCharge: FIXED_CHARGE }, status: "SUPPORTED" as const };
    });
    renderDashboard("DE");
    expect(await screen.findByText(/독일 룰셋으로 판정 중/)).toBeInTheDocument();
    const estimate = { totals: { estimatedCharge: FIXED_CHARGE }, currency: "EUR" };
    // 세금 숫자는 판정 기준 줄에만 존재한다. 요약 카드(손익)의 금액과 섞이면 안 된다.
    const basis = screen.getByLabelText("판정 기준");
    const charge = Number(estimate.totals.estimatedCharge);
    // 통화는 국가마다 다르다(독일 €). 금액이 실제로 렌더링됐는지만 확인한다.
    expect(basis.textContent).toContain(
      charge === 0 ? "부담 없음" : formatFiat(estimate.totals.estimatedCharge, estimate.currency),
    );
    expect(basis.textContent).toContain("2025년 세금");

    // 한 줄 불변식은 "있다"가 아니라 "여기에만 있다"이다.
    const chargeText = formatFiat(estimate.totals.estimatedCharge, estimate.currency);
    if (charge !== 0) {
      const wholePage = document.body.textContent ?? "";
      const occurrences = wholePage.split(chargeText).length - 1;
      expect(occurrences, `세금 금액 ${chargeText}가 화면에 ${occurrences}번 나온다`).toBe(1);
    }
    for (const card of [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")]) {
      expect(card.textContent ?? "", "거래 카드에 세금 금액이 새면 안 된다").not.toContain(chargeText);
      expect(card.textContent ?? "").not.toMatch(/년 세금/);
    }
  });

  it("미확정 국가는 금액 대신 산출 불가를 보이고 ₩0을 찍지 않는다", async () => {
    const { container } = renderDashboard("KR");
    expect(await screen.findByText("산출 불가")).toBeInTheDocument();
    expect(container.textContent).not.toContain("₩0");
  });

  it("거래 행에 판정 도장이 붙고 금액이 세금이 아님을 라벨로 밝힌다", async () => {
    renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    // 첫 매수 이벤트는 취득 판정을 받는다.
    const acquired = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "ACQUIRE"));
    expect(acquired).toBeDefined();
    const row = screen.getByText(rowLabel(acquired!)).closest("button");
    expect(row).not.toBeNull();
    expect(row!.textContent).toMatch(/취득/);
    // 금액 칸이 세금이 아니라 **취득가액**임을 밝힌다. 넷 중 아무거나 허용하면 라벨이 뒤바뀌어도 통과한다.
    expect(row!.textContent).toContain("취득가액");
  });

  it("계산에서 빠진 이벤트는 계산 제외 도장을 받고 확인 필요 탭과 같은 집합이다", async () => {
    renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(derived.excludedEventIds.length).toBeGreaterThan(0);
    const excluded = events.find((event) => derived.excludedEventIds.includes(event.id))!;
    const row = screen.getByText(rowLabel(excluded)).closest("button");
    expect(row!.textContent).toMatch(/계산 제외/);
    // 확인 필요 탭에도 반드시 있어야 한다(제외 ⊆ 확인 필요).
    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    expect(screen.getByText(rowLabel(excluded))).toBeInTheDocument();
  });

  it("기존 탭 접근가능 이름과 거래 카드 구조를 유지한다", async () => {
    const { container } = renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(screen.getByRole("tab", { name: "전체 거래" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "확인 필요" })).toBeInTheDocument();
    // e2e 로케이터가 의존하는 구조.
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);
  });

  it("그룹 필터가 목록을 좁힌다", async () => {
    const { container } = renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const all = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
    const chip = screen.getByRole("button", { name: /^계산 제외/ });
    fireEvent.click(chip);
    const filtered = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
    expect(filtered).toBe(derived.excludedEventIds.length);
    expect(filtered).toBeLessThan(all);
  });
});

describe("판정도 제외도 아닌 거래가 침묵하지 않는다", () => {
  it("자기 지갑 간 이체는 처분이 아님을 목록과 상세에서 밝힌다", async () => {
    const internal = events.find((event) => event.classification === "INTERNAL_TRANSFER");
    expect(internal, "픽스처에 내부 이체가 있어야 한다").toBeDefined();
    // 내부 이체는 계산에도 제외 목록에도 없다 — 화면이 이유를 말하지 않으면 사용자는 누락으로 읽는다.
    expect(derived.events.some((tax) => tax.id === internal!.id)).toBe(false);
    expect(derived.excludedEventIds).not.toContain(internal!.id);

    renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const row = screen.getByText(rowLabel(internal!)).closest("button")!;
    expect(row.textContent).toMatch(/처분 아님/);

    fireEvent.click(row);
    expect(await screen.findByText(/자기 지갑 간 이체라 처분으로 보지 않았습니다/)).toBeInTheDocument();
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

  it("모든 거래 카드에 최소 한 개의 판정 배지가 있다 — 침묵하는 카드가 없다", async () => {
    const { container } = renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    const silent = cards.filter((card) => {
      const text = card.textContent ?? "";
      return !/취득|소득|과세|비과세|상계|손실|이연|보류|계산 제외|처분 아님|기간 밖|계산 결과 없음|중복 id/.test(text);
    });
    expect(silent.map((card) => card.textContent)).toEqual([]);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);

    const cards = screen.getAllByText(rowLabel(base)).map((node) => node.closest("button")!);
    expect(cards).toHaveLength(2);
    // 두 번째 카드는 첫 건의 판정을 물려받지 않는다.
    expect(cards[1].textContent).toMatch(/중복 id/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    expect(screen.getByText(/판정 기준을 불러오는 중입니다/)).toBeInTheDocument();
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => /계산 결과 없음/.test(card.textContent ?? ""))).toBe(false);
    // 한 장만 라벨을 달고 나머지가 침묵해도 통과하면 안 된다 — 전수 검사.
    // 내부 이체·중복처럼 판정과 무관하게 이미 설명된 카드도 유효하다.
    const silent = cards.filter((card) => !/판정 확인 중|판정 불러오기 실패|이동 · 처분 아님|중복 id|계산 제외|기간 밖/.test(card.textContent ?? ""));
    expect(silent.map((card) => card.textContent)).toEqual([]);
    expect(cards.some((card) => /판정 확인 중/.test(card.textContent ?? ""))).toBe(true);
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
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
    await screen.findByText(/독일 룰셋으로 판정 중/);

    fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
    const cards = screen.getAllByText(rowLabel(clean)).map((node) => node.closest("button")!);
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toMatch(/중복 id/);
    expect(cards[0].textContent).not.toMatch(/취득 · 원가 기록/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const cards = screen.getAllByText(rowLabel(highConfidenceInternal)).map((n) => n.closest("button")!);
    expect(cards[1].textContent).toMatch(/중복 id/);
    fireEvent.click(cards[1]);
    // 행이 "중복 · 확인 필요"인데 상세가 "확인이 필요한 건이 아니라"고 하면 정면 모순이다.
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/판정 기준을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    const cards = [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    const silentOnError = cards.filter((card) => !/판정 확인 중|판정 불러오기 실패|이동 · 처분 아님|중복 id|계산 제외|기간 밖/.test(card.textContent ?? ""));
    expect(silentOnError.map((card) => card.textContent)).toEqual([]);
    expect(cards.some((card) => /판정 불러오기 실패/.test(card.textContent ?? ""))).toBe(true);
    expect(cards.some((card) => /판정 확인 중/.test(card.textContent ?? ""))).toBe(false);
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
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
    await screen.findByText(/독일 룰셋으로 판정 중/);

    // 전체 탭과 확인 필요 탭 모두에서 칩 건수 == 카드 수여야 한다.
    for (const tabName of ["전체 거래", "확인 필요"] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tabName }));
      const chips = [...container.querySelectorAll("button[aria-pressed]")].filter(
        (chip) => !/^전체/.test(chip.textContent ?? ""),
      );
      for (const chip of chips) {
        const label = chip.textContent ?? "";
        const expected = Number(label.match(/(\d+)\s*$/)?.[1]);
        expect(Number.isFinite(expected), `칩 라벨에 건수가 없다: ${label}`).toBe(true);
        fireEvent.click(chip);
        const cards = container.querySelectorAll("section .mt-3.grid.gap-3 > button").length;
        expect(cards, `${tabName} 탭 칩 "${label}"의 건수와 카드 수가 다르다`).toBe(expected);
        fireEvent.click(chip);
      }
    }
  });

  it("판정 조회가 실패하면 그룹 필터가 조용히 빈 목록을 만들지 않는다", async () => {
    const { container } = renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    fireEvent.click(screen.getByRole("button", { name: /^취득/ }));
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);

    ports.estimate.mockRejectedValue(new Error("boom"));
    await client0.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await screen.findByText(/판정 기준을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    // 필터를 유지하면 빈 목록만 남아 원인을 알 수 없다.
    expect(container.querySelectorAll("section .mt-3.grid.gap-3 > button").length).toBeGreaterThan(0);
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
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
    // 먼저 성공시켜 도장을 받는다.
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(screen.getByText(rowLabel(target)).closest("button")!.textContent).toMatch(/취득/);

    // 이후 재조회를 실패시키면 옛 도장이 최신 진실인 척하면 안 된다.
    ports.estimate.mockRejectedValue(new Error("boom"));
    await client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    rerender(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/판정 기준을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    const card = screen.getByText(rowLabel(target)).closest("button")!;
    expect(card.textContent).toMatch(/판정 불러오기 실패/);
    expect(card.textContent).not.toMatch(/취득 · 원가 기록/);
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
  });

  it("선택한 거래가 목록에서 사라지면 시트가 옛 데이터를 계속 보여주지 않는다", async () => {
    const target = events[0];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
      period: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-26T00:00:00.000Z" },
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(screen.getByText(rowLabel(target)).closest("button")!.textContent).toMatch(/취득/);

    // 외부에서 분류가 바뀌어 목록만 갱신된 상태.
    // 판정 소스까지 함께 바꿔야 "정착 후에도 옛 도장이 없다"를 증명할 수 있다.
    const updated = events.map((event) =>
      event.id === target.id ? { ...event, classification: "SEND" as const, user_override: null } : event,
    );
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
        const card = screen.getByText(rowLabel(target)).closest("button")!;
        expect(card.textContent).not.toMatch(/판정 확인 중/);
        expect(card.textContent).not.toMatch(/취득 · 원가 기록/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    expect(await screen.findByText(/거래가 너무 많아 일부만 불러왔습니다/)).toBeInTheDocument();
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(screen.getByText(rowLabel(excluded)).closest("button")!.textContent).toMatch(/계산 제외/);

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
        const card = screen.getByText(rowLabel(fixed)).closest("button")!;
        expect(card.textContent).not.toMatch(/판정 확인 중/);
        expect(card.textContent).not.toMatch(/계산 제외/);
        expect(card.textContent).toMatch(/취득/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    expect(cards.some((card) => /판정 확인 중/.test(card.textContent ?? ""))).toBe(true);
    // 카드가 판정을 모른다는데 칩이 "취득 10"이라 하면 두 이야기다.
    const chips = [...container.querySelectorAll("button[aria-pressed]")].filter(
      (chip) => !/^전체/.test(chip.textContent ?? ""),
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([]);
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => engine.estimate(input));
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/거래가 너무 많아 일부만 불러왔습니다/);
    const before = calls;
    fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
    // 경고만 띄우고 막으면 "전체 거래"가 거짓이다. 계속 받을 수 있어야 한다.
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  });
});

describe("파생 표면 전체가 '지금 것인가'를 지킨다", () => {
  it("판정 재조회 중에는 판정 기준 카드가 옛 총액을 단정하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/독일 룰셋으로 판정 중/);
    expect(screen.getByLabelText("판정 기준").textContent).toMatch(/2025년 세금/);

    // 재조회를 멈춰 세운다. 이때 옛 총액이 남으면 거짓이다.
    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await waitFor(() =>
      expect(screen.getByLabelText("판정 기준").textContent).toMatch(/불러오는 중/),
    );
    expect(screen.getByLabelText("판정 기준").textContent).not.toMatch(/년 세금/);
  });

  it("비교 국가와 한계 기여도도 재조회 중이면 옛 값을 보이지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    fireEvent.click(screen.getByText(rowLabel(target)));
    await screen.findByText("거래 상세");
    await screen.findByText(/예전이력/);

    ports.getById.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["events", "detail", target.id] });
    await waitFor(() => expect(screen.queryByText(/예전이력/)).not.toBeInTheDocument());
  });
});

describe("믿을 수 있는 기간이 없으면 과세연도를 단정하지 않는다", () => {
  it("요약이 실패하면 판정 기준 카드가 연도·부담을 말하지 않는다", async () => {
    ports.getSummary.mockRejectedValue(new Error("boom"));
    renderDashboard("DE");
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });
    // 지갑 기간을 모르는데 "2026년 세금"이라 말하면 근거 없는 단정이다.
    const basis = screen.getByLabelText("판정 기준");
    expect(basis.textContent).not.toMatch(/년 세금/);
    // 요청조차 하지 않았으므로 "불러오는 중"이라 말하면 없는 진행을 지어내는 것이다.
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
    expect(basis.textContent).not.toMatch(/불러오는 중/);

    // 카드도 같은 말을 해야 한다. 기준 카드는 "계산 안 함"인데 행이 "확인 중"이면 모순이다.
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => /판정 확인 중/.test(card.textContent ?? ""))).toBe(false);
    const explained = cards.filter((card) =>
      /판정 미계산 · 기준 기간 확인 필요|중복 id|계산 제외/.test(card.textContent ?? ""),
    );
    expect(explained.length).toBe(cards.length);
  });
});

describe("부담이 0일 때도 세금 문구는 한 곳에만", () => {
  it("'부담 없음'이 화면에 한 번만 나오고 거래 카드에는 없다", async () => {
    // 손실만 있는 지갑을 만들어 부담을 0으로 만든다.
    // 취득만 있는 지갑은 처분·소득이 없어 부담이 반드시 0이다.
    const acquireOnly = events
      .filter((event) => event.classification === "RECEIVE" && event.price_status !== "UNKNOWN")
      .slice(0, 2);
    expect(acquireOnly.length, "픽스처에 취득 이벤트가 있어야 한다").toBeGreaterThan(0);
    setListEvents(acquireOnly);
    const { container } = renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const basis = screen.getByLabelText("판정 기준");
    expect(basis.textContent, "처분·소득이 없으면 부담은 0이다").toContain("부담 없음");
    expect((document.body.textContent ?? "").split("부담 없음").length - 1).toBe(1);
    for (const card of [...container.querySelectorAll("section .mt-3.grid.gap-3 > button")]) {
      expect(card.textContent ?? "").not.toContain("부담 없음");
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const internal = events.find((event) => event.classification === "INTERNAL_TRANSFER")!;
    expect(screen.getByText(rowLabel(internal)).closest("button")!.textContent).toMatch(/처분 아님/);

    // 재조회가 실패하면 캐시된 행이 남는다. 그걸 현재 사실로 단정하면 거짓이다.
    ports.list.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "list"] });
    await screen.findByText(/목록을 갱신하지 못했습니다. 아래 내용은 마지막으로 받은 상태입니다/, undefined, {
      timeout: 3000,
    });
    // 내부 이체 카드도 예외가 아니다. `이동 · 처분 아님`은 분류가 아니라 판정 주장이다.
    const internalCard = screen.getByText(rowLabel(internal)).closest("button")!;
    expect(internalCard.textContent).toMatch(/판정 확인 중/);
    expect(internalCard.textContent).not.toMatch(/처분 아님/);
    // 전 카드가 판정을 보류해야 한다.
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    const asserting = cards.filter((card) =>
      /취득 · |소득 · |과세 대상|비과세 · |손실 · |처분 아님|계산 제외/.test(card.textContent ?? ""),
    );
    expect(asserting.map((card) => card.textContent)).toEqual([]);

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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    fireEvent.click(screen.getByText(rowLabel(internal)));
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
    await screen.findByText(/독일 룰셋으로 판정 중/);

    // 판정 조회를 실패시키고, 이어서 기준 기간까지 잃는다.
    ports.estimate.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await screen.findByText(/판정 기준을 불러오지 못했습니다/, undefined, { timeout: 3000 });

    ports.getSummary.mockRejectedValue(new Error("boom"));
    void client.invalidateQueries({ queryKey: ["events", "summary"] });
    await screen.findByText(/요약을 불러오지 못했습니다/, undefined, { timeout: 3000 });

    // 기준 기간이 없으면 애초에 요청하지 않았다. 옛 오류를 현재 상태로 말하면 안 된다.
    expect(screen.getByText("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/판정 기준을 불러오지 못했습니다/)).not.toBeInTheDocument();

    // 행도 같은 말을 해야 한다.
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.some((card) => /판정 불러오기 실패/.test(card.textContent ?? ""))).toBe(false);
    // some이 아니라 전수로 본다. 한 장만 맞아도 통과하면 회귀 신호가 흐려진다.
    const notExplained = cards.filter(
      (card) => !/판정 미계산 · 기준 기간 확인 필요|중복 id/.test(card.textContent ?? ""),
    );
    expect(notExplained.map((card) => card.textContent)).toEqual([]);
  });

  it("캐시가 있어도 기준 기간이 없으면 기준 카드·행이 답하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardView countryCode="DE" />
      </QueryClientProvider>,
    );
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const basisBefore = screen.getByLabelText("판정 기준").textContent ?? "";
    expect(basisBefore).toMatch(/년 세금/);

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
    const basis = screen.getByLabelText("판정 기준");
    expect(basis.textContent).not.toMatch(/년 세금/);
    expect(basis.textContent).toBe("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.");
    const cards = [...document.querySelectorAll("section .mt-3.grid.gap-3 > button")];
    expect(cards.some((card) => /취득 · 원가 기록/.test(card.textContent ?? ""))).toBe(false);
  });
});

describe("산출 불가 국가는 한계 기여도를 답하지 않는다", () => {
  it("한국 상세가 '부담에 영향 없음'이라 말하지 않는다", async () => {
    // 테스트 계정 거주국이 KR이므로 이건 기본 경로다.
    renderDashboard("KR");
    await screen.findByText(/한국 룰셋으로 판정 중/);
    expect(screen.getByLabelText("판정 기준").textContent).toContain("산출 불가");

    // 요약 건수는 가격·분류만 보고 센다. 룰셋이 미확정인데 "과세 대상"이라 하면 단정이다.
    expect(screen.queryByText("과세 대상 이벤트")).not.toBeInTheDocument();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();
    expect(document.body.textContent ?? "").toContain("과세 여부는 아직 판단하지 않았습니다");

    fireEvent.click(screen.getByText(rowLabel(events[0])));
    await screen.findByText("거래 상세");
    await screen.findByText("다른 나라였다면");

    // 결정적 검증: 애초에 한계 기여도를 **요청하지 않아야** 한다.
    // 부재만 보면 비동기 응답이 늦게 도착하는 구현에서도 통과해버린다.
    const marginalCalls = ports.estimate.mock.calls.filter(([input]) => input?.includeMarginal === true);
    expect(marginalCalls, "산출 불가 국가에 한계 기여도를 요청하면 안 된다").toEqual([]);
    // 헤더가 "산출 불가"인데 상세가 "영향 없음"이라 하면 정면 모순이다.
    expect(screen.queryByText("이 거래가 없었다면")).not.toBeInTheDocument();
    expect(screen.queryByText(/부담에 영향 없음/)).not.toBeInTheDocument();
  });

  it("확정 룰셋에서도 '과세 대상'이라 단정하지 않는다", async () => {
    // 이 건수는 가격·분류가 확정돼 계산에 들어간 수일 뿐,
    // 취득·비과세·상계 소멸까지 포함한다. "과세 대상"이라 부르면 과장이다.
    renderDashboard("DE");
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);

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
    ports.getSummary.mockResolvedValue({
      periodPnl: "0",
      computableEventCount: 0,
      taxableEventCount: 0,
      pendingReviewCount: 3,
      currency: "KRW",
      period: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-26T00:00:00.000Z" },
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
    await screen.findByText("계산할 거래 없음");
    // 헤더에 ` ~ `만 보이면 기간이 있는 것처럼 말하는 셈이다.
    const header = container.querySelector('[data-surface="dashboard-summary"]')!;
    expect(header.textContent).toContain("기간 미정");
    expect(header.textContent).not.toMatch(/\s~\s*$/);
    // 빈 기간을 그대로 쓰면 "NaN년 세금"이 된다.
    const basis = screen.getByLabelText("판정 기준");
    expect(basis.textContent).not.toMatch(/NaN/);
    expect(basis.textContent).toBe("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.");
  });
});

describe("잘못된 기간에서 헤더와 판정 기준이 갈리지 않는다", () => {
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
      await screen.findByText("계산할 거래 없음");

      const header = container.querySelector('[data-surface="dashboard-summary"]')!;
      expect(header.textContent).toContain("기간 미정");
      // 헤더는 "기간 미정"인데 판정 기준이 "2025년 세금"이라 하면 같은 화면이 두 이야기를 한다.
      const basis = screen.getByLabelText("판정 기준");
      expect(basis.textContent).toBe("기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.");
      expect(basis.textContent).not.toMatch(/년 세금|NaN/);
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
    const card = await screen.findByText(rowLabel(target));
    await waitFor(
      () => expect(card.closest("button")!.textContent).toMatch(/보유기간 취득분마다 다름/),
      { timeout: SETTLE_TIMEOUT },
    );
    expect(card.closest("button")!.textContent).toMatch(/취득분 3건/);
  });
});

describe("금액을 보이는 곳이면 그 한계도 같이 말한다", () => {
  it("판정 기준 카드가 계산의 한계를 함께 밝힌다", async () => {
    // 세금 탭에만 한계를 두면 대시보드만 보는 사용자는 근사인 줄 모른다.
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => {
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
    const card = await screen.findByLabelText("판정 기준");
    await waitFor(() => expect(card.textContent).toMatch(/이 금액이 흔들리는 지점 2건/), { timeout: SETTLE_TIMEOUT });
    expect(card.textContent).toMatch(/대체 취득분 원가/);
    expect(card.querySelector('a[href="/tax"]')).not.toBeNull();
  });

  it("한계가 없으면 없는 말을 만들지 않는다", async () => {
    renderDashboard("DE");
    const card = await screen.findByLabelText("판정 기준");
    await waitFor(() => expect(card.textContent).toMatch(/년 세금/), { timeout: SETTLE_TIMEOUT });
    expect(card.textContent).not.toMatch(/흔들리는 지점 0건/);
  });
});

describe("상세 시트가 손익 계산 4줄을 보인다", () => {
  it("양도가액 − 취득가액 − 수수료 = 손익을 그대로 그린다", async () => {
    const target = events.find((event) => derived.events.some((tax) => tax.id === event.id && tax.kind === "DISPOSE"))!;
    // fallback으로 아무 이벤트에나 가짜 행을 붙이면 실제 처분 경로가 검증되지 않는다.
    expect(target, "처분 이벤트가 픽스처에 없다").toBeDefined();
    ports.estimate.mockImplementation(async (input: Parameters<MockTaxEngine["estimate"]>[0]) => {
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
    await screen.findByText(/독일 룰셋으로 판정 중/);
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
