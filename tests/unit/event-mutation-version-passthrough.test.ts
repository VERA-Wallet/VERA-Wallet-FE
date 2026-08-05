import { expect, it } from "vitest";
import { MockEventStore } from "@/lib/mock/store";

it("returns the mutation version without losing it", () => {
  const store = new MockEventStore();
  const before = store.list({ limit: 1 }).items[0];
  const result = store.reclassify(before.event.id, { classification: "EXCHANGE", expectedVersion: before.version });
  expect(result).toMatchObject({ status: "ok", version: 2, event: { user_override: { classification: "EXCHANGE" } } });
  expect(store.getById(before.event.id)?.version).toBe(result.version);
});
