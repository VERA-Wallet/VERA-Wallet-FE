import { collectBoundedEvents, EventCollectionTruncatedError } from "@/lib/collect/bounded-event-collector";
import type { EventMutation } from "@/lib/http/dto";
import type { EventRepository } from "@/lib/ports/event-repository";

/**
 * 내보내기는 부분 파일이 되면 안 된다 — 모든 이벤트를 수집한다.
 *
 * 예전에는 상한 없이 `nextCursor`를 따라갔다. 그건 "부분 파일 금지"를 지키는 대신 무한 루프 위험을 떠안은 것이었다.
 * 이제는 상한과 커서 반복 가드를 둔 공유 수집기를 쓰고, 상한에 걸리면 조용히 자르는 대신 던진다.
 */
export async function collectAllEvents(repository: EventRepository): Promise<EventMutation[]> {
  const { items, truncated } = await collectBoundedEvents(repository, { pageLimit: 1_000 });
  if (truncated) throw new EventCollectionTruncatedError(items.length, 50);
  return items;
}
