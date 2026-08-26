import { describe, expect, it } from "vitest";

import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";

const engine = new TaxEngineService(() => createNormalizedEventFixtures(FIXTURE_TAX_YEAR));

describe("데모 시나리오 출처", () => {
  it("요청한 과세연도로 이벤트를 만든다", async () => {
    // 연도를 안 넘기면 어느 해를 골라도 데모 시계의 해만 계산돼 나머지는 "계산할 거래 없음"이 된다.
    const result = await engine.estimate({ country: "DE", taxYear: 2027, source: "scenario" });

    expect(result.period.from).toBe("2027-01-01T00:00:00.000Z");
    expect(result.judgments.some((row) => row.inPeriod && row.group !== "acquire")).toBe(true);
  });

  it("보조단위가 없는 통화만 자릿수를 옮긴다", () => {
    expect(scenarioScaleFor("KR")).toBe("1000");
    expect(scenarioScaleFor("JP")).toBe("1000");
    expect(scenarioScaleFor("DE")).toBe("1");
    expect(scenarioScaleFor("GB")).toBe("1");
    // 배율은 금액만 건드린다 — 수량·시각·건수가 바뀌면 다른 시나리오가 된다.
    const base = createTaxScenarioEvents(2027);
    const scaled = createTaxScenarioEvents(2027, "1000");
    expect(scaled.map((event) => [event.id, event.at, event.quantity])).toEqual(
      base.map((event) => [event.id, event.at, event.quantity]),
    );
    const cost = (events: typeof base, id: string) => {
      const event = events.find((item) => item.id === id);
      return event?.kind === "ACQUIRE" ? event.cost : null;
    };
    expect(cost(base, "acq-btc-01")).toBe("20000");
    expect(cost(scaled, "acq-btc-01")).toBe("20000000");
  });

  it("유로 룰셋의 답은 배율에 흔들리지 않는다", async () => {
    const adapter = await engine.estimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, source: "scenario" });
    const direct = computeTaxEstimate({
      country: "DE",
      taxYear: FIXTURE_TAX_YEAR,
      events: createTaxScenarioEvents(FIXTURE_TAX_YEAR),
    });

    expect(adapter.totals.estimatedCharge).toBe(direct.totals.estimatedCharge);
    expect(adapter.totals.estimatedCharge).toBe("1015.44");
  });

  it("한국 2027 시나리오가 실제 부담을 산출한다", async () => {
    const result = await engine.estimate({ country: "KR", taxYear: 2027, source: "scenario" });

    expect(result.status).toBe("PARTIAL");
    // 거주자별 총평균법: 양도·교환 손익 9,229,625.62 − 기본공제 2,500,000 = 과세표준 6,729,625.62
    expect(result.lines.find((line) => line.key === "net_gains")?.amount).toBe("9229625.62");
    expect(result.totals.taxableBase).toBe("6729625.62");
    // 소득세 1,345,925.12 + 개인지방소득세 134,592.51
    expect(result.totals.estimatedCharge).toBe("1480517.64");
    expect(result.totals.effectiveRatePercent).toBe("22");
    // 스테이킹·에어드랍 수령분은 조문이 없어 총수입금액에서 빠진다.
    expect(result.lines.find((line) => line.key === "pending_income")?.amount).toBe("2750000");
    expect(result.totals.incomeTotal).toBe("0");
  });

  it("같은 시나리오라도 시행 전 연도는 부담을 산출하지 않는다", async () => {
    const before = await engine.estimate({ country: "KR", taxYear: 2026, source: "scenario" });

    expect(before.status).toBe("SCHEDULED");
    expect(before.totals.estimatedCharge).toBe("0");
    // 원장 집계는 같은 규모로 보인다 — 시행 여부만 다르다.
    expect(before.lines.find((line) => line.key === "ledger_gains")?.amount).toBe("9229625.62");
  });

  it("지갑 이력에도 시행 가정을 적용해 실제 부담을 보여준다", async () => {
    const fact = await engine.estimate({ country: "KR", taxYear: FIXTURE_TAX_YEAR, source: "wallet" });
    const assumed = await engine.estimate({
      country: "KR",
      taxYear: FIXTURE_TAX_YEAR,
      source: "wallet",
      assumeEffective: true,
    });

    // 사실: 2025년 발생분에는 부담이 없다.
    expect(fact.status).toBe("SCHEDULED");
    expect(fact.totals.estimatedCharge).toBe("0");
    // 가정: 같은 지갑 이력에 시행 후 규칙을 적용한다. 원장 손익은 그대로고 공제·세율만 붙는다.
    expect(assumed.lines.find((line) => line.key === "net_gains")?.amount).toBe(
      fact.lines.find((line) => line.key === "ledger_gains")?.amount,
    );
    // 방향·분류 모순 4건(2025년 event-06·07·16·17)이 엔진 진입 전 게이트에서 빠져 양도 손익이 줄었다.
    // 여기에 대여 이자(event-48 LENDING · 19,200,000)가 과세 income으로 더해진다
    // (스테이킹·디파이 보상은 판정 보류라 총수입금액에서 빠진다).
    // 양도분 30,700,000 + 대여 이자 19,200,000 = 과세표준 49,900,000 × 22%(KR) = 10,978,000.
    expect(assumed.totals.taxableBase).toBe("49900000");
    expect(assumed.totals.estimatedCharge).toBe("10978000");
    expect(assumed.totals.incomeTotal).toBe("19200000");
    expect(assumed.notes[0]).toContain("실제 부담은 0원입니다");
  });
});
