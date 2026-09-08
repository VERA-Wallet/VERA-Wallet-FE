import { describe, expect, it, vi } from "vitest";

import { FixedFxRateProvider, FIXED_EUR_RATES } from "@/lib/adapters/fx/fixed-fx-rate";
import type { FxRateProvider } from "@/lib/ports/fx-rate";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { div } from "@/lib/tax/decimal";
import { FX_CONVERSION_SUFFIX, FX_RATE_SUFFIX } from "@/lib/tax/limitations";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { FIXTURE_TAX_YEAR } from "../fixtures/tax-year";

const events = createNormalizedEventFixtures(FIXTURE_TAX_YEAR);
const walletRequest = (country: string) => ({ country, taxYear: FIXTURE_TAX_YEAR, source: "wallet" as const });

describe("TaxEngineService 통화 환산", () => {
  it("룰셋 통화가 이벤트 통화와 같으면 환율 소스를 부르지 않는다", async () => {
    const fx: FxRateProvider = { ratesFor: vi.fn(async () => new Map()) };
    const withFx = await new TaxEngineService(() => events, fx).estimate(walletRequest("KR"));
    const withoutFx = await new TaxEngineService(() => events, null).estimate(walletRequest("KR"));
    expect(fx.ratesFor).not.toHaveBeenCalled();
    expect(withFx.totals).toEqual(withoutFx.totals);
    expect(withFx.limitations.some((row) => row.message.endsWith(FX_CONVERSION_SUFFIX))).toBe(false);
  });

  it("다른 통화 룰셋은 거래일 환율로 환산해 계산하고, 환산했다는 근사를 알린다", async () => {
    const fx = new FixedFxRateProvider();
    const usd = await new TaxEngineService(() => events, fx).estimate(walletRequest("US"));
    // 환산 없이(=원화 숫자에 달러 라벨) 계산한 답과 비교한다. 손익은 선형이라 환율만큼 줄어야 한다.
    const unconverted = await new TaxEngineService(() => events, null).estimate(walletRequest("US"));
    const rate = Number(div(FIXED_EUR_RATES.USD, FIXED_EUR_RATES.KRW));
    expect(usd.currency).toBe("USD");
    expect(Number(usd.totals.taxableGains)).toBeCloseTo(Number(unconverted.totals.taxableGains) * rate, 1);
    expect(usd.judgments.length).toBe(unconverted.judgments.length);
    const note = usd.limitations.find((row) => row.message.endsWith(FX_CONVERSION_SUFFIX));
    expect(note?.kind).toBe("approximation");
    expect(note?.message.startsWith("KRW → USD")).toBe(true);
  });

  it("거래일 환율이 없는 이벤트는 계산에서 빼고 그 사유를 id와 함께 남긴다", async () => {
    const fx: FxRateProvider = { ratesFor: async () => new Map() };
    const usd = await new TaxEngineService(() => events, fx).estimate(walletRequest("US"));
    const inPeriod = events.filter((event) => event.block_timestamp.startsWith(String(FIXTURE_TAX_YEAR)) && event.fiat_value !== null);
    expect(inPeriod.length).toBeGreaterThan(0);
    expect(usd.judgments).toEqual([]);
    for (const event of inPeriod) {
      expect(usd.excludedEventIds).toContain(event.id);
      const row = usd.limitations.find((limitation) => limitation.eventIds.includes(event.id));
      expect(row?.kind).toBe("excluded");
      expect(row?.message.endsWith(FX_RATE_SUFFIX)).toBe(true);
    }
    // 환율 제외는 사유를 아는 줄 하나만 남긴다 — finalizeEstimate가 사유 없이 채우는 일반 제외 줄을 같은 id에 또 만들지 않는다.
    for (const event of inPeriod) {
      expect(usd.limitations.filter((row) => row.eventIds.includes(event.id))).toHaveLength(1);
    }
  });

  it("환율 소스가 없으면(null) 환산 없이 통과한다 — 픽스처 테스트 전용 가정", async () => {
    const estimate = await new TaxEngineService(() => events, null).estimate(walletRequest("DE"));
    expect(estimate.currency).toBe("EUR");
    expect(estimate.limitations.some((row) => row.message.endsWith(FX_CONVERSION_SUFFIX))).toBe(false);
  });
});

describe("TaxEngineService provenance", () => {
  it("배열 출처는 mock, 출처 객체는 그 값을 그대로 싣는다", async () => {
    expect((await new TaxEngineService(() => events).estimate(walletRequest("KR"))).provenance).toBe("mock");
    expect((await new TaxEngineService(() => ({ events, provenance: "live" })).estimate(walletRequest("KR"))).provenance).toBe("live");
  });

  it("시나리오는 출처와 무관하게 mock이다", async () => {
    const engine = new TaxEngineService(() => ({ events, provenance: "live" }));
    expect((await engine.estimate({ country: "KR", taxYear: 2027, source: "scenario" })).provenance).toBe("mock");
  });
});
