import { describe, expect, it } from "vitest";
import { MockEventStore } from "@/tests/support/doubles/mock-event-store";

describe("mock event repository contract", () => {
  it("carries versions through list and get", () => {
    const store = new MockEventStore();
    const listed = store.list({ limit: 1 }).items[0];
    expect(store.getById(listed.event.id)).toEqual({ ...listed, override_history: [] });
  });

  it("increments on success and returns the current event on conflict", () => {
    const store = new MockEventStore();
    const current = store.list({ limit: 1 }).items[0];
    const updated = store.reclassify(current.event.id, { classification: "SEND", expectedVersion: current.version });
    expect(updated.status).toBe("ok");
    expect(updated.version).toBe(current.version + 1);
    const conflict = store.reclassify(current.event.id, { classification: "RECEIVE", expectedVersion: current.version });
    expect(conflict).toMatchObject({ status: "conflict", version: updated.version, event: updated.event });
  });
});
