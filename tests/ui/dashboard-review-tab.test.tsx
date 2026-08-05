import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { formatTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

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
  const resolvedAmount = formatTokenAmount(resolved.raw_amount, resolved.decimals);
  await screen.findByText(`${resolvedAmount} · ETH`);
  fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
  expect(screen.queryByText(`${resolvedAmount} · ETH`)).not.toBeInTheDocument();
  expect(screen.getByText("0.2 · ERC20")).toBeInTheDocument();
  expect(screen.getByText("0.3 · ERC20")).toBeInTheDocument();
  expect(screen.getByText("0.4 · ERC20")).toBeInTheDocument();
});
