import { useQuery } from "@tanstack/react-query";
import { holdingsProvider } from "@/lib/composition-root.client";

export const holdingsQueryKey = ["portfolio", "holdings"] as const;

/**
 * 지갑 홈의 보유 자산. ON 모드의 BE가 사용자별 30초 메모하므로 클라이언트도 같은 창을 stale로 둔다 —
 * 더 짧게 잡아도 서버가 같은 답을 돌려줄 뿐이다(mock 모드는 메모가 없어 매번 새 asOf가 온다).
 * 불러오기(resync)가 끝나면 호출부가 무효화한다. 다만 BE 메모 창 안이면 재조회가 직전 스냅샷을 돌려줄 수 있어
 * costStatus 갱신은 최대 30초 늦을 수 있다.
 */
export function useHoldings() {
  return useQuery({
    queryKey: holdingsQueryKey,
    queryFn: () => holdingsProvider.getHoldings(),
    staleTime: 30_000,
  });
}
