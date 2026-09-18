import { describe, expect, it } from "vitest";

import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { createTaxScenarioEvents } from "@/lib/tax/scenarios";
import { deriveTaxEvents } from "@/lib/tax/derive";
import type { TaxEvent } from "@/lib/tax/types";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { COST_METHOD_SUFFIX, DEEMED_COST_SUFFIX, LIMITATION_MESSAGE, LIMITATION_ORDER, RECEIPT_COST_SUFFIX, classifyLimitation, limitationBody, limitationOf } from "@/lib/tax/limitations";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { RULE_SET_ORDER } from "@/lib/tax/rulesets";

describe("계산의 한계 분류", () => {
  it("생산자가 내는 모든 문구가 other로 새지 않는다", () => {
    // 문구를 한 글자 고치면 조용히 "그 밖의 한계"로 강등되는 게 이 설계의 유일한 실패 모드다.
    // derive가 실제로 만들어내는 문구 전부를 통과시켜 확인한다.
    const { assumptions } = deriveTaxEvents(createNormalizedEventFixtures(FIXTURE_TAX_YEAR));
    expect(assumptions.length).toBeGreaterThan(0);
    for (const message of assumptions) {
      expect(classifyLimitation(message), message).not.toBe("other");
    }
  });

  it("상수로 고정한 문구는 각자 제 종류로 간다", () => {
    expect(classifyLimitation(LIMITATION_MESSAGE.DUPLICATE_ID)).toBe("not_reflected");
    expect(classifyLimitation(LIMITATION_MESSAGE.INTERNAL_TRANSFER)).toBe("not_reflected");
    expect(classifyLimitation(LIMITATION_MESSAGE.GAS_FEE)).toBe("not_reflected");
    expect(classifyLimitation(LIMITATION_MESSAGE.ESTIMATED_PRICE)).toBe("approximation");
    expect(classifyLimitation(LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION)).toBe("approximation");
    expect(classifyLimitation("가격 확인 필요 상태인 이벤트는 계산에서 제외했습니다.")).toBe("excluded");
    expect(classifyLimitation("dsp-btc-04: 원장에 없는 수량 1 BTC — 취득가액 0으로 계산했습니다.")).toBe("zero_basis");
    // 법정 취득가액·원가법 대신 대체값으로 계산한 줄은 "근사"다. other로 새면 화면이 한계를 숨긴다.
    expect(classifyLimitation(`시행일 전 취득분을 소비한 처분 3건 —${DEEMED_COST_SUFFIX}`)).toBe("approximation");
    expect(classifyLimitation(`판정 보류 수령분 2건 —${RECEIPT_COST_SUFFIX}`)).toBe("approximation");
    expect(classifyLimitation(`취득가액 산정 —${COST_METHOD_SUFFIX}`)).toBe("approximation");
  });

  it("모르는 문구는 숨기지 않고 other로 내보인다", () => {
    // 분류에 실패했다고 화면에서 지우면, 한계가 있는데 없는 것처럼 보인다.
    expect(classifyLimitation("듣도 보도 못한 경고")).toBe("other");
  });

  it("영향 순서 자체가 도메인 계약과 일치한다", () => {
    // 정렬 테스트가 production 배열을 그대로 기대값으로 쓰면 순서가 틀려도 함께 움직여 통과한다.
    expect(LIMITATION_ORDER).toEqual(["excluded", "zero_basis", "approximation", "not_reflected", "other"]);
  });

  it("영향 순으로 줄을 세운다", () => {
    for (const country of RULE_SET_ORDER) {
      const result = computeTaxEstimate({ country, taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
      const ranks = result.limitations.map((row) => LIMITATION_ORDER.indexOf(row.kind));
      expect([...ranks].sort((a, b) => a - b), country).toEqual(ranks);
      // 룰셋 설명(notes)은 한계가 아니다. 섞이면 "확인이 필요한 거래"가 규칙 해설로 찬다.
      for (const row of result.limitations) expect(row.kind, `${country} ${row.message}`).not.toBe("other");
    }
  });

  it("이벤트 id가 붙은 경고만 id를 갖는다", () => {
    const result = computeTaxEstimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
    for (const row of result.limitations) {
      // id를 지어내면 없는 거래로 사용자를 보낸다.
      for (const id of row.eventIds) expect(row.message.startsWith(`${id}:`), row.message).toBe(true);
    }
  });
});

describe("지갑 경로가 한계를 빠뜨리지 않는가", () => {
  it("어댑터가 파생 한계를 응답에 싣는다", async () => {
    // 엔진만 부르면 파생 단계(제외·근사·미반영)가 통째로 사라진다.
    // 테스트 하네스가 어댑터를 흉내 내다 이 병합을 빠뜨린 전례가 있다.
    const engine = new TaxEngineService(() => createNormalizedEventFixtures(FIXTURE_TAX_YEAR));
    const result = await engine.estimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, source: "wallet" });
    const kinds = new Set(result.limitations.map((row) => row.kind));

    expect(result.limitations.length).toBeGreaterThan(0);
    expect(kinds.has("other")).toBe(false);
    // 파생만 만들 수 있는 종류가 실제로 올라온다.
    expect(kinds.has("not_reflected")).toBe(true);
    // 순서가 뒤집히면 화면이 사소한 것부터 보여준다.
    const ranks = result.limitations.map((row) => LIMITATION_ORDER.indexOf(row.kind));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("제외된 이벤트는 id를 달고 올라온다", async () => {
    const engine = new TaxEngineService(() => createNormalizedEventFixtures(FIXTURE_TAX_YEAR));
    const result = await engine.estimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, source: "wallet" });
    for (const row of result.limitations.filter((item) => item.kind === "excluded")) {
      // id 없이 "빠졌습니다"만 말하면 사용자가 어느 거래인지 못 찾는다.
      expect(row.eventIds.length, row.message).toBeGreaterThan(0);
    }
    expect(result.excludedEventIds.length).toBeGreaterThan(0);
  });
});

describe("이벤트 id를 문장에서 되뜯지 않는다", () => {
  it("콜론이 들어간 id도 통째로 보존한다", () => {
    // `swp:in`은 유효한 id다. 문장을 첫 콜론에서 자르면 없는 거래 `swp`를 가리킨다.
    const events: TaxEvent[] = [
      {
        kind: "DISPOSE",
        id: "swp:in",
        at: "2025-06-01T00:00:00.000Z",
        wallet: "0xabc",
        asset: "eip155:1/native",
        symbol: "ETH",
        quantity: "5",
        proceeds: "1000",
        fee: "0",
        trigger: "FIAT",
      },
    ];
    const result = computeTaxEstimate({ country: "DE", taxYear: 2025, events });
    const zeroBasis = result.limitations.filter((row) => row.kind === "zero_basis");

    expect(zeroBasis.length).toBeGreaterThan(0);
    for (const row of zeroBasis) {
      expect(row.eventIds, row.message).toContain("swp:in");
      expect(row.eventIds, row.message).not.toContain("swp");
    }
  });
})

describe("limitationBody", () => {
  const EXCLUDED = "42161:0xfb49579b936386eaf15615b308e3bb20e66a43dd292fc11570280d61bff44f3a:log:199";

  // 카드가 id를 칩으로 따로 그리므로, 문장에 또 남으면 100자 해시가 한 카드에 두 번 나온다.
  it("strips the id prefix that the producer glued onto the message", () => {
    const row = limitationOf(`${EXCLUDED}: 확인이 필요해 계산에서 제외했습니다.`, [EXCLUDED]);
    expect(limitationBody(row)).toBe("확인이 필요해 계산에서 제외했습니다.");
  });

  it("strips a multi-id prefix", () => {
    const second = "1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:log:2";
    const row = limitationOf(`${EXCLUDED}, ${second}: 확인이 필요해 계산에서 제외했습니다.`, [EXCLUDED, second]);
    expect(limitationBody(row)).toBe("확인이 필요해 계산에서 제외했습니다.");
  });

  // derive는 사유로 묶어 문장에 id를 넣지 않는다. 그런 문장을 건드리면 뜻이 잘린다.
  it("leaves a message that does not start with its ids alone", () => {
    const row = limitationOf("가격 미확인 상태인 이벤트는 계산에서 제외했습니다.", [EXCLUDED]);
    expect(limitationBody(row)).toBe("가격 미확인 상태인 이벤트는 계산에서 제외했습니다.");
  });

  it("leaves a message with no ids alone", () => {
    const row = limitationOf("취득가액 통산 — 이동평균법으로 계산했습니다.", []);
    expect(limitationBody(row)).toBe("취득가액 통산 — 이동평균법으로 계산했습니다.");
  });
});
