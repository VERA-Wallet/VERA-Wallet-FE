import { describe, expect, it } from "vitest";

import { demoCommonWindow, demoTaxYear } from "@/lib/mock/demo-calendar";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";
import { MockEventStore } from "@/lib/mock/store";
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

  it("지갑 픽스처는 전부 공통 창 안에 있다", () => {
    for (const event of createNormalizedEventFixtures(taxYear)) {
      expect(event.block_timestamp >= window.from, event.id).toBe(true);
      expect(event.block_timestamp < window.to, event.id).toBe(true);
    }
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

  it("요약 기간에서 뽑은 과세연도가 데모 과세연도와 같다", () => {
    // `/tax`는 이 값으로 화면을 연다. 어긋나면 진입하자마자 "계산할 거래 없음"이다.
    const period = new MockEventStore().summary().period;
    expect(isGroundedPeriod(period)).toBe(true);
    for (const country of RULE_SET_ORDER) {
      expect(taxYearFor(country, period.to), country).toBe(taxYear);
    }
  });
});
