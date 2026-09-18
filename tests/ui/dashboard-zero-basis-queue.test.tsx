import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
// 탭·목록이 요약에서 떠난 뒤로 취득가 0원 큐가 서는 자리는 거래 화면 하나뿐이다.
import { TransactionsView } from "@/components/transactions/transactions-view";
import { assetTicker, chainLabel, formatSignedTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), reclassify: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify },
  summaryProvider: { getSummary: ports.getSummary },
}));

function label(event: NormalizedEvent) {
  // 목록 티커 줄과 같은 규칙: 스왑은 "보낸 → 받은", 브릿지는 "출발 → 도착 · 자산",
  // NFT는 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커.
  if (event.swap_to_symbol !== null) return `${assetTicker(event)} → ${event.swap_to_symbol}`;
  if (event.bridge_dest_chain_id !== null) return `${formatSignedTokenAmount(event)} ${assetTicker(event)} · ${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`;
  if (event.token_id !== null) return assetTicker(event);
  return `${formatSignedTokenAmount(event)} ${assetTicker(event)}`;
}

/**
 * 취득가 0원 해결 큐 = 거래 화면 "확인 필요" 탭.
 * 가격 미확정 취득은 여기에 나오고(취득가 0원의 원인), 금액 override를 채우면
 * `taxExclusionReason`이 계산 대상으로 인정해 큐에서 빠진다(review.ts 단일 판정).
 */
it("가격 미확정 취득은 확인 필요 큐에 나오고, 금액 override를 채운 건은 빠진다", async () => {
  const source = createNormalizedEventFixtures()[1];
  const open: NormalizedEvent = {
    ...source,
    id: "zero-basis-open",
    classification: "RECEIVE",
    // 취득은 자산이 들어온 것이라 IN이다. source(event-02)는 OUT이므로 맞춰 준다 —
    // 안 맞추면 방향·분류 정합 게이트가 RECEIVE+OUT을 모순으로 잡는다.
    direction: "IN",
    raw_amount: "200000000000000000",
    price_status: "UNKNOWN",
    fiat_value: null,
    user_override: null,
    value_override: null,
  };
  const filled: NormalizedEvent = {
    ...source,
    id: "zero-basis-filled",
    classification: "RECEIVE",
    direction: "IN",
    raw_amount: "500000000000000000",
    price_status: "UNKNOWN",
    fiat_value: null,
    user_override: null,
    value_override: {
      acquisition_cost: "1000000",
      disposal_value: null,
      incidental_cost: null,
      gas_fee: null,
      price_source: "업비트 종가",
      evidence_url: null,
      deemed_expense_50: false,
      overridden_at: "2027-01-02T00:00:00.000Z",
    },
  };
  ports.list.mockResolvedValue({ items: [open, filled].map((event, index) => ({ event, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({ periodPnl: "1", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 1, currency: "KRW", period: { from: "a", to: "b" } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TransactionsView /></QueryClientProvider>);

  await screen.findByText(label(open));
  fireEvent.click(screen.getByRole("tab", { name: "확인 필요" }));
  // 미채운 취득은 큐에 남고, override로 취득가액을 채운 취득은 큐에서 빠진다.
  expect(screen.getByText(label(open))).toBeInTheDocument();
  expect(screen.queryByText(label(filled))).not.toBeInTheDocument();
});
