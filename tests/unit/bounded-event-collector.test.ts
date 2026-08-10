import { describe, expect, it, vi } from "vitest";

import { collectBoundedEvents, EventCollectionTruncatedError } from "@/lib/collect/bounded-event-collector";
import { collectAllEvents } from "@/lib/export/collect";
import type { EventListDTO } from "@/lib/http/dto";
import type { EventRepository } from "@/lib/ports/event-repository";

function page(ids: string[], nextCursor: string | null): EventListDTO {
  return {
    items: ids.map((id) => ({ event: { id } as EventListDTO["items"][number]["event"], version: 1 })),
    nextCursor,
  };
}

function repositoryOf(pages: EventListDTO[]): Pick<EventRepository, "list"> {
  let call = 0;
  return { list: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]!) };
}

describe("bounded event collector", () => {
  it("walks every page until the server stops handing out cursors", async () => {
    const result = await collectBoundedEvents(repositoryOf([page(["a", "b"], "c1"), page(["c"], null)]));
    expect(result.items.map((item) => item.event.id)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(false);
  });

  it("stops instead of looping forever when the server repeats a cursor", async () => {
    // 상한이 없으면 여기서 무한 루프가 된다. 이미 받은 페이지는 버리지 않고 잘렸다는 사실만 알린다.
    const result = await collectBoundedEvents(repositoryOf([page(["a"], "same"), page(["b"], "same")]));
    expect(result.truncated).toBe(true);
    expect(result.items.map((item) => item.event.id)).toEqual(["a", "b"]);
  });

  it("reports truncation when the page ceiling is reached", async () => {
    const result = await collectBoundedEvents(repositoryOf([page(["a"], "c1"), page(["b"], "c2"), page(["c"], "c3")]), { maxPages: 2 });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  it("treats an empty page as the end without claiming truncation", async () => {
    const result = await collectBoundedEvents(repositoryOf([page(["a"], "c1"), page([], "c2")]));
    expect(result.truncated).toBe(false);
    expect(result.items.map((item) => item.event.id)).toEqual(["a"]);
  });

  it("honors the requested page limit", async () => {
    const repository = repositoryOf([page(["a"], null)]);
    await collectBoundedEvents(repository, { pageLimit: 25 });
    expect(repository.list).toHaveBeenCalledWith({ cursor: undefined, limit: 25 });
  });
});

describe("export collection", () => {
  it("refuses to emit a partial file when collection is truncated", async () => {
    // 내보내기가 부분 파일이면 사용자는 거래가 빠진 줄 모른 채 그 파일을 신고에 쓴다.
    const repository = repositoryOf([page(["a"], "same"), page(["b"], "same")]) as EventRepository;
    await expect(collectAllEvents(repository)).rejects.toBeInstanceOf(EventCollectionTruncatedError);
  });

  it("returns every collected event when the walk completes", async () => {
    const repository = repositoryOf([page(["a"], "c1"), page(["b"], null)]) as EventRepository;
    await expect(collectAllEvents(repository)).resolves.toHaveLength(2);
  });
});
