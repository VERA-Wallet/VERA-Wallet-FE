import { afterEach, describe, expect, it, vi } from "vitest";

import { BeEventReadError, BeHttpEventRepository } from "@/lib/adapters/http/event-repository.server";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

const cookie = "vw_access_token=token";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockFetch(value: Response | Error) {
  vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (value instanceof Error) throw value;
    return value;
  }));
}

function envelope(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// 어댑터 경계에서 도메인 상태(401/404)와 인프라 장애(timeout/network/계약 위반)를 갈라야
// 상위 라우트가 사용자에게 맞는 말을 할 수 있다. 하나로 뭉개면 "계산할 거래 없음"이라는 거짓말이 된다.
describe("BeHttpEventRepository boundary", () => {
  it("returns the decoded page on success", async () => {
    mockFetch(envelope({ data: { items: [], nextCursor: null }, meta: { provenance: "mock", generatedAt: new Date().toISOString() } }, 200));
    // 목록은 항목 단위로 파싱하므로 정상 페이지도 "버린 것 0건"을 함께 말한다.
    await expect(new BeHttpEventRepository(cookie).list()).resolves.toEqual({ items: [], nextCursor: null, dropped: 0 });
  });

  it("preserves an unauthenticated rejection as a domain error", async () => {
    mockFetch(envelope({ error: { code: "unauthorized", message: "Unauthorized." } }, 401));
    const failure = await new BeHttpEventRepository(cookie).list().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(BeEventReadError);
    expect(failure).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("preserves the unbound-wallet 404 as a domain error", async () => {
    mockFetch(envelope({ error: { code: "not_found", message: "A bound wallet is required before sync." } }, 404));
    const failure = await new BeHttpEventRepository(cookie).list().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(BeEventReadError);
    expect(failure).toMatchObject({ status: 404, code: "not_found" });
  });

  it("treats an error envelope on a 2xx response as a contract violation, not a 200 error", async () => {
    mockFetch(envelope({ error: { code: "not_found", message: "impossible" } }, 200));
    const failure = await new BeHttpEventRepository(cookie).list().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(SessionInfrastructureError);
    expect(failure).toMatchObject({ cause: "invalid_contract" });
  });

  it("classifies a timeout and a network loss as infrastructure failures", async () => {
    mockFetch(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(new BeHttpEventRepository(cookie).list()).rejects.toMatchObject({ cause: "timeout" });

    mockFetch(new Error("offline"));
    await expect(new BeHttpEventRepository(cookie).list()).rejects.toMatchObject({ cause: "network" });
  });

  it("forwards cursor and limit to the backend query", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => envelope({ data: { items: [], nextCursor: null }, meta: { provenance: "mock", generatedAt: new Date().toISOString() } }, 200));
    vi.stubGlobal("fetch", fetchMock);
    await new BeHttpEventRepository(cookie).list({ cursor: "event-10", limit: 100 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://be.example/api/events?cursor=event-10&limit=100");
  });
});
