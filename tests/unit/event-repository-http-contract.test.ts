import { describe, expect, it, vi } from "vitest";
import { HttpEventRepository } from "@/lib/adapters/http/event-repository.http";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";

const event = createNormalizedEventFixtures()[0];
const meta = { provenance: "mock", generatedAt: "2025-01-01T00:00:00.000Z" };

describe("HTTP event repository", () => {
  it("maps list envelopes and preserves versions plus fetch arguments", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { items: [{ event, version: 7 }], nextCursor: null }, meta }));
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.list({ limit: 5 })).resolves.toEqual({ items: [{ event, version: 7 }], nextCursor: null });
    expect(fetcher).toHaveBeenCalledWith("/api/events?limit=5");
  });

  it("maps successful get envelopes", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { event, version: 3, override_history: [] }, meta }));
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.getById(event.id)).resolves.toEqual({ event, version: 3, override_history: [] });
  });

  it("maps not-found errors to null on get", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 }));
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.getById("nope")).resolves.toBeNull();
  });

  it("maps successful reclassify envelopes to ok results", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { event, version: 4 }, meta }));
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.reclassify(event.id, { classification: "SEND", expectedVersion: 3 })).resolves.toEqual({
      status: "ok",
      event,
      version: 4,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/events/${event.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("maps conflict envelopes to conflict results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { code: "version_conflict", message: "stale" }, data: { event, version: 4 } }, { status: 409 }),
      );
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.reclassify(event.id, { classification: "SEND", expectedVersion: 3 })).resolves.toEqual({
      status: "conflict",
      event,
      version: 4,
    });
  });

  it("rejects malformed envelopes instead of trusting them", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { event: { id: "broken" }, version: 1 }, meta }));
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.getById(event.id)).rejects.toThrow("invalid response");
  });
});

describe("HTTP event detail decoding", () => {
  it("rejects malformed override timestamps at the boundary", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: { event, version: 1, override_history: [{ from: "RECEIVE", to: "SEND", reason: null, overridden_at: "not-a-timestamp" }] },
        meta,
      }),
    );
    const repository = new HttpEventRepository(fetcher);
    await expect(repository.getById(event.id)).rejects.toThrow("invalid response");
  });
});
