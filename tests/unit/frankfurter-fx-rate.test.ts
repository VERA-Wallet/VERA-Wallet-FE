import { describe, expect, it, vi } from "vitest";

import { FrankfurterFxRateProvider, latestOnOrBefore, shiftDay } from "@/lib/adapters/fx/frankfurter-fx-rate.server";
import { FxRateUnavailableError } from "@/lib/ports/fx-rate";

// ECB 영업일 고시(EUR 기준). 2026-07-18·19는 주말이라 없다.
const series = {
  base: "EUR",
  rates: {
    "2026-07-16": { KRW: 1700, USD: 1.1 },
    "2026-07-17": { KRW: 1705.61, USD: 1.1405 },
    "2026-07-20": { KRW: 1710, USD: 1.15 },
  },
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fetchOf(body: unknown, status = 200) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("FrankfurterFxRateProvider", () => {
  it("EUR 교차환율로 from 1단위당 to 금액을 만든다(base=KRW 응답의 유효숫자 절단을 피한다)", async () => {
    const fetchImpl = fetchOf(series);
    const provider = new FrankfurterFxRateProvider({ fetchImpl, today: () => "2026-09-08" });
    const table = await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17"] });
    // 1.1405 / 1705.61 = 0.000668676…
    expect(Number(table.get("2026-07-17"))).toBeCloseTo(1.1405 / 1705.61, 9);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("base=EUR");
    expect(url).toContain("symbols=KRW,USD");
  });

  it("주말·연휴 거래일은 직전 영업일 환율을 쓰고, 요청 범위 앞을 더 받아 첫날이 연휴여도 찾는다", async () => {
    const fetchImpl = fetchOf(series);
    const provider = new FrankfurterFxRateProvider({ fetchImpl, today: () => "2026-09-08" });
    const table = await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-19"] });
    expect(Number(table.get("2026-07-19"))).toBeCloseTo(1.1405 / 1705.61, 9);
    // 2026-07-19 하루를 물었는데 범위 시작은 그보다 앞이다.
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/2026-07-09\.\.2026-07-19\?/);
  });

  it("범위 안에 고시일이 전혀 없으면 그 날짜는 표에서 빠진다 — 지어내지 않는다", async () => {
    const provider = new FrankfurterFxRateProvider({ fetchImpl: fetchOf({ rates: {} }), today: () => "2026-09-08" });
    const table = await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-19"] });
    expect(table.has("2026-07-19")).toBe(false);
  });

  it("과거 날짜는 영구 캐시하고, 오늘은 잠깐(10분)만 캐시한다", async () => {
    const fetchImpl = fetchOf(series);
    let clock = Date.parse("2026-07-20T09:00:00.000Z");
    const provider = new FrankfurterFxRateProvider({ fetchImpl, today: () => "2026-07-20", now: () => clock });
    await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17", "2026-07-20"] });
    await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 오늘 값도 잠깐은 캐시에서 답한다. 잔액 화면이 열릴 때마다 같은 왕복을 하지 않기 위해서다.
    await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-20"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 10분이 지나면 오늘 값은 다시 받는다(오후 고시 갱신을 따라간다). 과거 날짜는 그대로 캐시다.
    clock += 10 * 60_000 + 1;
    await provider.ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17", "2026-07-20"] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toMatch(/2026-07-20\?/);
  });

  it("같은 통화는 네트워크 없이 1이다", async () => {
    const fetchImpl = fetchOf(series);
    const provider = new FrankfurterFxRateProvider({ fetchImpl });
    const table = await provider.ratesFor({ from: "USD", to: "USD", dates: ["2026-07-17"] });
    expect(table.get("2026-07-17")).toBe("1");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("EUR가 한쪽이면 그 쪽은 1로 두고 상대만 받는다", async () => {
    const fetchImpl = fetchOf(series);
    const provider = new FrankfurterFxRateProvider({ fetchImpl, today: () => "2026-09-08" });
    const table = await provider.ratesFor({ from: "KRW", to: "EUR", dates: ["2026-07-17"] });
    expect(Number(table.get("2026-07-17"))).toBeCloseTo(1 / 1705.61, 9);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/symbols=KRW$/);
  });

  it("소스 장애(HTTP 오류·네트워크·깨진 응답)는 빈 표가 아니라 FxRateUnavailableError다", async () => {
    await expect(new FrankfurterFxRateProvider({ fetchImpl: fetchOf({}, 503) }).ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17"] }))
      .rejects.toBeInstanceOf(FxRateUnavailableError);
    await expect(new FrankfurterFxRateProvider({ fetchImpl: vi.fn<FetchLike>(async () => { throw new TypeError("fetch failed"); }) }).ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17"] }))
      .rejects.toMatchObject({ reason: "network" });
    await expect(new FrankfurterFxRateProvider({ fetchImpl: fetchOf({ nope: true }) }).ratesFor({ from: "KRW", to: "USD", dates: ["2026-07-17"] }))
      .rejects.toMatchObject({ reason: "invalid_response" });
  });
});

describe("date helpers", () => {
  it("shiftDay는 UTC 달력으로 움직인다", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("latestOnOrBefore는 같은 날 또는 직전 날을 고른다", () => {
    const days = ["2026-07-16", "2026-07-17", "2026-07-20"];
    expect(latestOnOrBefore(days, "2026-07-17")).toBe("2026-07-17");
    expect(latestOnOrBefore(days, "2026-07-19")).toBe("2026-07-17");
    expect(latestOnOrBefore(days, "2026-07-15")).toBeUndefined();
  });
});
