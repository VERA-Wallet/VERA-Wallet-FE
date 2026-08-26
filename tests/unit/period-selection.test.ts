import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERIOD,
  customPeriodError,
  dataBounds,
  inPeriodWindow,
  isDefaultPeriod,
  periodWindowLabel,
  resolvePeriod,
} from "@/lib/portfolio/period-selection";

const bounds = dataBounds([
  "2025-01-10T00:00:00.000Z",
  "2025-02-10T00:00:00.000Z",
  "2025-03-10T00:00:00.000Z",
]);

describe("화면이 보고 있는 기간", () => {
  it("데이터 범위는 파싱되는 시각으로만 정한다", () => {
    // 깨진 시각 하나가 기준이 되면 프리셋 전체가 없는 시점에서 뒤로 센다.
    const mixed = dataBounds(["2025-03-10T00:00:00.000Z", "언제인지 모름", "2025-01-10T00:00:00.000Z"]);
    expect(mixed).not.toBeNull();
    expect(new Date(mixed!.firstMs).toISOString()).toBe("2025-01-10T00:00:00.000Z");
    expect(new Date(mixed!.lastMs).toISOString()).toBe("2025-03-10T00:00:00.000Z");
  });

  it("놓을 수 있는 시각이 하나도 없으면 범위를 지어내지 않는다", () => {
    expect(dataBounds([])).toBeNull();
    expect(dataBounds(["없음"])).toBeNull();
  });

  it("프리셋은 벽시계가 아니라 마지막 거래에서 뒤로 센다", () => {
    // 2025-03-10에서 30일 뒤로 = 2025-02-08. 오늘이 언제든 같은 답이어야 한다.
    const month = resolvePeriod({ kind: "preset", id: "1M" }, bounds)!;
    expect(periodWindowLabel(month)).toBe("2025-02-08 ~ 2025-03-10");
  });

  it("전체 프리셋은 데이터가 실제로 걸친 범위다", () => {
    expect(periodWindowLabel(resolvePeriod(DEFAULT_PERIOD, bounds)!)).toBe("2025-01-10 ~ 2025-03-10");
    expect(isDefaultPeriod(DEFAULT_PERIOD)).toBe(true);
  });

  it("잴 기준이 없으면 프리셋도 기간이 되지 못한다", () => {
    expect(resolvePeriod({ kind: "preset", id: "1M" }, null)).toBeNull();
  });

  it("직접 지정한 끝날은 그날 전체를 포함한다", () => {
    // 자정으로 자르면 사용자가 고른 마지막 날이 통째로 빠진다.
    const period = resolvePeriod({ kind: "custom", from: "2025-01-01", to: "2025-01-31" }, bounds)!;
    expect(inPeriodWindow("2025-01-31T23:59:00.000Z", period)).toBe(true);
    expect(inPeriodWindow("2025-02-01T00:00:00.000Z", period)).toBe(false);
    expect(inPeriodWindow("2024-12-31T23:59:00.000Z", period)).toBe(false);
  });

  it("직접 지정한 기간은 데이터가 없어도 성립한다", () => {
    // 거래가 없는 기간을 고를 수 있어야 "그때 아무 일도 없었다"를 볼 수 있다.
    expect(periodWindowLabel(resolvePeriod({ kind: "custom", from: "2030-01-01", to: "2030-12-31" }, null)!)).toBe(
      "2030-01-01 ~ 2030-12-31",
    );
  });

  it("시각을 모르는 거래는 어느 기간에도 놓이지 않는다", () => {
    expect(inPeriodWindow("언제인지 모름", resolvePeriod(DEFAULT_PERIOD, bounds)!)).toBe(false);
  });

  it("기간이 될 수 없는 입력은 왜 안 되는지를 말한다", () => {
    expect(customPeriodError("", "2025-01-31")).toContain("모두 골라");
    expect(customPeriodError("2025-02-30", "2025-03-31")).toContain("시작일");
    expect(customPeriodError("2025-01-01", "2025-13-01")).toContain("종료일");
    expect(customPeriodError("2025-03-31", "2025-01-01")).toContain("앞섭니다");
    expect(customPeriodError("2025-01-01", "2025-03-31")).toBeNull();
  });

  it("성립하지 않는 직접 지정은 창이 되지 않는다", () => {
    // 조용히 통과시키면 화면은 뒤집힌 기간의 목록을 "그 기간의 전부"라고 말하게 된다.
    expect(resolvePeriod({ kind: "custom", from: "2025-03-31", to: "2025-01-01" }, bounds)).toBeNull();
  });
});
