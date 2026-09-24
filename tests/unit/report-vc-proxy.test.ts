import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config, proxy } from "@/proxy";

const ATTEMPT = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "http://backend:3200");
  vi.stubEnv("VERAWALLET_MOCK_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("report VC proxy", () => {
  it.each([
    "/api/report-vc/capabilities",
    "/api/report-vc/wallet",
    "/api/report-vc/wallet/link-attempts",
    "/api/report-vc/wallet/link-attempts/abc",
    "/api/report-vc/wallet/link-attempts/abc/cancel",
    "/api/report-vc/evidence/0xabc/issuance",
    "/api/report-vc/issuances",
    "/api/report-vc/issuances/i-1",
    "/api/report-vc/verifications",
    "/api/report-vc/verifications/v-1",
    "/api/report-vc/verifications/v-1/file-checks",
  ])("rewrites %s to the backend", (path) => {
    const url = `https://wallet.test${path}`;
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    const response = proxy(new NextRequest(url));
    expect(response.headers.get("x-verawallet-fe-rewrite")).toBe(path);
  });

  it("forwards the browser origin, the access token and only well-formed attempt cookies", () => {
    const response = proxy(new NextRequest("https://wallet.test/api/report-vc/verifications/v-1", {
      headers: {
        origin: "https://wallet.test",
        authorization: "Bearer injected",
        cookie: `vw_session=private; vw_access_token=jwt; vw_vc_verify_attempt=${ATTEMPT}; vw_vc_link_attempt=not-hex; vw_did_attempt=${ATTEMPT}; extra=1`,
      },
    }));
    expect(response.headers.get("x-middleware-request-origin")).toBe("https://wallet.test");
    expect(response.headers.get("x-middleware-request-cookie")).toBe(`vw_access_token=jwt; vw_vc_verify_attempt=${ATTEMPT}`);
    expect(response.headers.get("x-middleware-request-authorization")).toBeNull();
  });

  it("lets the public verification path through without a session cookie", () => {
    const response = proxy(new NextRequest("https://wallet.test/api/report-vc/verifications", { method: "POST", headers: { cookie: `vw_vc_verify_attempt=${ATTEMPT}` } }));
    expect(response.headers.get("x-middleware-request-cookie")).toBe(`vw_vc_verify_attempt=${ATTEMPT}`);
  });

  it("forwards all three attempt cookies only under /api/report-vc/", () => {
    const cookie = `vw_vc_link_attempt=${ATTEMPT}; vw_vc_issue_attempt=${"b".repeat(64)}; vw_vc_verify_attempt=${"c".repeat(64)}`;
    const vc = proxy(new NextRequest("https://wallet.test/api/report-vc/wallet", { headers: { cookie } }));
    expect(vc.headers.get("x-middleware-request-cookie")).toBe(cookie);

    const session = proxy(new NextRequest("https://wallet.test/api/auth/session", { headers: { cookie, origin: "https://wallet.test" } }));
    expect(session.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(session.headers.get("x-middleware-request-origin")).toBeNull();

    const evidence = proxy(new NextRequest("https://wallet.test/api/tax-evidence", { headers: { cookie } }));
    expect(evidence.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("does not forward the report VC attempt cookies to the login DID routes", () => {
    const response = proxy(new NextRequest("https://wallet.test/api/auth/did/present", { headers: { cookie: `vw_vc_verify_attempt=${ATTEMPT}` } }));
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("stays off when the FE runs in mock API mode", () => {
    vi.stubEnv("VERAWALLET_MOCK_MODE", "true");
    const response = proxy(new NextRequest("https://wallet.test/api/report-vc/capabilities"));
    expect(response.headers.get("x-verawallet-fe-rewrite")).toBeNull();
  });
});

it("preserves the issuance idempotency key only for issuance POST", () => {
  const key = "c1d7af00-4252-4f63-bb2a-426a4c1f1234";
  for (const [path, method, expected] of [
    ["/api/report-vc/issuances", "POST", key],
    ["/api/report-vc/issuances", "GET", null],
    ["/api/auth/session", "GET", null],
    ["/api/report-vc/verifications", "POST", null],
  ] as const) {
    const response = proxy(new NextRequest(`http://wallet.test${path}`, { method, headers: { "idempotency-key": key } }));
    expect(response.headers.get("x-middleware-request-idempotency-key")).toBe(expected);
  }
});
