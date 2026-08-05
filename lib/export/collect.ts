import type { EventMutation } from "@/lib/http/dto";
import type { EventRepository } from "@/lib/ports/event-repository";

/**
 * 내보내기는 부분 파일이 되면 안 된다 — nextCursor를 전부 순회해
 * 저장소의 모든 이벤트를 수집한다(페이지네이션 이후 거래의 조용한 누락 방지).
 */
export async function collectAllEvents(repository: EventRepository): Promise<EventMutation[]> {
  const items: EventMutation[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await repository.list({ cursor, limit: 100 });
    items.push(...page.items);
    if (!page.nextCursor || page.items.length === 0) return items;
    cursor = page.nextCursor;
  }
}
