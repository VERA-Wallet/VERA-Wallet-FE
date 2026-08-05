import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventRepository, summaryProvider } from "@/lib/composition-root.client";
import type { ReclassifyRequestDTO } from "@/lib/http/dto";

// React Query 무효화는 접두 매칭이라 list 키를 ["events","list"]로 분리해 둔다.
// 성공·409 충돌 모두 응답에 최신 이벤트가 실려 오므로 summary와 tax 판정을 함께 무효화한다.
// (갱신하지 않으면 확인 필요 탭은 비었는데 요약 카드만 옛 건수를 말하는 모순이 생긴다.)
export const eventQueryKey = ["events", "list"] as const;
export const eventSummaryQueryKey = ["events", "summary"] as const;

/** 한 번에 가져올 페이지 크기. 커서가 남으면 계속 이어 받는다. */
const PAGE_LIMIT = 100;
/** 한 번에 이어 받을 최대 페이지 수. 화면의 "더 불러오기"가 이 값을 늘린다. */
const MAX_PAGES = 50;

export function useEventList(maxPages: number = MAX_PAGES) {
  return useQuery({
    queryKey: [...eventQueryKey, maxPages] as const,
    queryFn: async () => {
      // 커서를 버리면 101번째 거래가 화면에서 통째로 사라진다.
      // 거래 탭은 "전체 거래"를 표방하므로 페이지를 끝까지 이어 받는다.
      const items: Awaited<ReturnType<typeof eventRepository.list>>["items"] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let truncated = false;
      for (let page = 0; page < maxPages; page += 1) {
        const requested = cursor;
        const result = await eventRepository.list({ limit: PAGE_LIMIT, cursor: requested ?? undefined });
        if (requested !== null) seenCursors.add(requested);
        const nextCursor = result.nextCursor ?? null;
        // 서버가 방금 쓴 커서를 그대로 되돌려주면 같은 페이지다. 쌓지 않고 멈춘다.
        if (nextCursor !== null && seenCursors.has(nextCursor)) {
          truncated = true;
          break;
        }
        items.push(...result.items);
        cursor = nextCursor;
        if (!cursor) break;
        if (page === maxPages - 1) truncated = true;
      }
      return { items, nextCursor: cursor, truncated };
    },
    // "더 불러오기"로 상한이 바뀌면 키가 달라진다. 이전 목록을 유지해 화면이 빈 상태로 튀지 않게 한다.
    placeholderData: (previous) => previous,
  });
}

export function useEventSummary() {
  return useQuery({
    queryKey: eventSummaryQueryKey,
    queryFn: () => summaryProvider.getSummary(),
  });
}

export function useEventDetail(id: string) {
  return useQuery({
    queryKey: ["events", "detail", id] as const,
    queryFn: () => eventRepository.getById(id),
  });
}

export function useReclassify() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReclassifyRequestDTO }) =>
      eventRepository.reclassify(id, input),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: eventQueryKey });
      // 재분류 이력은 detail 응답에서만 오므로 성공·충돌 모두 detail 캐시를 갱신해야 stale 이력이 남지 않는다.
      await queryClient.invalidateQueries({ queryKey: ["events", "detail", variables.id] });
      // 성공이든 충돌이든 응답에는 최신 이벤트가 실려 온다.
      // 판정·요약을 갱신하지 않으면 새 분류 옆에 옛 도장이 남거나
      // 확인 필요 탭은 비었는데 요약 카드만 옛 건수를 말하게 된다.
      await queryClient.invalidateQueries({ queryKey: ["tax", "estimate"] });
      await queryClient.invalidateQueries({ queryKey: eventSummaryQueryKey });
    },
  });
}
