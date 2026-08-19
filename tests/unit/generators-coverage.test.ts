import { describe, expect, it } from "vitest";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";

const ALL_CLASSIFICATIONS = new Set(["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"]);
const ALL_CHAINS = new Set([1, 8453, 42161, 10, 137]);

/**
 * 두 해치 배치가 모두 과거가 된 시점.
 * 실제 시계를 쓰면 다음 해 배치가 날마다 자라 건수를 못 박을 수 없다.
 */
const AFTER_BOTH_WINDOWS = new Date(Date.UTC(FIXTURE_TAX_YEAR + 2, 0, 1));
const fixtures = () => createNormalizedEventFixtures(FIXTURE_TAX_YEAR, AFTER_BOTH_WINDOWS);

describe("fixture coverage", () => {
  it("covers every required state deterministically", () => {
    const events = fixtures();
    expect(events).toEqual(fixtures());
    expect(events).toHaveLength(35);
    expect(new Set(events.map((event) => event.classification))).toEqual(ALL_CLASSIFICATIONS);
    expect(new Set(events.map((event) => event.chain_id))).toEqual(ALL_CHAINS);
    expect(new Set(events.map((event) => event.fiat_currency))).toEqual(new Set(["KRW"]));
    // id가 겹치면 화면이 두 번째 건을 "중복 id · 확인 필요"로 올린다 — 배치를 이어 붙일 때의 실패 모드다.
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it("기준 연도 배치 25건은 내용도 순서도 그대로다", () => {
    // 이 25건의 상태 분포에 기대는 테스트가 여럿이다. 다음 해 배치가 그걸 밀어내면 안 된다.
    const base = fixtures().slice(0, 25);
    expect(base.every((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR)))).toBe(true);
    expect(base.map((event) => event.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => `event-${String(index + 1).padStart(2, "0")}`),
    );
    expect(base.filter((event) => event.price_status === "UNKNOWN")).toHaveLength(3);
    expect(base.filter((event) => event.confidence < 0.5)).toHaveLength(3);
    expect(base.some((event) => event.classification === "UNKNOWN" && event.confidence < 0.5)).toBe(true);
    expect(base.some((event) => event.user_override !== null)).toBe(true);
  });

  it("다음 해 배치도 같은 종류의 상태를 담는다", () => {
    // 두 번째 해가 정상 거래만 담으면 연도를 바꿔 볼 때 확인 필요·제외 상태가 사라진다 —
    // 연도 필터가 "문제가 없는 해"를 보여주는 셈이 된다.
    const next = fixtures().slice(25);
    expect(next).toHaveLength(10);
    expect(next.every((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR + 1)))).toBe(true);
    expect(new Set(next.map((event) => event.classification))).toEqual(ALL_CLASSIFICATIONS);
    expect(new Set(next.map((event) => event.chain_id))).toEqual(ALL_CHAINS);
    expect(next.filter((event) => event.price_status === "UNKNOWN")).toHaveLength(1);
    expect(next.filter((event) => event.confidence < 0.5)).toHaveLength(1);
  });
});
