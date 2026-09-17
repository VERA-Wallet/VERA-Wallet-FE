import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsView } from "@/components/transactions/transactions-view";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";

/**
 * 브릿지 두 다리 표시 계약 — 같은 bridge_group_id의 출발(OUT)+도착(IN)이:
 * 1) 목록에서 **한 행**으로 묶이고(도착 다리는 별도 행 없음), 대표 행이 "브릿지"와 도착 체인을 말하며,
 * 2) bridge_group_id가 없는 단독 이동(IN)은 여전히 "이동"으로 별도 행을 그리고,
 * 3) 사용자가 한쪽을 INTERNAL_TRANSFER 밖으로 재분류하면 페어링이 깨져 두 행이 각자 남는다.
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

const ACROSS = "0x09aea4b2242abc8bb4bb78d537a67a245a7bec64";

function event(over: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  return {
    tx_hash: `0x${over.id.padEnd(8, "0")}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2026-07-24T00:00:00.000Z",
    wallet_address: "0xf8d0000000000000000000000000000000efad",
    direction: "OUT",
    asset_type: "NATIVE",
    asset_contract: null,
    asset_symbol: "ETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "100000000000000",
    counterparty: ACROSS,
    gas_fee_native: "0.0004",
    classification: "INTERNAL_TRANSFER",
    confidence: 0.95,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "500000.00",
    fiat_currency: "KRW",
    income_kind: null,
    group_id: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...over,
  };
}

function mountWith(events: NormalizedEvent[]) {
  const engine = new TaxEngineService(() => events);
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getById.mockReset();
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.list.mockResolvedValue({ items: events.map((item, index) => ({ event: item, version: index + 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue({
    periodPnl: "0",
    computableEventCount: events.length,
    taxableEventCount: 0,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: events[0].block_timestamp, to: events[events.length - 1].block_timestamp },
  });
  ports.getById.mockImplementation(async (id: string) => ({
    event: events.find((item) => item.id === id)!,
    version: 1,
    override_history: [],
  }));
  ports.listRuleSets.mockResolvedValue([]);
  ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TransactionsView countryCode="KR" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("브릿지 두 다리는 한 행으로 묶인다", () => {
  it("페어링된 브릿지 — 출발(OUT) 행만 남고 도착(IN) 행은 별도로 렌더하지 않는다", async () => {
    const bridgeOut = event({
      id: "bridge-out",
      classification: "INTERNAL_TRANSFER",
      direction: "OUT",
      bridge_group_id: "brg-1",
      bridge_dest_chain_id: 10,
    });
    const bridgeIn = event({
      id: "bridge-in",
      chain_id: 10,
      classification: "INTERNAL_TRANSFER",
      direction: "IN",
      bridge_group_id: "brg-1",
      raw_amount: "99940500000000",
      counterparty: ACROSS,
    });

    mountWith([bridgeOut, bridgeIn]);

    const row = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="bridge-out"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    // 대표(OUT) 행이 "브릿지"와 도착 체인을 말한다 — 실제 데이터와 같은 표시.
    expect(row.textContent).toContain("브릿지");
    // 체인 이름은 보이는 티커 줄이 아니라 스크린리더용 sr-only에만 있다 — 시각적으로는 로고의 체인 배지 두 개가 말한다.
    const label = row.querySelector("[data-event-label]");
    expect(label?.textContent).not.toContain("Ethereum");
    expect(label?.textContent).not.toContain("Optimism");
    expect(row.querySelector(".sr-only")?.textContent).toContain("Ethereum → Optimism");
    // 도착(IN) 다리는 별도 행으로 렌더하지 않는다 — 두 행이면 브릿지 1건이 거래 2건처럼 보인다.
    expect(document.querySelector('button[data-event-id="bridge-in"]')).toBeNull();
  });

  it("bridge_group_id가 없는 단독 이동은 여전히 '이동'으로 별도 행에 남는다", async () => {
    const lonelyMove = event({
      id: "lonely-move",
      classification: "INTERNAL_TRANSFER",
      direction: "IN",
      bridge_group_id: null,
      bridge_dest_chain_id: null,
    });

    mountWith([lonelyMove]);

    const row = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="lonely-move"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    expect(row.textContent).toContain("이동");
  });

  it("사용자가 한쪽을 INTERNAL_TRANSFER 밖으로 재분류하면 페어링이 깨져 두 행이 각자 남는다", async () => {
    const bridgeOut = event({
      id: "bridge-out-2",
      classification: "INTERNAL_TRANSFER",
      direction: "OUT",
      bridge_group_id: "brg-2",
      bridge_dest_chain_id: 10,
    });
    const bridgeIn = event({
      id: "bridge-in-2",
      chain_id: 10,
      classification: "INTERNAL_TRANSFER",
      direction: "IN",
      bridge_group_id: "brg-2",
      // 사용자가 "이건 자기이동이 아니라 받은 것"이라고 재분류 — 이 판단을 페어링이 지워선 안 된다.
      user_override: { classification: "RECEIVE", reason: "실제로는 받은 선물", overridden_at: "2026-07-25T00:00:00.000Z" },
    });

    mountWith([bridgeOut, bridgeIn]);

    const outRow = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="bridge-out-2"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    // IN 다리도 이제 별도 행으로 렌더한다(페어링 해제).
    const inRow = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="bridge-in-2"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    expect(outRow.textContent).toContain("브릿지");
    expect(inRow.textContent).toContain("수신");
  });
});

describe("자산이 바뀌는 브릿지(브릿지 스왑)도 한 행으로 묶인다", () => {
  it("Mayan 케이스 — Polygon USDT 처분(EXCHANGE) + Ethereum USDC 취득(RECEIVE)이 한 행에 양쪽 수량·체인을 보인다", async () => {
    const mayanOut = event({
      id: "mayan-out",
      chain_id: 137,
      asset_symbol: "USDT",
      decimals: 6,
      raw_amount: "17270000",
      classification: "EXCHANGE",
      direction: "OUT",
      group_id: null,
      bridge_group_id: "mayan-1",
      bridge_dest_chain_id: 1,
      counterparty: "0x0654a6f9b13fdd9e396f2ceeef0e0c8f3d5b7c11",
    });
    const mayanIn = event({
      id: "mayan-in",
      chain_id: 1,
      asset_symbol: "USDC",
      decimals: 6,
      raw_amount: "15940000",
      classification: "RECEIVE",
      direction: "IN",
      group_id: null,
      bridge_group_id: "mayan-1",
      counterparty: "0x0654a6f9b13fdd9e396f2ceeef0e0c8f3d5b7c11",
    });

    mountWith([mayanOut, mayanIn]);

    const row = await waitFor(() => {
      const found = document.querySelector('button[data-event-id="mayan-out"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    // 대표(OUT) 행이 보낸 자산·받은 자산·양쪽 체인을 한 줄로 말한다.
    expect(row.textContent).toContain("브릿지 스왑");
    expect(row.textContent).toContain("17.27 USDT");
    expect(row.textContent).toContain("15.94 USDC");
    // 체인 이름은 보이는 티커 줄에 쓰지 않는다 — 출발·도착은 로고의 체인 배지 두 개, 스크린리더는 sr-only로 읽는다.
    const label = row.querySelector("[data-event-label]");
    expect(label?.textContent).not.toContain("Polygon");
    expect(label?.textContent).not.toContain("Ethereum");
    expect(row.querySelector(".sr-only")?.textContent).toContain("Polygon → Ethereum");
    // 도착(IN) 다리는 별도 행으로 렌더하지 않는다.
    expect(document.querySelector('button[data-event-id="mayan-in"]')).toBeNull();
  });

  it("같은 bridge_group_id에 IN이 둘이면(모호) 페어링하지 않고 세 행을 각자 그대로 둔다", async () => {
    const out = event({
      id: "multi-out",
      chain_id: 137,
      asset_symbol: "USDT",
      classification: "EXCHANGE",
      direction: "OUT",
      group_id: null,
      bridge_group_id: "b-multi",
      bridge_dest_chain_id: 1,
    });
    const in1 = event({
      id: "multi-in-1",
      chain_id: 1,
      asset_symbol: "USDC",
      classification: "RECEIVE",
      direction: "IN",
      group_id: null,
      bridge_group_id: "b-multi",
    });
    const in2 = event({
      id: "multi-in-2",
      chain_id: 1,
      asset_symbol: "USDC",
      classification: "RECEIVE",
      direction: "IN",
      group_id: null,
      bridge_group_id: "b-multi",
    });

    mountWith([out, in1, in2]);

    await waitFor(() => {
      expect(document.querySelector('button[data-event-id="multi-out"]')).not.toBeNull();
      expect(document.querySelector('button[data-event-id="multi-in-1"]')).not.toBeNull();
      expect(document.querySelector('button[data-event-id="multi-in-2"]')).not.toBeNull();
    });
  });
});
