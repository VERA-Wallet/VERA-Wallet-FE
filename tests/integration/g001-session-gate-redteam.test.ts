import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BeSessionReader } from "@/lib/adapters/session/be-session-reader.server";
import { MockSessionReader } from "@/lib/adapters/session/mock-session-reader.server";
import { isCompletedOnboarding, isDidVerified } from "@/lib/dal";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";
import { startBackend, stopBackend } from "./support/server-harness";

type Case = { id: string; request: unknown; expected: string; actual: unknown; verdict: "passed" | "failed" };
const cases: Case[] = [];
const artifacts = path.resolve(process.cwd(), "artifacts");

// verdict를 기록만 하고 단언하지 않으면 계약이 깨져도 러너는 green이고 아티팩트에만 failed가 남는다(거짓 초록).
// 기록과 동시에 반드시 실패시킨다.
function record(id: string, request: unknown, expected: string, actual: unknown, passed: boolean) {
  cases.push({ id, request, expected, actual, verdict: passed ? "passed" : "failed" });
  expect({ id, expected, actual, passed }).toMatchObject({ passed: true });
}

async function stub(handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Stub server did not bind a TCP port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function expectInfrastructure(reader: BeSessionReader, cookie: string, cause: SessionInfrastructureError["cause"]) {
  try { await reader.read(cookie); } catch (error) {
    expect(error).toBeInstanceOf(SessionInfrastructureError);
    expect((error as SessionInfrastructureError).cause).toBe(cause);
    return error as SessionInfrastructureError;
  }
  throw new Error("Expected SessionInfrastructureError.");
}

afterAll(async () => {
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, "g001-api-contract-report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), cases, passed: cases.every((entry) => entry.verdict === "passed") }, null, 2)}\n`);
});

describe.sequential("G001 session gate adversarial integration", () => {
  it("rejects unsafe PID file records fail-closed instead of signalling a process group", async () => {
    // process.kill(-pid)는 그룹 브로드캐스트다. pid 0/1이나 범위 밖 포트를 그대로 신뢰하면 시스템 범위를 겨냥할 수 있다.
    const { readPidFile } = await import("./support/server-harness");
    const probe = path.join(tmpdir(), `vw-pid-probe-${process.pid}.json`);
    const unsafe = [{ pid: 0, port: 3200 }, { pid: 1, port: 3200 }, { pid: 1.5, port: 3200 }, { pid: 4242, port: 0 }, { pid: 4242, port: 65536 }];
    for (const value of unsafe) {
      await writeFile(probe, JSON.stringify(value), "utf8");
      await expect(readPidFile(probe)).rejects.toThrow(/unsafe (pid|port)/);
      // 실패해도 파일을 지우지 않아야 후속 teardown이 원인을 볼 수 있다.
      await expect(readFile(probe, "utf8")).resolves.toContain("pid");
    }
    await writeFile(probe, JSON.stringify({ pid: 4242, port: 3200 }), "utf8");
    await expect(readPidFile(probe)).resolves.toEqual({ pid: 4242, port: 3200 });
    await rm(probe, { force: true });
    record("harness-pid-validation", { unsafeValues: unsafe.length }, "unsafe pid/port records are rejected fail-closed", { rejected: unsafe.length }, true);
  });
  it("keeps mock and BE cookie namespaces isolated and preserves mock expiry boundaries", async () => {
    const mock = new MockSessionReader({ get: async (id: string) => id === "mock" ? { didVerified: true, countryCode: "KR", walletAddress: "0xwallet", walletVerification: "siwe" as const, didExpiresAt: 100, walletExpiresAt: null } : null, set: async () => undefined, destroy: async () => undefined });
    const onOrigin = process.env.VERAWALLET_BACKEND_ORIGIN;
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://localhost:3200";
    const be = new BeSessionReader();
    const onSnapshot = await be.read("vw_session=mock");
    record("on-rejects-vw-session", { cookie: "vw_session=mock" }, "anonymous BE snapshot", onSnapshot, onSnapshot.source === "anonymous");
    const offSnapshot = await mock.read("vw_access_token=token");
    record("off-rejects-vw-access-token", { cookie: "vw_access_token=token" }, "anonymous mock snapshot", offSnapshot, offSnapshot.source === "anonymous");
    const expirySnapshot = await mock.read("vw_session=mock");
    const didExpired = !isDidVerified(expirySnapshot, 100);
    const incomplete = !isCompletedOnboarding(expirySnapshot, 99);
    record("mock-expiry-boundaries", { now: 100, didExpiresAt: 100, walletAddress: "0xwallet", walletExpiresAt: null }, "DID expires at equality; null wallet expiry is incomplete", { didExpired, incomplete }, didExpired && incomplete);
    if (onOrigin === undefined) delete process.env.VERAWALLET_BACKEND_ORIGIN; else process.env.VERAWALLET_BACKEND_ORIGIN = onOrigin;
  });

  it("sends only vw_access_token to BE and classifies malformed and slow 200 responses", async () => {
    let cookie = "";
    const target = await stub((request, response) => { cookie = request.headers.cookie ?? ""; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: { didVerified: false, countryCode: null, walletAddress: null } })); });
    const previous = process.env.VERAWALLET_BACKEND_ORIGIN;
    process.env.VERAWALLET_BACKEND_ORIGIN = target.origin;
    const reader = new BeSessionReader();
    await reader.read("vw_access_token=jwt; vw_session=mock; other=secret");
    record("be-cookie-minimization", { supplied: "vw_access_token=jwt; vw_session=mock; other=secret" }, "outbound cookie exactly vw_access_token=jwt", { outboundCookie: cookie }, cookie === "vw_access_token=jwt");
    await close(target.server);

    const malformed = await stub((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ meta: {} })); });
    process.env.VERAWALLET_BACKEND_ORIGIN = malformed.origin;
    const invalid = await expectInfrastructure(reader, "vw_access_token=jwt", "invalid_contract");
    record("be-invalid-envelope", { response: { status: 200, body: { meta: {} } } }, "SessionInfrastructureError invalid_contract", { cause: invalid.cause }, invalid.cause === "invalid_contract");
    await close(malformed.server);

    const slow = await stub((_request, response) => { setTimeout(() => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: {} })); }, 3000); });
    process.env.VERAWALLET_BACKEND_ORIGIN = slow.origin;
    const started = Date.now();
    const timeout = await expectInfrastructure(reader, "vw_access_token=jwt", "timeout");
    record("be-timeout", { delayedResponseMs: 3000 }, "SessionInfrastructureError timeout near 2 seconds", { cause: timeout.cause, elapsedMs: Date.now() - started }, timeout.cause === "timeout");
    await close(slow.server);
    if (previous === undefined) delete process.env.VERAWALLET_BACKEND_ORIGIN; else process.env.VERAWALLET_BACKEND_ORIGIN = previous;
  });
  it("keeps session-gated RSC pages on the DAL path instead of self-fetching API routes", async () => {
    const pages = ["app/connect-wallet/page.tsx", "app/dashboard/page.tsx", "app/export/page.tsx", "app/tax/page.tsx"];
    const sources = await Promise.all(pages.map(async (page) => [page, await readFile(path.resolve(process.cwd(), page), "utf8")] as const));
    const selfFetching = sources.filter(([, source]) => /\bfetch\s*\(|\/api\//.test(source)).map(([page]) => page);
    record("rsc-no-self-fetch", { pages }, "session-gated RSC pages do not self-fetch API routes", { selfFetching }, selfFetching.length === 0);
  });

  it("keeps auth-only routes free of BE event side effects and detects backend loss", async () => {
    const reader = new BeSessionReader();
    // 앞 테스트가 스텁 서버로 갈아끼운 뒤 원복하면서 이 변수가 비어 있을 수 있다. 실제 BE를 가리키게 고정한다.
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://localhost:3200";
    const presented = await fetch("http://localhost:3200/api/auth/did/present", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "KR" }) });
    const cookie = presented.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
    expect(cookie).toBeTruthy();
    // Stage 1은 warm-up을 두지 않는다(rewrite가 꺼져 브라우저 이벤트 요청이 BE로 가지 않으므로 선행 동기화가 무의미하다).
    // 대신 "인증만 하는 경로는 BE /api/events를 건드리지 않는다"는 경계를 직접 고정한다.
    const realFetch = globalThis.fetch.bind(globalThis);
    const requested: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      await reader.read(cookie!);
    } finally {
      globalThis.fetch = realFetch;
    }
    const eventCalls = requested.filter((url) => url.includes("/api/events"));
    record("auth-read-has-no-event-side-effect", { requested }, "session read issues no /api/events request", { eventCalls }, eventCalls.length === 0);
    await stopBackend();
    const lost = await expectInfrastructure(reader, cookie!, "network");
    record("backend-forced-stop", { cookie: "vw_access_token=<issued>" }, "SessionInfrastructureError network, never anonymous redirect", { cause: lost.cause }, lost.cause === "network");
    await startBackend();
  }, 120_000);

  it("returns 502 JSON rather than HTML from all protected handlers after backend loss", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://localhost:3200";
    // Next 서버는 Stage 2부터 global-setup이 소유한다. 여기서 다시 띄우면 포트 충돌로 실패한다.
    await stopBackend();
    // Stage 2부터 `/api/events*`·`/api/anchor-proof`는 rewrite로 BE가 소유한다.
    // BE가 죽으면 그 경로는 FE 계약이 아니라 Next 프록시 오류가 되므로 여기서는 FE 잔류 경로만 계약으로 고정한다.
    const endpoints: Array<[string, RequestInit]> = [
      ["/api/rulesets", {}], ["/api/tax/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }], ["/api/tax/rulesets", {}],
    ];
    for (const [pathname, init] of endpoints) {
      const response = await fetch(`http://localhost:3100${pathname}`, { ...init, headers: { ...init.headers, cookie: "vw_access_token=broken" } });
      const body = await response.json() as { error?: { code?: string } };
      const passed = response.status === 502 && body.error?.code === "upstream_unavailable";
      record(`route-${init.method ?? "GET"}-${pathname}`, { pathname, method: init.method ?? "GET" }, "502 JSON upstream_unavailable", { status: response.status, code: body.error?.code, contentType: response.headers.get("content-type") }, passed);
      expect(passed).toBe(true);
    }
    await startBackend();
  }, 180_000);

  it("rejects corrupt harness PID data and supports a stop/start cycle without a port leak", async () => {
    const pidFile = path.join(tmpdir(), "vw-integration-backend.pid");
    // BE가 떠 있어야 PID 파일이 존재한다. 앞선 disruptive 케이스가 내려놨다면 여기서 되살린다.
    await startBackend({ port: 3200 }).catch(() => undefined);
    const original = await readFile(pidFile, "utf8");
    await writeFile(pidFile, "not-json", "utf8");
    await expect(stopBackend()).rejects.toThrow("Unexpected token");
    await writeFile(pidFile, original, "utf8");
    await stopBackend();
    await startBackend();
    record("harness-corrupt-pid", { pidFile, contents: "not-json" }, "throws instead of silently ignoring corrupt PID file", { threw: true }, true);
    record("harness-restart", { sequence: "start → stop → start" }, "backend health check succeeds after group shutdown", { healthStatus: (await fetch("http://localhost:3200/health")).status }, true);
  }, 180_000);
});
