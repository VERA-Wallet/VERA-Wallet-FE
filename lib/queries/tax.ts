import { useQuery } from "@tanstack/react-query";
import { taxEngine } from "@/lib/composition-root.client";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";

export const ruleSetsQueryKey = ["tax", "rulesets"] as const;
export const taxEstimateQueryKey = (input: TaxEstimateRequest, catalogSignature = "") =>
  ["tax", "estimate", input, catalogSignature] as const;

export function useRuleSets() {
  return useQuery({
    queryKey: ruleSetsQueryKey,
    queryFn: () => taxEngine.listRuleSets(),
    staleTime: Infinity,
  });
}

/**
 * @param catalogSignature 이 결과가 어느 룰셋 카탈로그에서 나왔는지의 지문.
 *   카탈로그가 바뀌면(확정 상태·항목 변경) 같은 입력이어도 결과를 다시 받아야 한다.
 *   그러지 않으면 화면 한쪽은 옛 결과의 상태를, 다른 쪽은 새 카탈로그의 항목을 말한다.
 */
export function useTaxEstimate(input: TaxEstimateRequest, enabled = true, catalogSignature = "") {
  return useQuery({
    // 입력(국가·연도·출처·프로필)이 곧 캐시 키다 — 슬라이더를 되돌리면 이전 결과가 즉시 재사용된다.
    queryKey: taxEstimateQueryKey(input, catalogSignature),
    queryFn: () => taxEngine.estimate(input),
    placeholderData: (previous) => previous,
    // 근거 없는 과세연도로는 계산하지 않는다. 결과가 화면에 안 보여도 계산 자체가 거짓의 씨앗이다.
    enabled,
  });
}
