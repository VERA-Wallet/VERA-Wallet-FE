import { describe, expect, it } from "vitest";

import { demoCommonWindow, demoTaxYear } from "@/lib/tax/demo-calendar";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { createTaxScenarioEvents } from "@/lib/tax/scenarios";
import { MockEventStore } from "@/tests/support/doubles/mock-event-store";
import { isGroundedPeriod } from "@/lib/period";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeTaxEstimate, taxPeriodFor, taxYearFor } from "@/lib/tax/engine";
import { RULE_SET_ORDER } from "@/lib/tax/rulesets";

/**
 * 2026년이 되자 2025년 픽스처가 어느 룰셋의 2026년 과세기간에도 걸리지 않아
 * 12개 나라가 전부 "계산할 거래 없음"을 말했고, 룰셋 비교 화면이 통째로 죽었다.
 * 그때 하나도 빨개지지 않았다 — 픽스처가 시계와 무관하다고 아무도 확인하지 않았기 때문이다.
 */
describe("데모 픽스처는 시계를 따라간다", () => {
  it("공통 창이 끝난 해만 데모 과세연도로 쓴다", () => {
    // 창(7/1~12/31)이 아직 안 끝난 해를 쓰면 픽스처가 미래 거래를 만든다.
    expect(demoTaxYear(new Date("2026-08-05T00:00:00.000Z"))).toBe(2025);
    expect(demoTaxYear(new Date("2026-12-31T23:59:59.999Z"))).toBe(2025);
    expect(demoTaxYear(new Date("2027-01-01T00:00:00.000Z"))).toBe(2026);
    expect(demoTaxYear(new Date("2027-06-30T00:00:00.000Z"))).toBe(2026);
  });

  it("모든 거래가 과거다", () => {
    const now = Date.now();
    for (const event of createNormalizedEventFixtures()) {
      expect(Date.parse(event.block_timestamp), event.id).toBeLessThan(now);
    }
    for (const event of createTaxScenarioEvents()) {
      expect(Date.parse(event.at), event.id).toBeLessThan(now);
    }
  });
});

describe("같은 연도를 고르면 12개 룰셋이 같은 거래를 본다", () => {
  const taxYear = demoTaxYear();
  const window = demoCommonWindow(taxYear);

  it("공통 창이 12개 룰셋의 과세기간 안에 통째로 들어간다", () => {
    for (const country of RULE_SET_ORDER) {
      const period = taxPeriodFor(country, taxYear);
      expect(Date.parse(window.from), country).toBeGreaterThanOrEqual(Date.parse(period.from));
      expect(Date.parse(window.to), country).toBeLessThanOrEqual(Date.parse(period.to));
    }
  });

  it("지갑 픽스처는 전부 **자기 해**의 공통 창 안에 있다", () => {
    // 픽스처는 두 해치를 담는다(기준 연도 + 다음 해). 한 해의 창만 대고 재면
    // 다음 해 배치가 통째로 창 밖으로 보이므로, 각 거래를 그 거래가 속한 해의 창과 맞춘다.
    // 창 밖으로 새면 같은 연도를 골라도 영국·호주만 다른 건수를 세게 된다 — 그게 이 불변식의 이유다.
    const events = createNormalizedEventFixtures(taxYear);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      // 어느 배치인지는 순번이 아니라 **시각**이 말해야 한다. 순번으로 가르면 경계가 바뀌어도 통과한다.
      const year = Number(event.block_timestamp.slice(0, 4));
      expect([taxYear, taxYear + 1], event.id).toContain(year);
      const own = demoCommonWindow(year);
      expect(event.block_timestamp >= own.from, event.id).toBe(true);
      expect(event.block_timestamp < own.to, event.id).toBe(true);
    }
    // 기준 연도 배치는 그대로 남아 있어야 한다 — 다음 해 배치가 그것을 밀어내면 안 된다.
    expect(events.filter((event) => event.block_timestamp.startsWith(String(taxYear)))).toHaveLength(25);
  });

  it("다음 해 배치는 아직 오지 않은 거래를 만들지 않는다", () => {
    // 공통 창이 열리기 전(1~6월)에 돌면 배치가 비는 것이 정상이다. 비어도 기준 25건은 남는다.
    const beforeWindow = createNormalizedEventFixtures(taxYear, new Date(Date.UTC(taxYear + 1, 0, 1)));
    expect(beforeWindow).toHaveLength(25);
    // 창이 다 지난 시점을 주면 배치가 통째로 들어온다.
    const afterWindow = createNormalizedEventFixtures(taxYear, new Date(Date.UTC(taxYear + 2, 0, 1)));
    expect(afterWindow.length).toBeGreaterThan(25);
    // 배치가 몇 건이든 기준 25건의 내용·순서는 흔들리지 않는다.
    expect(afterWindow.slice(0, 25)).toEqual(beforeWindow);
  });

  it("시나리오의 과세 대상 거래는 전부 공통 창 안에 있다", () => {
    // 취득은 보유기간 분기를 만들려고 일부러 창 밖(전년)에 둔다 — 원장이 원가만 물려받는다.
    for (const event of createTaxScenarioEvents(taxYear).filter((row) => row.kind !== "ACQUIRE")) {
      expect(event.at >= window.from, event.id).toBe(true);
      expect(event.at < window.to, event.id).toBe(true);
    }
  });

  it("어느 룰셋을 골라도 계산할 거래가 있다", () => {
    const wallet = deriveTaxEvents(createNormalizedEventFixtures(taxYear)).events;
    const scenario = createTaxScenarioEvents(taxYear);
    for (const country of RULE_SET_ORDER) {
      for (const [source, events] of [["wallet", wallet], ["scenario", scenario]] as const) {
        const estimate = computeTaxEstimate({ country, taxYear, events });
        // 기간 밖 취득은 원가 추적용으로 남는다. 그것만 남았다면 "이번 기간에 셀 것이 없음"이다.
        const counted = estimate.judgments.filter((row) => row.inPeriod && row.group !== "acquire");
        expect(counted.length, `${country}/${source}`).toBeGreaterThan(0);
      }
    }
  });

  it("요약 기간에서 뽑은 과세연도에는 계산할 거래가 있다", () => {
    // `/tax`는 이 값으로 화면을 연다. 어긋나면 진입하자마자 "계산할 거래 없음"이다.
    // 픽스처가 두 해치가 된 뒤로 그 해는 데모 과세연도가 아니라 **마지막 거래가 있는 해**다.
    // 그래서 연도를 못 박는 대신, 그 해에 실제로 셀 것이 있는지를 직접 확인한다 —
    // 화면이 비지 않는다는 원래 주장을 그대로, 더 가깝게 재는 방식이다.
    const period = new MockEventStore().summary().period;
    expect(isGroundedPeriod(period)).toBe(true);
    const events = deriveTaxEvents(createNormalizedEventFixtures()).events;
    for (const country of RULE_SET_ORDER) {
      const openedYear = taxYearFor(country, period.to);
      const estimate = computeTaxEstimate({ country, taxYear: openedYear, events });
      // 기간 밖 취득은 원가 추적용으로 남는다. 그것만 남았다면 "이번 기간에 셀 것이 없음"이다.
      const counted = estimate.judgments.filter((row) => row.inPeriod && row.group !== "acquire");
      expect(counted.length, `${country}/${openedYear}`).toBeGreaterThan(0);
    }
  });
});
