import { describe, expect, it } from "vitest";

import { FLOW_RANGES, buildFlowSeries, flowGeometry, windowOf } from "@/lib/portfolio/flow-series";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/** 선 계산에 실제로 쓰이는 칸만 바꿔가며 만든다. 나머지는 계산과 무관한 고정값이다. */
function event(overrides: Partial<NormalizedEvent> & { id: string }): NormalizedEvent {
  const merged: NormalizedEvent = {
    tx_hash: `0x${overrides.id}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2025-07-01T00:00:00.000Z",
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
    fiat_value: "1000",
    fiat_currency: "KRW",
    income_kind: null,
    group_id: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
    ...overrides,
  };
  // 방향을 지정하지 않은 케이스는 분류에 맞춰 준다(SEND는 OUT, 그 외는 IN).
  // 이 파일의 관심사는 흐름 부호이지 데이터 정합이 아니라 direction을 비워 두었는데,
  // 이제 방향·분류 정합 게이트가 SEND+IN을 모순으로 잡으므로 정상 SEND에 맞는 방향을 준다.
  if (overrides.direction === undefined) {
    merged.direction = merged.classification === "SEND" ? "OUT" : "IN";
  }
  return merged;
}

const rangeOf = (id: string) => FLOW_RANGES.find((range) => range.id === id)!;

describe("누적 순유입 선", () => {
  it("받은 것은 더하고 보낸 것은 뺀다", () => {
    const series = buildFlowSeries([
      event({ id: "a", classification: "RECEIVE", fiat_value: "1000", block_timestamp: "2025-07-01T00:00:00.000Z" }),
      event({ id: "b", classification: "SEND", fiat_value: "400", block_timestamp: "2025-07-02T00:00:00.000Z" }),
      event({ id: "c", classification: "EXCHANGE", fiat_value: "100", block_timestamp: "2025-07-03T00:00:00.000Z" }),
    ]);
    expect(series.points.map((point) => point.value)).toEqual(["1000", "600", "500"]);
    expect(series.currency).toBe("KRW");
  });

  it("들어옴/나감은 direction이 아니라 유효 분류로 정한다", () => {
    // 체인상 IN이지만 사용자가 SEND로 확정한 건이다. direction을 보면 목록·세무 파생과 갈린다.
    const series = buildFlowSeries([
      event({
        id: "a",
        direction: "IN",
        classification: "RECEIVE",
        fiat_value: "700",
        user_override: { classification: "SEND", reason: null, overridden_at: "2025-07-02T00:00:00.000Z" },
      }),
    ]);
    expect(series.points.map((point) => point.value)).toEqual(["-700"]);
  });

  it("금액을 모르는 건은 0으로 놓지 않고 선에서 빼고, 그 건수를 남긴다", () => {
    // 0으로 놓으면 "움직임이 없었다"는 거짓이 된다. 빠졌다는 사실은 화면이 말해야 한다.
    const series = buildFlowSeries([
      event({ id: "a", fiat_value: "1000" }),
      event({ id: "b", price_status: "UNKNOWN", fiat_value: null }),
      event({ id: "c", classification: "UNKNOWN" }),
      event({ id: "d", classification: "INTERNAL_TRANSFER" }),
      event({ id: "e", block_timestamp: "2025-13-40T00:00:00.000Z" }),
    ]);
    expect(series.points.map((point) => point.eventId)).toEqual(["a"]);
    expect(series.omitted).toEqual({ unconfirmed: 2, notFlow: 1, undated: 1, otherCurrency: 0 });
    expect(series.omittedTotal).toBe(4);
  });

  it("목록 순서가 뒤섞여 있어도 시간순으로 누적한다", () => {
    const series = buildFlowSeries([
      event({ id: "late", classification: "SEND", fiat_value: "300", block_timestamp: "2025-08-01T00:00:00.000Z" }),
      event({ id: "early", classification: "RECEIVE", fiat_value: "500", block_timestamp: "2025-07-01T00:00:00.000Z" }),
    ]);
    expect(series.points.map((point) => point.eventId)).toEqual(["early", "late"]);
    expect(series.points.map((point) => point.value)).toEqual(["500", "200"]);
  });

  it("통화가 섞이면 더한 수가 뜻을 잃으므로 첫 통화만 남긴다", () => {
    const series = buildFlowSeries([
      event({ id: "krw", fiat_value: "1000", fiat_currency: "KRW" }),
      event({ id: "eur", fiat_value: "1000", fiat_currency: "EUR", block_timestamp: "2025-07-02T00:00:00.000Z" }),
    ]);
    expect(series.points.map((point) => point.eventId)).toEqual(["krw"]);
    expect(series.currency).toBe("KRW");
    expect(series.omitted.otherCurrency).toBe(1);
  });

  it("그릴 거래가 하나도 없으면 통화를 지어내지 않는다", () => {
    const series = buildFlowSeries([event({ id: "a", price_status: "UNKNOWN", fiat_value: null })]);
    expect(series.points).toEqual([]);
    expect(series.currency).toBeNull();
  });
});

describe("기간을 자를 때 변화는 창 시작점에서 잰다", () => {
  const series = buildFlowSeries([
    event({ id: "a", classification: "RECEIVE", fiat_value: "1000", block_timestamp: "2025-01-10T00:00:00.000Z" }),
    event({ id: "b", classification: "SEND", fiat_value: "400", block_timestamp: "2025-02-10T00:00:00.000Z" }),
    event({ id: "c", classification: "RECEIVE", fiat_value: "200", block_timestamp: "2025-03-10T00:00:00.000Z" }),
  ]);

  it("전체 구간의 변화는 0에서 잰 누적값 자체다", () => {
    const all = windowOf(series.points, rangeOf("ALL"))!;
    expect(all.points).toHaveLength(3);
    expect(all.baseline).toBe("0");
    expect(all.change).toBe("800");
    // 0에서 몇 % 늘었는지는 말할 수 없다. 0으로 나눈 수를 지어내지 않는다.
    expect(all.changePercent).toBeNull();
  });

  it("창 앞에 이력이 있으면 그 직전 누적값을 기준으로 삼는다", () => {
    // 마지막 거래(3/10) 기준 30일 창이므로 1/10 건은 창 밖이고 기준값이 된다.
    const month = windowOf(series.points, rangeOf("1M"))!;
    expect(month.points.map((point) => point.eventId)).toEqual(["b", "c"]);
    expect(month.baseline).toBe("1000");
    expect(month.change).toBe("-200");
    expect(month.changePercent).toBe("-20");
    // 선은 창 경계에서 시작해야 잘린 구간이 허공에서 시작하지 않는다.
    expect(month.plot).toHaveLength(3);
    expect(month.plot[0].value).toBe("1000");
    expect(month.plot[0].atMs).toBe(month.fromMs);
  });

  it("기준이 음수면 비율을 말하지 않는다", () => {
    // −2만에서 −7만으로 갔을 때 "240% 감소"는 아무것도 설명하지 않는다. 금액만 말한다.
    const negative = buildFlowSeries([
      event({ id: "a", classification: "SEND", fiat_value: "20000", block_timestamp: "2025-01-10T00:00:00.000Z" }),
      event({ id: "b", classification: "SEND", fiat_value: "50000", block_timestamp: "2025-03-10T00:00:00.000Z" }),
    ]);
    const month = windowOf(negative.points, rangeOf("1M"))!;
    expect(month.baseline).toBe("-20000");
    expect(month.change).toBe("-50000");
    expect(month.changePercent).toBeNull();
  });

  it("점이 없으면 자를 것도 없다", () => {
    expect(windowOf([], rangeOf("ALL"))).toBeNull();
  });
});

describe("선 좌표", () => {
  const plot = [
    { atMs: Date.parse("2025-01-01T00:00:00.000Z"), value: "-100" },
    { atMs: Date.parse("2025-01-02T00:00:00.000Z"), value: "100" },
  ];

  it("점이 둘 미만이면 선을 그리지 않는다", () => {
    expect(flowGeometry([plot[0]], 600, 180)).toBeNull();
    expect(flowGeometry([], 600, 180)).toBeNull();
  });

  it("점마다 좌표를 하나씩 만들고 면은 바닥에서 닫는다", () => {
    const geometry = flowGeometry(plot, 600, 180)!;
    expect(geometry.line.match(/[ML]/g)).toHaveLength(2);
    expect(geometry.line.startsWith("M0 ")).toBe(true);
    expect(geometry.end.x).toBe(600);
    expect(geometry.area.endsWith("Z")).toBe(true);
    expect(geometry.area).toContain("L600 180");
  });

  it("값 범위가 0을 지날 때만 0선을 둔다", () => {
    expect(flowGeometry(plot, 600, 180)!.zeroY).not.toBeNull();
    const positiveOnly = [
      { atMs: plot[0].atMs, value: "100" },
      { atMs: plot[1].atMs, value: "300" },
    ];
    expect(flowGeometry(positiveOnly, 600, 180)!.zeroY).toBeNull();
  });
});
