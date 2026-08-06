import { useMemo } from "react";

import { fresh } from "@/lib/queries/fresh";
import { useTaxEstimate } from "@/lib/queries/tax";
import type { JudgmentRow, TaxEstimate } from "@/lib/tax/types";

/**
 * 거래 목록이 세금 대신 **판정 도장**을 찍기 위한 조회.
 *
 * 부담액은 과세기간 단위로만 존재하므로 행마다 세금을 붙일 수 없다.
 * 대신 각 이벤트가 계산에서 어떻게 쓰였는지(판정)를 붙이고, 총액은 화면에 한 줄만 둔다.
 */

export type JudgmentLookup = {
  estimate: TaxEstimate | undefined;
  isLoading: boolean;
  isError: boolean;
  /** 재조회 중. 이때 옛 도장을 최신인 척 보이면 안 된다. */
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  /** eventId → 판정 행들. 교환은 처분/수취 leg으로 2행, lot 분할은 그룹이 갈리면 나뉜다. */
  rowsOf: (eventId: string) => JudgmentRow[];
  /** 계산에서 빠진 이벤트 id 집합. 확인 필요 집합의 부분집합이다. */
  excluded: Set<string>;
  /** 이 시각이 과세기간 안인가. estimate가 없으면 판단 보류(null). */
  inPeriod: (at: string) => boolean | null;
};

export function useJudgments(
  countryCode: string,
  taxYear: number,
  enabled = true,
): JudgmentLookup {
  // 내역 화면은 사실만 그린다 — "시행됐다고 가정하고 보기"는 부담 금액을 답하는 세금 탭에만 있다.
  // 두 화면이 각자 가정을 켜면 같은 지갑을 두고 어느 쪽 숫자가 사실인지 알 수 없다.
  const estimate = useTaxEstimate({ country: countryCode, taxYear, source: "wallet" }, enabled);
  const freshEstimate = fresh(estimate, !enabled);

  return useMemo(() => {
    // 조회가 실패했으면 캐시된 이전 결과를 판정 소스로 쓸 수 없다.
    // 분류가 바뀐 뒤 재조회가 실패하면 새 분류 옆에 옛 도장이 남는다.
    // 재조회 중이거나 실패했으면 이전 결과를 판정 소스로 쓸 수 없다.
    // 분류가 바뀐 뒤에도 옛 도장이 남는 원인이 정확히 이것이었다.
    const data = freshEstimate.data;
    const byEvent = new Map<string, JudgmentRow[]>();
    for (const row of data?.judgments ?? []) {
      byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row]);
    }
    const excluded = new Set(data?.excludedEventIds ?? []);


    // estimate가 없으면 기간을 판단할 수 없다. true로 단정하면 로딩·오류 중에 거짓 배지가 나온다.
    const inPeriod = (at: string): boolean | null => {
      if (!data) return null;
      const atMs = Date.parse(at);
      return atMs >= Date.parse(data.period.from) && atMs < Date.parse(data.period.to);
    };

    return {
      estimate: data,
      isLoading: estimate.isLoading,
      isError: estimate.isError,
      isFetching: estimate.isFetching,
      refetch: estimate.refetch,
      rowsOf: (eventId: string) => byEvent.get(eventId) ?? [],
      excluded,
      inPeriod,
    };
  }, [freshEstimate.data, estimate.isError, estimate.isFetching, estimate.isLoading, estimate.refetch]);
}
