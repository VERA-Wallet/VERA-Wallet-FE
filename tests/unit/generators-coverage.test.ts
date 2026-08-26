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
    // 25(기준) + 10(다음 해) + 10(시행연도 2027 처분 쇼케이스) + 3(DeFi 수익) = 48.
    expect(events).toHaveLength(48);
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
    // 다음 해 배치는 25~34번(10건)이고, 그 뒤 35~40번은 시행연도(2027) 처분 쇼케이스다.
    const next = fixtures().slice(25, 35);
    expect(next).toHaveLength(10);
    expect(next.every((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR + 1)))).toBe(true);
    expect(new Set(next.map((event) => event.classification))).toEqual(ALL_CLASSIFICATIONS);
    expect(new Set(next.map((event) => event.chain_id))).toEqual(ALL_CHAINS);
    expect(next.filter((event) => event.price_status === "UNKNOWN")).toHaveLength(1);
    expect(next.filter((event) => event.confidence < 0.5)).toHaveLength(1);
  });

  it("시행연도(2027) 처분 쇼케이스 배치는 처분만 담는다", () => {
    // 시행연도 리포트를 데모에서 보이게 하려면 그 해에 처분이 있어야 한다(취득만 있으면 부담 0).
    // 이 배치는 미래(2027) 날짜라 정상이면 미래 필터에 걸리지만, mock 쇼케이스라 의도적으로 살린다.
    // 쇼케이스는 35~44번(10건)이고, 그 뒤 45~47번은 DeFi 수익 배치다.
    const showcase = fixtures().slice(35, 45);
    expect(showcase).toHaveLength(10);
    expect(showcase.every((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR + 2)))).toBe(true);
    // SEND·EXCHANGE(처분)만 — RECEIVE(취득)·INTERNAL_TRANSFER·UNKNOWN은 없다.
    expect(new Set(showcase.map((event) => event.classification))).toEqual(new Set(["SEND", "EXCHANGE"]));
    expect(new Set(showcase.map((event) => event.id)).size).toBe(10);
  });

  it("DeFi 수익 배치는 종류별 수령분을 담는다", () => {
    // 지갑 파이프라인이 income을 표현하는지 데모에서 보이게 하는 배치다. 스테이킹·디파이 보상·대여 이자를 담는다.
    const income = fixtures().slice(45);
    expect(income).toHaveLength(3);
    // 전부 기준 연도(2025) RECEIVE·방향 IN·income_kind 설정·원화 평가액 있음.
    expect(income.every((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR)))).toBe(true);
    expect(income.every((event) => event.classification === "RECEIVE" && event.direction === "IN")).toBe(true);
    expect(income.every((event) => event.fiat_value !== null && event.price_status === "RESOLVED")).toBe(true);
    expect(new Set(income.map((event) => event.income_kind))).toEqual(new Set(["STAKING", "DEFI_REWARD", "LENDING"]));
  });
});
