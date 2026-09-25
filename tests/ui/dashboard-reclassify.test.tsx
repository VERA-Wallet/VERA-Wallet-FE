import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { assetTicker, chainLabel, formatSignedTokenAmount } from "@/lib/format";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), reclassify: vi.fn(), getById: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify, getById: ports.getById },
  summaryProvider: { getSummary: ports.getSummary },
}));

// 목록 행은 원시 단위가 아니라 decimals를 반영한 표시 수량으로 렌더링된다.
function rowLabel(event: NormalizedEvent) {
  // 목록 티커 줄과 같은 규칙: 스왑은 "보낸 → 받은", 브릿지는 "출발 → 도착 · 자산",
  // NFT는 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커.
  if (event.swap_to_symbol !== null) return `${assetTicker(event)} → ${event.swap_to_symbol}`;
  if (event.bridge_dest_chain_id !== null) return `${formatSignedTokenAmount(event)} ${assetTicker(event)} · ${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`;
  if (event.token_id !== null) return assetTicker(event);
  return `${formatSignedTokenAmount(event)} ${assetTicker(event)}`;
}

function setup(result: unknown, history: unknown[] = []) {
  const event = createNormalizedEventFixtures()[0];
  ports.list.mockResolvedValue({ items: [{ event, version: 1 }], nextCursor: null });
  ports.getSummary.mockResolvedValue({ periodPnl: "1", computableEventCount: 1, taxableEventCount: 1, pendingReviewCount: 0, currency: "KRW", period: { from: "a", to: "b" } });
  ports.reclassify.mockResolvedValue(result);
  ports.getById.mockResolvedValue({ event, version: 1, override_history: history });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><TransactionsView /></QueryClientProvider>);
  return { event, invalidate };
}

describe("거래 탭 reclassification", () => {
  it("invalidates event, detail, and summary queries after an accepted change", async () => {
    const event = createNormalizedEventFixtures()[0];
    const { invalidate } = setup({ status: "ok", event: { ...event, classification: "SEND" }, version: 2 });
    fireEvent.click(await screen.findByText(rowLabel(event)));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await screen.findByText("거래 상세");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "list"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "detail", event.id] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "summary"] });
  });

  it("resynchronizes conflict data, refreshes derived views, and explains it", async () => {
    const event = createNormalizedEventFixtures()[0];
    const latest = { ...event, user_override: { classification: "SEND" as const, reason: "latest", overridden_at: "2025-01-02T00:00:00.000Z" } };
    const { invalidate } = setup({ status: "conflict", event: latest, version: 2 });
    fireEvent.click(await screen.findByText(rowLabel(event)));
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText("금액이 변경되었습니다. 최신 내용을 확인해 주세요.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("latest")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "detail", event.id] });
    // 충돌 응답도 최신 이벤트를 실어 온다. 요약·판정을 갱신하지 않으면
    // 확인 필요 탭은 비었는데 요약 카드만 옛 건수를 말하는 모순이 생긴다.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "summary"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tax", "estimate"] });
  });

  it("shows the appended transition after the detail query refreshes", async () => {
    const event = createNormalizedEventFixtures()[0];
    setup({ status: "ok", event: { ...event, classification: "SEND" }, version: 2 });
    fireEvent.click(await screen.findByText(rowLabel(event)));
    await screen.findByText("거래 상세");
    // 적용 직후 detail 캐시가 무효화되며, 갱신된 응답의 전이가 이력 섹션에 나타난다.
    ports.getById.mockResolvedValue({
      event,
      version: 2,
      override_history: [{ from: event.classification, to: "SEND", reason: "정정", overridden_at: "2025-02-01T00:00:00.000Z" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(await screen.findByText("재분류 이력")).toBeInTheDocument();
    expect(await screen.findByText(/SEND/, { selector: "li" })).toBeInTheDocument();
  });
});
