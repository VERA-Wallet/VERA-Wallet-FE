import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { newIdempotencyKey } from "@/lib/report-vc/use-countdown";

afterEach(() => vi.unstubAllGlobals());
it("generates UUID v4 on HTTP where randomUUID is unavailable", () => {
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => webcrypto.getRandomValues(bytes) });
  const keys = Array.from({ length: 20 }, () => newIdempotencyKey());
  for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(keys).size).toBe(keys.length);
});
it("uses native UUID generation when available", () => {
  const randomUUID = vi.fn(() => "c1d7af00-4252-4f63-bb2a-426a4c1f1234");
  vi.stubGlobal("crypto", { randomUUID });
  expect(newIdempotencyKey()).toBe(randomUUID());
});
