import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { proxy, config } from "@/proxy";
afterEach(() => vi.unstubAllEnvs());
it.each(["offer", "present"])("proxies DID %s with original origin and only approved cookies", (path) => {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "http://backend:3200");
  vi.stubEnv("VERAWALLET_MOCK_MODE", "false");
  const url = `https://wallet.test/api/auth/did/${path}`;
  expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  const response = proxy(new NextRequest(url, { headers: { origin: "https://foreign.test", authorization: "Bearer injected", cookie: `vw_session=private; vw_access_token=jwt; vw_did_attempt=${"a".repeat(64)}; extra=private` } }));
  expect(response.headers.get("x-middleware-request-origin")).toBe("https://foreign.test");
  expect(response.headers.get("x-middleware-request-cookie")).toBe(`vw_access_token=jwt; vw_did_attempt=${"a".repeat(64)}`);
  expect(response.headers.get("x-middleware-request-authorization")).toBeNull();
});
it("does not leak attempt cookie or origin to other APIs", () => {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "http://backend:3200");
  vi.stubEnv("VERAWALLET_MOCK_MODE", "false");
  const response = proxy(new NextRequest("https://wallet.test/api/auth/session", { headers: { origin: "https://wallet.test", cookie: `vw_did_attempt=${"a".repeat(64)}` } }));
  expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  expect(response.headers.get("x-middleware-request-origin")).toBeNull();
});

it("forwards only a well-formed browser rate-limit cookie on DID requests", () => {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "http://backend:3200");
  vi.stubEnv("VERAWALLET_MOCK_MODE", "false");
  const value = `${"a".repeat(32)}.${"b".repeat(64)}`;
  const good = proxy(new NextRequest("https://wallet.test/api/auth/did/offer", { headers: { cookie: `vw_did_client=${value}` } }));
  expect(good.headers.get("x-middleware-request-cookie")).toBe(`vw_did_client=${value}`);
  const bad = proxy(new NextRequest("https://wallet.test/api/auth/did/offer", { headers: { cookie: "vw_did_client=untrusted" } }));
  expect(bad.headers.get("x-middleware-request-cookie")).toBeNull();
});
