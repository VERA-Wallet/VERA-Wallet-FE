import { australia } from "@/lib/tax/rulesets/australia";
import { canada } from "@/lib/tax/rulesets/canada";
import { france } from "@/lib/tax/rulesets/france";
import { germany } from "@/lib/tax/rulesets/germany";
import { india } from "@/lib/tax/rulesets/india";
import { italy } from "@/lib/tax/rulesets/italy";
import { japan } from "@/lib/tax/rulesets/japan";
import { korea } from "@/lib/tax/rulesets/korea";
import { portugal } from "@/lib/tax/rulesets/portugal";
import { spain } from "@/lib/tax/rulesets/spain";
import { unitedKingdom } from "@/lib/tax/rulesets/united-kingdom";
import { unitedStates } from "@/lib/tax/rulesets/united-states";
import type { CountryCode, RuleSetDefinition, RuleSetSummary } from "@/lib/tax/types";
import { resolveAdjustment } from "@/lib/tax/judgment";
import { DEFAULT_PROFILE } from "@/lib/tax/engine";

/** 국가 룰셋 카탈로그. 새 국가는 이 맵에만 추가하면 엔진·API·화면이 함께 확장된다. */
export const RULE_SETS: Record<CountryCode, RuleSetDefinition> = {
  DE: germany,
  US: unitedStates,
  IN: india,
  PT: portugal,
  GB: unitedKingdom,
  AU: australia,
  FR: france,
  IT: italy,
  ES: spain,
  CA: canada,
  JP: japan,
  KR: korea,
};

/** 데모 우선순위 → 코드 순으로 정렬한 노출 순서. */
export const RULE_SET_ORDER: CountryCode[] = Object.values(RULE_SETS)
  .sort((left, right) => (left.demoPriority ?? 9) - (right.demoPriority ?? 9) || left.code.localeCompare(right.code))
  .map((ruleset) => ruleset.code);

/** 레거시 별칭: DID 클레임과 기존 `/api/rulesets`는 영국을 UK로 부른다. */
const ALIASES: Record<string, CountryCode> = { UK: "GB", GB: "GB", UKGB: "GB" };

/**
 * 별칭까지 흡수한 표준 국가 코드.
 *
 * DID는 영국을 `UK`로 부르고 룰셋 목록은 `GB`로 낸다.
 * 화면이 따로 exact match를 하면 영국 세션에서 아무 룰셋도 못 찾는다.
 * 코드를 정규화하는 곳은 여기 하나뿐이어야 한다.
 */
export function canonicalCountryCode(code: string): CountryCode | null {
  const normalized = code.trim().toUpperCase();
  const resolved = ALIASES[normalized] ?? (normalized as CountryCode);
  return RULE_SETS[resolved] ? resolved : null;
}

export function getRuleSet(code: string): RuleSetDefinition | null {
  const resolved = canonicalCountryCode(code);
  return resolved ? RULE_SETS[resolved] : null;
}

export function toRuleSetSummary(ruleset: RuleSetDefinition): RuleSetSummary {
  // taxPeriod(함수)와 compute는 직렬화 대상이 아니므로 필드를 명시적으로 옮긴다.
  return {
    code: ruleset.code,
    label: ruleset.label,
    currency: ruleset.currency,
    cost_basis: ruleset.cost_basis,
    badge_label: ruleset.badge_label,
    profileFields: ruleset.profileFields,
    // 요약은 기본 조건(현재 연도·기본 프로필) 기준으로 해석해 싣는다.
    aggregateAdjustment: resolveAdjustment(ruleset, { taxYear: new Date().getFullYear(), profile: DEFAULT_PROFILE }),
    demoPriority: ruleset.demoPriority,
    status: ruleset.status,
    topics: ruleset.topics,
    method: ruleset.ledger.method,
  };
}

export function listRuleSetSummaries(): RuleSetSummary[] {
  return RULE_SET_ORDER.map((code) => toRuleSetSummary(RULE_SETS[code]));
}
