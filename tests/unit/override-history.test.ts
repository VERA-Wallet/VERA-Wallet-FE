import { describe, expect, it } from "vitest";
import { MockEventStore } from "@/lib/mock/store";
import { collectAllEvents } from "@/lib/export/collect";
import type { EventListDTO } from "@/lib/http/dto";
import type { EventRepository } from "@/lib/ports/event-repository";

describe("override history exposure", () => {
  it("accumulates canonical from/to transitions across consecutive reclassifications", () => {
    const store = new MockEventStore();
    const target = store.list({ limit: 1 }).items[0];
    const first = store.reclassify(target.event.id, { classification: "SEND", reason: "확인 후 정정", expectedVersion: target.version });
    expect(first.status).toBe("ok");
    const second = store.reclassify(target.event.id, { classification: "EXCHANGE", expectedVersion: first.version! });
    expect(second.status).toBe("ok");
    const detail = store.getById(target.event.id)!;
    expect(detail.override_history).toHaveLength(2);
    expect(detail.override_history[0]).toMatchObject({ from: target.event.classification, to: "SEND", reason: "확인 후 정정" });
    expect(detail.override_history[1]).toMatchObject({ from: "SEND", to: "EXCHANGE", reason: null });
  });
});

describe("export event collection", () => {
  it("walks every cursor page so exports never silently truncate", async () => {
    const pageA: EventListDTO = { items: [1, 2].map((n) => ({ event: { id: `e${n}` } as never, version: 1 })), nextCursor: "e2" };
    const pageB: EventListDTO = { items: [3].map((n) => ({ event: { id: `e${n}` } as never, version: 1 })), nextCursor: null };
    const list = (input: { cursor?: string } = {}) => Promise.resolve(input.cursor === "e2" ? pageB : pageA);
    const repository = { list, getById: () => Promise.resolve(null), reclassify: () => Promise.reject(new Error("unused")) } as unknown as EventRepository;
    const all = await collectAllEvents(repository);
    expect(all.map(({ event }) => event.id)).toEqual(["e1", "e2", "e3"]);
  });
});
