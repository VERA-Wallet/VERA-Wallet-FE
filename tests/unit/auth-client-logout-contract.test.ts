import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAuthClient } from "@/lib/adapters/http/auth-client.http";
import { AuthClientError } from "@/lib/ports/auth-client";

describe("HttpAuthClient logout contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(new HttpAuthClient().logout()).resolves.toBeUndefined();
  });

  it("throws a typed AuthClientError on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const failure = new HttpAuthClient().logout();
    await expect(failure).rejects.toBeInstanceOf(AuthClientError);
    await expect(new HttpAuthClient().logout()).rejects.toMatchObject({ status: 500, code: "logout_failed" });
  });
});
