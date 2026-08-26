import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { formatFiat } from "@/lib/format";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";

/**
 * 스왑 두 다리 표시 계약 — 같은 tx_hash의 처분(OUT)+취득(IN)이:
 * 1) 목록에서 **한 행**으로 묶이고(IN 다리는 별도 행 없음), 티커가 양쪽 수량을 말하며,
 * 2) 상대(컨트랙트 이름)는 목록이 아니라 **상세에서만** 보이고,
 * 3) 상세가 "스왑 구성"으로 받은 자산의 취득가액(이연 원가)을 밝힌다.
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

const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";

function event(over: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  return {
    tx_hash: `0x${over.id.padEnd(8, "0")}`,
    chain_id: 8453,
    log_index: 0,
    block_timestamp: "2025-07-10T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "OUT",
    asset_type: "ERC20",
    asset_contract: "0x2222222222222222222222222222222222222222",
    asset_symbol: "USDC",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 6,
    raw_amount: "1000000000",
    counterparty: "0x3333333333333333333333333333333333333333",
    gas_fee_native: "0.0004",
    classification: "EXCHANGE",
    confidence: 0.95,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "1400000.00",
    fiat_currency: "KRW",
    income_kind: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    ...over,
  };
}

// 취득(원가 풀) → 스왑 두 다리. 스왑 다리는 같은 tx_hash를 공유한다.
const acquire = event({
  id: "buy-usdc",
  classification: "RECEIVE",
  direction: "IN",
  block_timestamp: "2025-07-01T00:00:00.000Z",
  raw_amount: "2000000000",
  fiat_value: "2800000.00",
});
const swapOut = event({ id: "swap-out", tx_hash: "0xswap", counterparty: KYBER });
const swapIn = event({
  id: "swap-in",
  tx_hash: "0xswap",
  classification: "RECEIVE",
  direction: "IN",
  asset_type: "NATIVE",
  asset_contract: null,
  asset_symbol: "ETH",
  chain_id: 8453,
  decimals: 18,
  raw_amount: "310000000000000000",
  fiat_value: "1395000.00",
  counterparty: KYBER,
});
const events = [acquire, swapOut, swapIn];

const engine = new TaxEngineService(() => events);

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.list.mockResolvedValue({ items: events.map((item, index) => ({ event: item, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "0",
    computableEventCount: 3,
    taxableEventCount: 2,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: acquire.block_timestamp, to: swapIn.block_timestamp },
  });
  ports.getById.mockImplementation(async (id: string) => ({
    event: events.find((item) => item.id === id)!,
    version: 1,
    override_history: [],
  }));
  ports.listRuleSets.mockResolvedValue([]);
  ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
});

describe("스왑 두 다리는 한 행으로 묶인다", () => {
  it("목록은 양쪽 수량을 말하고 IN 다리를 별도 행으로 렌더하지 않는다 — 상대는 상세에서만", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DashboardView countryCode="KR" />
      </QueryClientProvider>,
    );

    // OUT 다리가 대표 행이다.
    const row = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="swap-out"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    // 얼마를(보낸 수량) 얼마만큼(받은 수량)으로 바꿨는지 한 줄이 말한다.
    expect(row.textContent).toContain("-1,000 USDC");
    expect(row.textContent).toContain("+0.31 ETH");
    // IN 다리는 별도 행으로 렌더하지 않는다 — 두 행이면 스왑 1건이 거래 2건처럼 보인다.
    expect(document.querySelector('button[data-event-id="swap-in"]')).toBeNull();
    // 상대(컨트랙트 이름)는 목록 행에 싣지 않는다(상세 전용).
    expect(row.textContent).not.toContain("KyberSwap");

    // 상세: 두 다리 구성과 받은 자산의 취득가액(이연 원가), 상대 이름.
    fireEvent.click(row);
    await screen.findByText("스왑 구성 — 한 거래, 두 다리");
    const sheet = screen.getByText("거래 상세").closest("div")!.parentElement!;
    expect(sheet.textContent).toContain("받은 자산 +0.31 ETH");
    expect(sheet.textContent).toContain(`취득가액 · ${formatFiat(swapIn.fiat_value, "KRW")}`);
    expect(sheet.textContent).toContain("손익 이연");
    expect(sheet.textContent).toContain("KyberSwap");
  });
});
