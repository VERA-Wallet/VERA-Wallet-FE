import { describe, expect, it } from "vitest";

import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createTaxScenarioEvents } from "@/lib/mock/tax-fixtures";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { pickDeclared } from "@/components/tax/tax-simulator";
import { RULE_SET_ORDER, getRuleSet } from "@/lib/tax/rulesets";
import type { ProfileField, TaxpayerProfile } from "@/lib/tax/types";

const BASE: TaxpayerProfile = {
  marginalRatePercent: "35",
  otherIncome: "50000",
  filingStatus: "SINGLE",
  isBusiness: false,
  defiOwnershipTransferred: false,
  carriedLosses: "0",
};

// 각 필드를 실제로 흔들어 본다. 답이 바뀌면 그 룰셋은 그 입력을 쓴다.
const PROBE: Record<ProfileField, TaxpayerProfile[ProfileField]> = {
  marginalRatePercent: "10",
  otherIncome: "900000",
  filingStatus: "JOINT",
  isBusiness: true,
  defiOwnershipTransferred: true,
  carriedLosses: "5000",
};

function sensitiveFields(country: string): ProfileField[] {
  const events = createTaxScenarioEvents(FIXTURE_TAX_YEAR);
  const reference = JSON.stringify(computeTaxEstimate({ country, taxYear: 2025, events, profile: BASE }));
  return (Object.keys(PROBE) as ProfileField[]).filter((field) => {
    const profile = { ...BASE, [field]: PROBE[field] } as TaxpayerProfile;
    return JSON.stringify(computeTaxEstimate({ country, taxYear: 2025, events, profile })) !== reference;
  });
}

/**
 * 룰셋 compute가 **실제로 읽은** 프로필 필드.
 *
 * 소스를 정규식으로 훑으면 구조분해·별칭·헬퍼 전달을 놓친다.
 * Proxy로 접근을 직접 기록하면 형태와 무관하게 잡힌다.
 */
function readFields(country: string): ProfileField[] {
  const touched = new Set<ProfileField>();
  const spy = <T extends { profile: TaxpayerProfile }>(context: T): T => ({
    ...context,
    profile: new Proxy(context.profile, {
      get(target, key) {
        if (typeof key === "string" && key in target) touched.add(key as ProfileField);
        return Reflect.get(target, key);
      },
    }),
  });

  // 엔진의 `{ ...DEFAULT_PROFILE, ...input.profile }` 병합은 모든 키를 읽는다.
  // 그래서 룰셋이 실제로 읽는 지점(compute·judge)에서만 기록한다.
  const ruleset = getRuleSet(country)!;
  const original = { compute: ruleset.compute, judgeGain: ruleset.judgeGain, judgeIncome: ruleset.judgeIncome };
  ruleset.compute = (context) => original.compute.call(ruleset, spy(context));
  ruleset.judgeGain = (row, context, estimate) => original.judgeGain.call(ruleset, row, spy(context), estimate);
  if (original.judgeIncome) {
    ruleset.judgeIncome = (row, context, estimate) =>
      original.judgeIncome!.call(ruleset, row, spy(context), estimate);
  }
  try {
    computeTaxEstimate({ country, taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR), profile: BASE });
  } finally {
    Object.assign(ruleset, original);
  }
  return [...touched];
}

/**
 * 계약으로 못 박는 기대표. **프로덕션에서 계산하지 않는다.**
 * 구현과 선언이 함께 틀리면 Proxy 대조는 통과하므로 이 표가 마지막 방어선이다.
 */
const EXPECTED: Record<string, ProfileField[]> = {
  DE: ["marginalRatePercent", "carriedLosses"],
  US: ["otherIncome", "filingStatus", "carriedLosses"],
  IN: [],
  PT: ["carriedLosses"],
  AU: ["otherIncome", "isBusiness", "carriedLosses"],
  GB: ["otherIncome", "defiOwnershipTransferred", "carriedLosses"],
  CA: ["marginalRatePercent", "isBusiness", "carriedLosses"],
  ES: ["carriedLosses"],
  FR: ["marginalRatePercent"],
  IT: ["marginalRatePercent", "carriedLosses"],
  JP: ["otherIncome"],
  KR: [],
};

describe("룰셋이 선언한 프로필 입력", () => {
  it("선언이 계약 기대표와 일치한다", () => {
    // 룰셋이 입력을 하나 더 읽기 시작하면서 선언도 같이 고치면 Proxy 대조는 통과한다.
    // 그 변화를 사람이 보게 만드는 것이 이 표의 목적이다.
    for (const country of RULE_SET_ORDER) {
      expect([...(getRuleSet(country)?.profileFields ?? [])].sort(), country).toEqual([...EXPECTED[country]].sort());
    }
    expect(Object.keys(EXPECTED).sort()).toEqual([...RULE_SET_ORDER].sort());
  });

  it("선언한 필드만 요청에 실린다", () => {
    // 화면이 "이 국가에서 쓰지 않음"이라 말한 값이 요청에 남으면 계약이 fail-open이 된다.
    expect(pickDeclared(getRuleSet("DE")!.profileFields, BASE)).toEqual({
      marginalRatePercent: BASE.marginalRatePercent,
      carriedLosses: BASE.carriedLosses,
    });
    expect(pickDeclared(getRuleSet("IN")!.profileFields, BASE)).toEqual({});
    // 선언을 아직 모르면 임의로 빼지 않는다 — 빼면 답이 조용히 달라진다.
    expect(pickDeclared(undefined, BASE)).toEqual(BASE);
  });
  it("선언이 compute가 실제로 읽는 필드와 일치한다", () => {
    // 민감도만 보면 임계값 밖에서 답이 안 바뀌는 입력을 "안 쓴다"고 오판한다.
    // 일본은 otherIncome을 누진구간 판정에 넣는데 시나리오 금액이 구간을 못 넘어 그렇게 새어나갔다.
    for (const country of RULE_SET_ORDER) {
      const declared = [...(getRuleSet(country)?.profileFields ?? [])].sort();
      expect(declared, country).toEqual(readFields(country).sort());
    }
  });

  it("선언되지 않은 필드는 아예 읽히지 않는다", () => {
    // 화면은 선언을 보고 "이 국가에서 쓰지 않음"이라 단정하고 요청에서도 뺀다.
    // 룰셋이 몰래 읽으면 사용자가 볼 수도 바꿀 수도 없는 값이 답을 만든다.
    for (const country of RULE_SET_ORDER) {
      const declared = new Set(getRuleSet(country)?.profileFields ?? []);
      for (const field of readFields(country)) expect(declared.has(field), `${country} ${field}`).toBe(true);
    }
  });

  it("답을 바꾸는 입력은 반드시 선언돼 있다", () => {
    // 소스 스캔이 놓치는 간접 참조를 민감도로 한 번 더 덮는다.
    for (const country of RULE_SET_ORDER) {
      const declared = new Set(getRuleSet(country)?.profileFields ?? []);
      for (const field of sensitiveFields(country)) expect(declared.has(field), `${country} ${field}`).toBe(true);
    }
  });

  it("입력이 필요 없는 국가는 빈 목록으로 선언한다", () => {
    // 인도는 flat 분리과세라 지갑 밖 입력이 없다. 한국은 규칙 자체가 미확정이다.
    for (const country of ["IN", "KR"] as const) {
      expect(getRuleSet(country)?.profileFields, country).toEqual([]);
    }
  });

  it("모든 룰셋이 선언을 갖는다", () => {
    for (const country of RULE_SET_ORDER) {
      expect(Array.isArray(getRuleSet(country)?.profileFields), country).toBe(true);
    }
  });
});

describe("계산할 거래 없음이라고 말해도 되는가", () => {
  it("기간 내 비취득 판정이 없으면 부담도 0이다", () => {
    // 화면은 이 조건에서 "계산할 거래 없음"이라고 단정한다.
    // 판정은 비었는데 금액이 나오는 룰셋이 하나라도 있으면 그 단정은 거짓이 된다.
    // 모든 케이스가 hasWork면 단언이 0개로 통과한다 — 실제로 검사한 횟수를 센다.
    let checked = 0;
    for (const country of RULE_SET_ORDER) {
      for (const taxYear of [2023, 2025]) {
        const result = computeTaxEstimate({
          country,
          taxYear,
          events: createTaxScenarioEvents(FIXTURE_TAX_YEAR),
          profile: BASE,
        });
        const hasWork = result.judgments.some((row) => row.inPeriod && row.group !== "acquire");
        if (hasWork) continue;
        checked += 1;
        const label = `${country} ${taxYear}`;
        expect(result.totals.estimatedCharge, label).toBe("0");
        expect(result.totals.taxableGains, label).toBe("0");
        expect(result.totals.incomeTotal, label).toBe("0");
      }
    }
    expect(checked, "no-work 분기를 한 번도 검사하지 않았다").toBeGreaterThan(0);
  });
})
