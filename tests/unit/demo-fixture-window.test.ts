import { describe, expect, it } from "vitest";

import { demoCommonWindow, demoTaxYear } from "@/lib/tax/demo-calendar";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
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

  it("base·next 거래는 과거이고, 시행연도 쇼케이스만 의도적 미래다", () => {
    const now = Date.now();
    // 시행연도(2027) 처분 쇼케이스는 시행연도 리포트를 데모에서 보이게 하는 mock 샘플이라
    // 의도적으로 미래 날짜다 — 미래 필터에서 제외되어 항상 존재한다. 나머지 배치는 과거여야 한다.
    const showcaseYear = demoTaxYear() + 2;
    const events = createNormalizedEventFixtures();
    const past = events.filter((event) => Number(event.block_timestamp.slice(0, 4)) !== showcaseYear);
    const showcase = events.filter((event) => Number(event.block_timestamp.slice(0, 4)) === showcaseYear);
    expect(past.length).toBeGreaterThan(0);
    for (const event of past) {
      expect(Date.parse(event.block_timestamp), event.id).toBeLessThan(now);
    }
    // 쇼케이스는 항상 10건 존재하고, 명시적으로 미래(now 이후)임을 확인한다.
    expect(showcase).toHaveLength(10);
    for (const event of showcase) {
      expect(Date.parse(event.block_timestamp), event.id).toBeGreaterThan(now);
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
      // 세 배치: 기준(taxYear) · 다음 해(taxYear+1) · 시행연도 쇼케이스(taxYear+2).
      expect([taxYear, taxYear + 1, taxYear + 2], event.id).toContain(year);
      const own = demoCommonWindow(year);
      expect(event.block_timestamp >= own.from, event.id).toBe(true);
      expect(event.block_timestamp < own.to, event.id).toBe(true);
    }
    // 기준 연도 배치는 그대로 남아 있어야 한다 — 다음 해 배치가 그것을 밀어내면 안 된다.
    // 기준 연도에는 base 25건 + DeFi 수익 3건이 들어간다.
    expect(events.filter((event) => event.block_timestamp.startsWith(String(taxYear)))).toHaveLength(28);
  });

  it("다음 해 배치는 아직 오지 않은 거래를 만들지 않는다", () => {
    // 공통 창이 열리기 전(1~6월)에 돌면 다음 해 배치가 통째로 비는 것이 정상이다.
    // 기준 25건과 시행연도(2027) 쇼케이스는 미래 필터와 무관하게 남는다.
    const beforeWindow = createNormalizedEventFixtures(taxYear, new Date(Date.UTC(taxYear + 1, 0, 1)));
    // 다음 해(taxYear+1) 배치는 통째로 비어야 한다.
    expect(beforeWindow.filter((event) => event.block_timestamp.startsWith(String(taxYear + 1)))).toHaveLength(0);
    // 기준 연도 = base 25건 + DeFi 수익 3건. DeFi 수익은 과거(기준 연도)라 미래 필터와 무관하게 남는다.
    expect(beforeWindow.filter((event) => event.block_timestamp.startsWith(String(taxYear)))).toHaveLength(28);

    // 창이 다 지난 시점을 주면 다음 해 배치가 통째로 들어온다.
    const afterWindow = createNormalizedEventFixtures(taxYear, new Date(Date.UTC(taxYear + 2, 0, 1)));
    expect(afterWindow.filter((event) => event.block_timestamp.startsWith(String(taxYear + 1)))).toHaveLength(10);
    // 미래 필터가 무엇을 자르든 기준 25건의 내용·순서는 흔들리지 않는다.
    expect(afterWindow.slice(0, 25)).toEqual(beforeWindow.slice(0, 25));

    // 시행연도(2027) 쇼케이스는 미래 필터에서 의도적으로 제외돼 두 경우 모두 10건 그대로다.
    const showcaseYear = String(taxYear + 2);
    expect(beforeWindow.filter((event) => event.block_timestamp.startsWith(showcaseYear))).toHaveLength(10);
    expect(afterWindow.filter((event) => event.block_timestamp.startsWith(showcaseYear))).toHaveLength(10);
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

describe("시행연도(2027) 처분 쇼케이스는 총평균법 실제 부담을 낸다", () => {
  // 시계와 무관하게 결정적이도록 락인된 연도(2025)를 쓴다. 쇼케이스 연도는 2027 = KR 시행연도다.
  // now를 충분히 미래로 줘 base·next가 모두 과거로 들어오게 한다.
  const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, new Date(Date.UTC(FIXTURE_TAX_YEAR + 3, 0, 1)));
  // 쇼케이스는 35~44번(10건). 그 뒤 45~47번은 기준 연도 DeFi 수익 배치라 슬라이스에서 뺀다.
  const showcase = events.slice(35, 45);

  it("처분(SEND·EXCHANGE)만 담고 2027 공통 창 안에 있다", () => {
    expect(showcase).toHaveLength(10);
    const window = demoCommonWindow(FIXTURE_TAX_YEAR + 2);
    for (const event of showcase) {
      expect(["SEND", "EXCHANGE"], event.id).toContain(event.classification);
      expect(event.block_timestamp >= window.from, event.id).toBe(true);
      expect(event.block_timestamp < window.to, event.id).toBe(true);
    }
  });

  it("이전 배치(2025·2026)에서 취득한 자산 키를 처분한다", () => {
    // 처분 자산 키가 base·next의 취득(RECEIVE) 자산 키에 들어야 총평균 원가가 잡힌다(취득가 0이 아님).
    const derived = deriveTaxEvents(events);
    const acquiredKeys = new Set(derived.events.filter((event) => event.kind === "ACQUIRE").map((event) => event.asset));
    const disposedKeys = deriveTaxEvents(showcase).events.filter((event) => event.kind === "DISPOSE").map((event) => event.asset);
    expect(disposedKeys).toHaveLength(10);
    for (const key of disposedKeys) {
      expect(acquiredKeys.has(key), key).toBe(true);
    }
  });

  it("2027을 고르면 거주자별 총평균법으로 실제 부담(>0)을 낸다", () => {
    const derived = deriveTaxEvents(events);
    const estimate = computeTaxEstimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR + 2, events: derived.events });
    expect(estimate.method).toContain("총평균");
    expect(Number(estimate.totals.taxableGains)).toBeGreaterThan(0);
    expect(Number(estimate.totals.estimatedCharge)).toBeGreaterThan(0);
  });

  it("시행 가정을 켜면 시행 전(2025) 데이터도 총평균법 실제 값을 낸다", () => {
    const derived = deriveTaxEvents(events);
    const assumed = computeTaxEstimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, events: derived.events, assumeEffective: true });
    // 가정임을 계산 결과가 스스로 말한다(method·notes). 화면 배지만 믿지 않는다.
    expect(assumed.method).toContain("시행 가정");
    expect(Number(assumed.totals.estimatedCharge)).toBeGreaterThan(0);
    // 가정을 끄면(시행 전) 부담은 0이다 — 둘이 다른 답임을 함께 못 박는다.
    const factual = computeTaxEstimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, events: derived.events });
    expect(factual.totals.estimatedCharge).toBe("0");
  });
});
