import type { EventMutation } from "@/lib/http/dto";
import type { EventRepository } from "@/lib/ports/event-repository";

/** 수집이 상한에서 잘렸다. 부분 결과를 완전한 것처럼 쓰면 거래가 조용히 사라지므로 호출부가 반드시 알아야 한다. */
export class EventCollectionTruncatedError extends Error {
  constructor(public readonly collected: number, public readonly maxPages: number) {
    super(`Event collection truncated after ${maxPages} pages (${collected} items collected).`);
    this.name = "EventCollectionTruncatedError";
  }
}

/**
 * 커서 페이지네이션을 상한과 반복 가드를 걸고 순회한다.
 *
 * 상한이 없으면 서버가 같은 커서를 돌려주는 순간 무한 루프가 된다.
 * 반대로 조용히 멈추면 101번째 거래가 화면에서 사라진다 — 그래서 잘렸다는 사실을 `truncated`로 돌려준다.
 */
export async function collectBoundedEvents(
  repository: Pick<EventRepository, "list">,
  opts: { maxPages?: number; pageLimit?: number } = {},
): Promise<{ items: EventMutation[]; nextCursor: string | null; truncated: boolean }> {
  const maxPages = opts.maxPages ?? 50;
  const pageLimit = opts.pageLimit ?? 100;
  const items: EventMutation[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await repository.list({ cursor, limit: pageLimit });
    if (cursor !== undefined) seenCursors.add(cursor);
    items.push(...result.items);

    const next = result.nextCursor ?? undefined;
    // 서버가 방금 쓴 커서를 그대로 되돌려주면 같은 페이지다. 쌓지 않고 멈춘다.
    if (next !== undefined && seenCursors.has(next)) return { items, nextCursor: next, truncated: true };
    if (!next || result.items.length === 0) return { items, nextCursor: null, truncated: false };
    cursor = next;
  }

  return { items, nextCursor: cursor ?? null, truncated: true };
}
