import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { formatSignedTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), reclassify: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({ eventRepository: { list: ports.list, reclassify: ports.reclassify }, summaryProvider: { getSummary: ports.getSummary } }));

it("filters review tab to unknown price, unknown classification, or low confidence", async () => {
  const [resolved, source] = createNormalizedEventFixtures();
  const unknownPrice = { ...source, id: "unknown-price", raw_amount: "200000000000000000", price_status: "UNKNOWN" as const, fiat_value: null };
  const unknownClassification = { ...source, id: "unknown-classification", raw_amount: "300000000000000000", classification: "UNKNOWN" as const };
  const lowConfidence = { ...source, id: "low-confidence", raw_amount: "400000000000000000", confidence: 0.3 };
  ports.list.mockResolvedValue({ items: [resolved, unknownPrice, unknownClassification, lowConfidence].map((event, index) => ({ event, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({ periodPnl: "1", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 3, currency: "KRW", period: { from: "a", to: "b" } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardView /></QueryClientProvider>);
  // 얻은 것은 `+`, 쓴 것은 `-`. 부호까지가 카드 제목이다.
  const resolvedLabel = formatSignedTokenAmount(resolved);
  await screen.findByText(`${resolvedLabel} · ETH`);
  fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
  expect(screen.queryByText(`${resolvedLabel} · ETH`)).not.toBeInTheDocument();
  // 심볼이 채워지면 목록은 "ERC20"이 아니라 토큰 이름을 부른다.
  // 분류가 UNKNOWN인 건은 쓴 것도 얻은 것도 아니라 부호를 붙이지 않는다 — 붙이면 처분이라 단정하는 셈이다.
  expect(screen.getByText("-0.2 · USDC")).toBeInTheDocument();
  expect(screen.getByText("0.3 · USDC")).toBeInTheDocument();
  expect(screen.getByText("-0.4 · USDC")).toBeInTheDocument();
});

it("방향·분류 모순 건이 사유와 함께 확인 필요 큐에 나온다", async () => {
  const [resolved, source] = createNormalizedEventFixtures();
  // 체인상 OUT인데 자동 분류가 RECEIVE(취득)다 — 나간 자산을 취득으로 기록할 뻔한 모순.
  const conflict = { ...source, id: "dir-conflict", raw_amount: "200000000000000000", classification: "RECEIVE" as const, direction: "OUT" as const };
  ports.list.mockResolvedValue({ items: [resolved, conflict].map((event, index) => ({ event, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({ periodPnl: "1", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 1, currency: "KRW", period: { from: "a", to: "b" } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DashboardView /></QueryClientProvider>);

  const resolvedLabel = formatSignedTokenAmount(resolved);
  await screen.findByText(`${resolvedLabel} · ETH`);
  fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
  // 정합 건은 큐에서 빠지고, 모순 건은 "방향·분류 불일치" 사유와 함께 남는다.
  expect(screen.queryByText(`${resolvedLabel} · ETH`)).not.toBeInTheDocument();
  expect(screen.getByText("방향·분류 불일치")).toBeInTheDocument();
});
