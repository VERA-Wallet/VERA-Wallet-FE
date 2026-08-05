import { getRuleSet } from "@/lib/tax/rulesets";

/** DID 클레임이 발급하는 거주국 코드(레거시 계약). 영국은 UK 별칭을 유지한다. */
export const DID_COUNTRIES = ["KR", "US", "UK", "DE"] as const;

export type RuleSet = { country: (typeof DID_COUNTRIES)[number]; cost_basis: string; badge_label: string };

function toLegacy(country: RuleSet["country"]): RuleSet {
  const ruleset = getRuleSet(country)!;
  // 룰셋 카탈로그를 단일 출처로 삼되, 국가 코드는 요청한 별칭(UK)을 그대로 되돌려준다.
  return { country, cost_basis: ruleset.cost_basis, badge_label: ruleset.badge_label };
}

export const RULESETS: Record<RuleSet["country"], RuleSet> = {
  KR: toLegacy("KR"),
  US: toLegacy("US"),
  UK: toLegacy("UK"),
  DE: toLegacy("DE"),
};

export function getMockRuleset(country: string): RuleSet | null {
  const normalized = country.trim().toUpperCase() as RuleSet["country"];
  return RULESETS[normalized] ?? null;
}
