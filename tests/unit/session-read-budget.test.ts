import { afterEach, describe, expect, it, vi } from "vitest";
import { BeSessionReader } from "@/lib/adapters/session/be-session-reader.server";
import { beFetch, resolveAccessTokenCookie } from "@/lib/adapters/session/request-cookie.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("session cookie helpers", () => {
  it("extracts only vw_access_token from an explicit Request", async () => {
    await expect(resolveAccessTokenCookie(new Request("http://localhost", { headers: { cookie: "vw_session=session; other=1; vw_access_token=token; ignored=2" } }))).resolves.toBe("token");
    await expect(resolveAccessTokenCookie(new Request("http://localhost", { headers: { cookie: "vw_session=session; other=1" } }))).resolves.toBeUndefined();
    await expect(resolveAccessTokenCookie(new Request("http://localhost"))).resolves.toBeUndefined();
  });

  it("forwards only the supplied cookie header with no-store caching", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", fetchMock);
    await beFetch("/api/auth/session", { cookieHeader: "vw_access_token=token", init: { method: "GET" } });
    expect(fetchMock).toHaveBeenCalledWith("https://be.example/api/auth/session", expect.objectContaining({ cache: "no-store" }));
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get("cookie")).toBe("vw_access_token=token");
    await beFetch("/api/auth/session");
    expect(new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).has("cookie")).toBe(false);
  });

  it("strips a caller-supplied raw cookie so vw_session never reaches BE", async () => {
    // 이 모듈이 유일한 쿠키 창구라는 불변식. init.headers로 raw cookie를 넣어도 BE로 새면 안 된다.
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", fetchMock);
    await beFetch("/api/auth/session", { init: { headers: { cookie: "vw_session=leak; other=1" } } });
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).has("cookie")).toBe(false);
    await beFetch("/api/auth/session", { cookieHeader: "vw_access_token=token", init: { headers: { cookie: "vw_session=leak" } } });
    expect(new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get("cookie")).toBe("vw_access_token=token");
  });

  it("keeps only vw_access_token even when the caller passes a full cookie header", async () => {
    // 리더가 헤더 전문을 그대로 넘겨도 BE로는 access-token만 나가야 한다(경계에서의 심층 방어).
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", fetchMock);
    await beFetch("/api/auth/session", { cookieHeader: "vw_access_token=jwt; vw_session=mock; other=secret" });
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get("cookie")).toBe("vw_access_token=jwt");
  });
  it("uses the two-second default timeout budget", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response()));
    await beFetch("/api/auth/session");
    expect(timeout).toHaveBeenCalledWith(2000);
  });

  it("rejects beFetch without a backend origin", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    await expect(beFetch("/api/auth/session")).rejects.toThrow("VERAWALLET_BACKEND_ORIGIN");
  });
});

describe("BeSessionReader error classification", () => {
  const cookie = "vw_access_token=token";
  const complete = { data: { didVerified: true, countryCode: "KR", walletAddress: "0x123", chainId: 1 } };

  function mockFetch(value: Response | Error) {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (value instanceof Error) throw value;
      return value;
    }));
  }

  it("maps normal anonymous and completed backend responses", async () => {
    mockFetch(new Response(JSON.stringify({ data: { didVerified: false, countryCode: null, walletAddress: null, chainId: null } }), { status: 200 }));
    await expect(new BeSessionReader().read(cookie)).resolves.toEqual({ source: "anonymous" });
    mockFetch(new Response(JSON.stringify(complete), { status: 200 }));
    await expect(new BeSessionReader().read(cookie)).resolves.toEqual({ source: "be", ...complete.data });
  });

  it("closes the body of a non-200 response while preserving the http_status classification", async () => {
    // 폐기 응답의 body를 안 닫으면 연결 재사용이 깨진다. 닫기 자체가 원래 오류 분류를 덮어서도 안 된다.
    const cancel = vi.fn(async () => undefined);
    const response = new Response("failure", { status: 503 });
    Object.defineProperty(response, "body", { value: { cancel }, configurable: true });
    mockFetch(response);
    await expect(new BeSessionReader().read(cookie)).rejects.toMatchObject({ cause: "http_status", status: 503 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rethrows a missing-origin configuration error instead of calling it a network failure", async () => {
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    const { BackendOriginNotConfiguredError } = await import("@/lib/adapters/session/request-cookie.server");
    await expect(new BeSessionReader().read(cookie)).rejects.toBeInstanceOf(BackendOriginNotConfiguredError);
  });

  it.each([
    ["http status", new Response("failure", { status: 500 }), "http_status"],
    ["invalid JSON", new Response("not-json", { status: 200 }), "invalid_json"],
    ["invalid envelope", new Response(JSON.stringify({ wrong: {} }), { status: 200 }), "invalid_contract"],
    ["timeout", Object.assign(new Error("timeout"), { name: "AbortError" }), "timeout"],
    ["network", new Error("offline"), "network"],
  ] as const)("classifies %s failures", async (_name, response, cause) => {
    // 장애를 anonymous로 접으면 로그인 화면으로 위장되어 무한 리다이렉트가 된다.
    mockFetch(response);
    await expect(new BeSessionReader().read(cookie)).rejects.toMatchObject({ cause });
  });
});

describe("BE event sync warm-up", () => {
  const cookie = "vw_access_token=token";

  // 계획 ADR-4의 완화책: BE list와 summary가 둘 다 listOrSync를 타서 첫 진입에 sync가 중복되면
  // 비멱등 앵커가 재제출돼 같은 이벤트의 tx_hash가 흔들린다. 게이트가 아니라 최적화이므로 실패해도 던지지 않는다.
  it.each([
    ["ok on success", new Response(null, { status: 204 }), { status: "ok" }],
    ["failure on a non-success response", new Response(null, { status: 503 }), { status: "failed", reason: "http_status", detail: "503" }],
    ["failure on a rejected fetch", new Error("offline"), { status: "failed", reason: "error", detail: "offline" }],
  ] as const)("reports %s without throwing", async (_name, value, expected) => {
    const { warmUpBeEventSync } = await import("@/lib/adapters/http/event-repository.server");
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      if (value instanceof Error) throw value;
      return value;
    }));
    await expect(warmUpBeEventSync(cookie)).resolves.toEqual(expected);
  });

  it("skips without a cookie and never calls the backend", async () => {
    const { warmUpBeEventSync } = await import("@/lib/adapters/http/event-repository.server");
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(warmUpBeEventSync(undefined)).resolves.toEqual({ status: "skipped", reason: "no-cookie" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips entirely in OFF mode where there is no backend to warm", async () => {
    const { warmUpBeEventSync } = await import("@/lib/adapters/http/event-repository.server");
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(warmUpBeEventSync(cookie)).resolves.toEqual({ status: "skipped", reason: "off-mode" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the five-second budget, separate from the two-second session read", async () => {
    const { warmUpBeEventSync } = await import("@/lib/adapters/http/event-repository.server");
    vi.stubEnv("VERAWALLET_BACKEND_ORIGIN", "https://be.example");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })));
    await warmUpBeEventSync(cookie);
    expect(timeout).toHaveBeenCalledWith(5000);
  });
});
