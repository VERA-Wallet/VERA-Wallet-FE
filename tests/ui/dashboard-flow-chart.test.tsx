import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FlowChart } from "@/components/dashboard/flow-chart";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

function event(overrides: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  const merged: NormalizedEvent = {
    tx_hash: `0x${overrides.id}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2025-01-10T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "IN",
    asset_type: "NATIVE",
    asset_contract: null,
    asset_symbol: "ETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "1000000000000000000",
    counterparty: "0x2222222222222222222222222222222222222222",
    gas_fee_native: "0.001",
    classification: "RECEIVE",
    confidence: 0.9,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: "1000000",
    fiat_currency: "KRW",
    income_kind: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    ...overrides,
  };
  // 방향을 지정하지 않은 케이스는 분류에 맞춰 준다(SEND는 OUT, 그 외는 IN).
  // 방향·분류 정합 게이트가 SEND+IN을 모순으로 걸러 선에서 빼지 않도록, 정상 SEND에 맞는 방향을 준다.
  if (overrides.direction === undefined) {
    merged.direction = merged.classification === "SEND" ? "OUT" : "IN";
  }
  return merged;
}

/** 1/10 +100만 → 2/10 −40만 → 3/10 +20만. 마지막 누적은 80만원이다. */
const wallet: NormalizedEvent[] = [
  event({ id: "a", classification: "RECEIVE", fiat_value: "1000000", block_timestamp: "2025-01-10T00:00:00.000Z" }),
  event({ id: "b", classification: "SEND", fiat_value: "400000", block_timestamp: "2025-02-10T00:00:00.000Z" }),
  event({ id: "c", classification: "RECEIVE", fiat_value: "200000", block_timestamp: "2025-03-10T00:00:00.000Z" }),
];

const chart = () => screen.getByLabelText("누적 순유입");

describe("내역 화면의 지갑 이력 그래프", () => {
  it("누적 금액과 선을 함께 보이고, 세금은 한 마디도 하지 않는다", () => {
    render(<FlowChart events={wallet} state="ready" />);

    expect(screen.getByTestId("flow-total").textContent).toBe("₩800,000");
    // 선이 실제로 그려졌는가 — 점 수만큼 좌표가 있어야 한다.
    const line = screen.getByTestId("flow-line").getAttribute("d") ?? "";
    expect(line.match(/[ML]/g)).toHaveLength(3);
    expect(chart().textContent).not.toMatch(/세금|부담|과세/);
  });

  it("이 선이 무엇이 아닌지를 같은 자리에서 말한다", () => {
    render(<FlowChart events={wallet} state="ready" />);
    // "평가액"으로 읽히면 우리가 갖고 있지 않은 현재 시세를 주장하는 화면이 된다.
    expect(chart().textContent).toContain("지금 시세로 평가한 금액이 아닙니다");
  });

  it("기간을 바꾸면 그 기간의 변화만 다시 잰다", () => {
    render(<FlowChart events={wallet} state="ready" />);
    // 전체 구간은 0에서 시작하므로 변화율을 말할 수 없다.
    expect(screen.getByTestId("flow-change").textContent).toContain("+₩800,000");
    expect(screen.getByTestId("flow-change").textContent).not.toContain("%");

    fireEvent.click(screen.getByRole("button", { name: "1개월" }));

    // 마지막 거래(3/10) 기준 30일. 1/10 건은 창 밖이라 기준값(100만)이 된다.
    const change = screen.getByTestId("flow-change").textContent ?? "";
    expect(change).toContain("-₩200,000");
    expect(change).toContain("20%");
    expect(chart().textContent).toContain("1개월 변화");
  });

  it("선에 넣지 못한 거래는 이유와 건수를 밝힌다", () => {
    render(
      <FlowChart
        events={[
          ...wallet,
          event({ id: "d", price_status: "UNKNOWN", fiat_value: null, block_timestamp: "2025-03-11T00:00:00.000Z" }),
          event({ id: "e", classification: "INTERNAL_TRANSFER", block_timestamp: "2025-03-12T00:00:00.000Z" }),
        ]}
        state="ready"
      />,
    );
    expect(chart().textContent).toContain("가격·분류 미확정 1건 · 자기 지갑 간 이체 1건은 선에 없습니다.");
  });

  it("그릴 거래가 없으면 금액 자리를 비우고 이유를 말한다", () => {
    render(<FlowChart events={[event({ id: "a", price_status: "UNKNOWN", fiat_value: null })]} state="ready" />);
    // `—`도 0도 "값이 있다"는 인상을 준다. 아예 두지 않는다.
    expect(screen.queryByTestId("flow-total")).not.toBeInTheDocument();
    expect(chart().textContent).toContain("선을 그릴 거래가 없습니다.");
    expect(chart().textContent).toContain("가격·분류 미확정 1건은 선에 없습니다.");
  });

  it("거래가 한 건뿐이면 선을 그리는 척하지 않는다", () => {
    render(<FlowChart events={[wallet[0]]} state="ready" />);
    expect(screen.queryByTestId("flow-line")).not.toBeInTheDocument();
    expect(chart().textContent).toContain("거래가 한 건뿐이라 선을 그릴 수 없습니다.");
    // 그래도 누적값 자체는 사실이므로 지우지 않는다.
    expect(screen.getByTestId("flow-total").textContent).toBe("₩1,000,000");
  });

  it("목록이 갱신 중이거나 실패했으면 이 선이 마지막 상태임을 밝힌다", () => {
    const { rerender } = render(<FlowChart events={wallet} state="pending" />);
    expect(chart().textContent).toContain("목록을 갱신하는 중입니다");

    rerender(<FlowChart events={wallet} state="error" />);
    expect(chart().textContent).toContain("목록을 갱신하지 못했습니다");

    rerender(<FlowChart events={wallet} state="ready" />);
    expect(chart().textContent).not.toContain("마지막으로 받은 거래로 그렸습니다");
  });

  it("목록을 일부만 받아왔으면 선도 일부라고 말한다", () => {
    render(<FlowChart events={wallet} state="ready" truncated />);
    expect(chart().textContent).toContain("거래를 일부만 불러와 이 선도 일부입니다.");
  });

  it("고른 기간과 실제 날짜 범위를 함께 찍는다", () => {
    render(<FlowChart events={wallet} state="ready" />);
    const ranges = within(screen.getByLabelText("기간 선택"));
    expect(ranges.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    // "최근"이 무엇을 가리키는지 숨기지 않는다 — 기준은 벽시계가 아니라 마지막 거래다.
    expect(chart().textContent).toContain("마지막 거래 기준");
  });

  it("선 위의 한 지점을 짚으면 그때가 언제 얼마였는지 말한다", () => {
    render(<FlowChart events={wallet} state="ready" />);
    // 짚기 전에는 아무 값도 떠 있지 않다 — 없는 지점을 가리키는 말풍선은 거짓이다.
    expect(screen.queryByTestId("flow-point")).not.toBeInTheDocument();

    const layer = screen.getByRole("group", { name: /선 위 지점 살펴보기/ });
    // 방향키로도 짚을 수 있어야 한다. 포인터로만 읽히는 값은 없는 값과 같다.
    fireEvent.keyDown(layer, { key: "ArrowRight" });
    const point = screen.getByTestId("flow-point");
    expect(point.textContent).toContain("₩1,000,000");
    expect(point.textContent).toContain("2025. 1. 10.");

    fireEvent.keyDown(layer, { key: "ArrowRight" });
    expect(screen.getByTestId("flow-point").textContent).toContain("₩600,000");

    fireEvent.keyDown(layer, { key: "Escape" });
    expect(screen.queryByTestId("flow-point")).not.toBeInTheDocument();
  });

  it("짚은 값도 금액 가리기를 따른다", () => {
    render(<FlowChart events={wallet} state="ready" hideBalances />);
    fireEvent.keyDown(screen.getByRole("group", { name: /선 위 지점 살펴보기/ }), { key: "ArrowRight" });
    const point = screen.getByTestId("flow-point");
    expect(point.textContent).not.toContain("₩");
    // 금액만 가린다 — 언제인지는 가릴 이유가 없다.
    expect(point.textContent).toContain("2025. 1. 10.");
  });

  it("기간을 바꾸면 짚고 있던 자리를 놓는다", () => {
    render(<FlowChart events={wallet} state="ready" />);
    fireEvent.keyDown(screen.getByRole("group", { name: /선 위 지점 살펴보기/ }), { key: "ArrowRight" });
    expect(screen.getByTestId("flow-point")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1개월" }));
    // 창이 달라지면 같은 인덱스는 더 이상 같은 거래가 아니다. 남겨 두면 엉뚱한 값을 짚는다.
    expect(screen.queryByTestId("flow-point")).not.toBeInTheDocument();
  });

  it("기간을 밖에서 정해 주면 그 창을 그대로 자른다", () => {
    const onSelect = vi.fn();
    render(
      <FlowChart
        events={wallet}
        state="ready"
        selection={{ kind: "custom", from: "2025-01-01", to: "2025-02-28" }}
        period={{
          fromMs: Date.parse("2025-01-01T00:00:00.000Z"),
          toMs: Date.parse("2025-02-28T23:59:59.999Z"),
          from: "2025-01-01",
          to: "2025-02-28",
        }}
        onSelect={onSelect}
      />,
    );
    // 1/10 +100만 → 2/10 −40만 = +60만. 3/10 건은 창 밖이라 들어오지 않는다.
    expect(screen.getByTestId("flow-change").textContent).toContain("+₩600,000");
    expect(chart().textContent).toContain("선택 기간 변화");
    // 프리셋 어느 것도 아니라는 사실을 숨기지 않는다.
    expect(screen.getByText("직접 지정")).toBeInTheDocument();

    // 제어 상태에서는 스스로 창을 바꾸지 않고 바꿔 달라고 말할 뿐이다.
    fireEvent.click(screen.getByRole("button", { name: "1개월" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "preset", id: "1M" });
    expect(screen.getByTestId("flow-change").textContent).toContain("+₩600,000");
  });
});
