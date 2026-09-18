import { useQuery } from "@tanstack/react-query";
import { holdingsProvider } from "@/lib/composition-root.client";

export const holdingsQueryKey = ["wallet", "holdings"] as const;

/**
 * 지갑 홈 보유 자산.
 *
 * 체인 5개 × (잔액 + 토큰 목록 + 메타데이터) + 시세라 한 번에 5초쯤 걸린다. 화면을 열 때마다 다시 끌면
 * 탭을 오갈 때마다 5초를 기다리게 되므로, 잔액이 분 단위로 바뀌는 값이 아닌 점을 이용해 1분간 신선하다고 본다.
 */
export function useHoldings(wallet: string | null) {
  return useQuery({
    queryKey: [...holdingsQueryKey, wallet] as const,
    queryFn: () => holdingsProvider.getHoldings(wallet ? { wallet } : {}),
    enabled: wallet !== null,
    staleTime: 60_000,
  });
}
