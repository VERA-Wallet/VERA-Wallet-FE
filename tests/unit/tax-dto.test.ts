import { describe, expect, it } from "vitest";

import { taxEstimateSchema } from "@/lib/http/tax-dto";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { RULE_SET_ORDER } from "@/lib/tax/rulesets";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";

describe("DTO가 엔진 결과를 조용히 버리지 않는가", () => {
  it("엔진이 낸 필드가 스키마 통과 후에도 남아 있다", () => {
    // zod object는 모르는 키를 말없이 지운다. `unit`이 이렇게 사라져
    // 화면이 "처분 건수 ₩5"를 그렸다. 12개 룰셋 전부를 왕복시켜 손실을 잡는다.
    for (const code of RULE_SET_ORDER) {
      const engine = computeTaxEstimate({
        country: code,
        taxYear: 2025,
        events: createTaxScenarioEvents(FIXTURE_TAX_YEAR),
      });
      const parsed = taxEstimateSchema.parse(engine);
      expect(parsed, code).toEqual(engine);
    }
  });
});
