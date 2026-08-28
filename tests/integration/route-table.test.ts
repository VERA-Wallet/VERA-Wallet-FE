import { beforeAll, describe, expect, it } from "vitest";
import { startBackend, stopBackend } from "./support/server-harness";

const FE = "http://localhost:3100";

// BE mock identity는 모든 DID를 같은 user로 매핑한다. 앞선 파일이 지갑을 바인딩해 두면
// "DID만 있고 지갑은 없는" 전제가 깨지므로, 이 파일은 자기 전제를 스스로 만든다(프로세스 재기동 = 인메모리 초기화).
beforeAll(async () => {
  // 정리 실패를 삼키면 옛 BE가 살아 있는 채로 다음 파일이 green이 된다. stopBackend()는 PID 기록이 없으면 no-op이다.
  await stopBackend();
  await startBackend({ port: 3200 });
}, 180_000);
const BE = "http://localhost:3200";

async function presentDid(origin: string): Promise<{ status: number; cookie: string | undefined; upstream: string | null }> {
  const response = await fetch(`${origin}/api/auth/did/present`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country: "KR" }),
  });
  return {
    status: response.status,
    cookie: response.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0],
    upstream: response.headers.get("x-verawallet-fe-rewrite"),
  };
}

describe("hybrid proxy route table", () => {
  it("sends DID presentation to BE through the rewrite and returns its Set-Cookie", async () => {
    // FE mock과 BE 모두 201을 반환하므로 상태 코드가 아니라 Set-Cookie 이름(vw_access_token vs vw_session)으로 rewrite 도달을 판별한다.
    // x-verawallet-fe-rewrite는 `proxy.ts`가 rewrite를 걸 때만 붙는다 — FE가 자기 라우트로 처리하면 없다.
    const proxied = await presentDid(FE);
    expect(proxied.status).toBe(201);
    expect(proxied.cookie).toBeDefined();
    expect(proxied.upstream).toBeTruthy();

    // BE를 직접 때리면 FE 프록시를 거치지 않으므로 이 마커가 없는 것이 맞다.
    // 여기서 확인할 것은 같은 요청이 두 경로에서 같은 계약을 내놓는가다.
    const direct = await presentDid(BE);
    expect(direct.status).toBe(201);
    expect(direct.upstream).toBeNull();
  });

  it("delivers the mobile-ID (OmniOne CX) token in the body all the way to BE validation", async () => {
    // 이 회귀는 조용하다: BE `PresentDidDto`에 `cxToken`이 없으면 whitelist ValidationPipe가 필드를 말없이 지우고
    // 응답은 그대로 201이라, 상태 코드만 보면 토큰이 도착한 것과 구분되지 않는다.
    // 판별자로 빈 문자열을 쓴다 — 필드가 DTO에 바인딩돼 있을 때만 @MinLength(1)이 400을 만든다.
    const empty = await fetch(`${FE}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR", cxToken: "" }),
    });
    expect(empty.status).toBe(400);
    expect((await empty.json() as { error?: { message?: string } }).error?.message).toContain("cxToken");

    // 정상 토큰은 통과하고 BE 세션 쿠키가 나온다(= 프록시가 body를 온전히 넘겼고 컨트롤러가 그 값으로 신원을 검증했다).
    const presented = await fetch(`${FE}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR", cxToken: "cx-window-token" }),
    });
    expect(presented.status).toBe(201);
    expect(presented.headers.get("set-cookie")).toContain("vw_access_token");
  });

  it("routes /api/events (exact and nested) to BE", async () => {
    // FE와 BE가 같은 404를 주도록 정렬됐으므로 상태코드는 더 이상 판별자가 아니다.
    // x-verawallet-fe-rewrite의 유무가 "BE로 넘겼는가"와 "FE가 직접 처리했는가"를 가른다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    const list = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(list.status).toBe(404);
    expect(list.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
    const listBody = await list.json() as { error?: { message?: string } };
    expect(listBody.error?.message).toContain("bound wallet");

    const summary = await fetch(`${FE}/api/events/summary`, { headers: { cookie: cookie! } });
    expect(summary.status).toBe(404);
    expect(summary.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
  });

  it("keeps the dev-only test-login route closed while the proxy is on", async () => {
    // 이 라우트는 vw_session만 발급하므로 ON 모드에서 살아 있으면 무의미한 가짜 세션을 만든다.
    const response = await fetch(`${FE}/api/auth/test-login`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("proxies logout to BE so the access token is actually invalidated", async () => {
    // logout이 FE에 남아 있으면 BE `vw_access_token`이 살아 있는 채로 화면만 로그아웃된 척한다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();
    const before = await fetch(`${FE}/api/auth/session`, { headers: { cookie: cookie! } });
    expect((await before.json() as { data: { didVerified: boolean } }).data.didVerified).toBe(true);

    const logout = await fetch(`${FE}/api/auth/logout`, { method: "POST", headers: { cookie: cookie! } });
    expect(logout.status).toBe(204);
    // BE는 만료된 쿠키를 Set-Cookie로 되돌려준다. 그 헤더가 프록시를 통과해야 브라우저 세션이 실제로 끊긴다.
    expect(logout.headers.get("set-cookie")).toContain("vw_access_token=");
  });

  it("forwards only vw_access_token to BE even when other cookies are present", async () => {
    // external rewrite였다면 원 요청 쿠키가 통째로 BE로 갔다. proxy가 헤더를 다시 만들어 최소 노출을 강제한다.
    // 판별자: BE 세션은 vw_access_token만으로 복원되며, 섞여 들어온 vw_session은 어떤 영향도 주면 안 된다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();
    const mixed = `vw_session=leaked-mock-session; other=1; ${cookie}; tracking=2`;

    const session = await fetch(`${FE}/api/auth/session`, { headers: { cookie: mixed } });
    expect(session.status).toBe(200);
    expect((await session.json() as { data: { didVerified: boolean } }).data.didVerified).toBe(true);

    // vw_access_token을 뺀 나머지만 보내면 BE는 익명으로 답해야 한다. 다른 쿠키로 세션을 위조할 수 없다.
    const forged = await fetch(`${FE}/api/auth/session`, { headers: { cookie: "vw_session=leaked-mock-session; other=1" } });
    expect(forged.status).toBe(200);
    expect((await forged.json() as { data: { didVerified: boolean } }).data.didVerified).toBe(false);
  });

  it("does not let a caller-supplied Authorization header override the cookie identity", async () => {
    // BE JwtStrategy는 Authorization을 쿠키보다 먼저 읽는다. 헤더를 통째로 전달하면 남의 bearer로 신원이 바뀐다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    const forged = await fetch(`${FE}/api/auth/session`, {
      headers: { cookie: cookie!, authorization: "Bearer not-a-real-token" },
    });
    expect(forged.status).toBe(200);
    // Authorization이 상류로 갔다면 BE가 그 토큰을 먼저 읽어 검증에 실패하고 익명이 됐을 것이다.
    expect((await forged.json() as { data: { didVerified: boolean } }).data.didVerified).toBe(true);
  });

  it("keeps tax and ruleset routes on the frontend", async () => {
    // /api/tax/estimate는 프록시 allowlist 밖의 FE Route Handler다. DID-only 쿠키로 source=scenario를
    // 보내면 FE 엔진은 지갑 없이도 200으로 계산하지만, BE는 source를 무시하고 지갑 이벤트를 읽어 bound-wallet 404를 준다.
    // 이 상태 비대칭(연도는 현재 연도로 계산)은 "tax는 FE가 처리한다"는 프록시 경계의 판별자다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();
    const taxYear = new Date().getFullYear();
    const estimateBody = { country: "KR", taxYear, source: "scenario" };

    const feEstimate = await fetch(`${FE}/api/tax/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify(estimateBody),
    });
    expect(feEstimate.status).toBe(200);
    expect(feEstimate.headers.get("x-verawallet-fe-rewrite")).toBeNull();
    const feRulesets = await fetch(`${FE}/api/tax/rulesets`, { headers: { cookie: cookie! } });
    expect(feRulesets.status).toBe(200);
    expect(feRulesets.headers.get("x-verawallet-fe-rewrite")).toBeNull();

    const beEstimate = await fetch(`${BE}/api/tax/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify(estimateBody),
    });
    expect(beEstimate.status).toBe(404);
    const beBody = await beEstimate.json() as { error?: { code?: string; message?: string } };
    expect(beBody.error?.code).toBe("not_found");
    expect(beBody.error?.message).toContain("bound wallet");
  });
});

// BE를 죽였다 살리는 케이스는 다른 케이스를 오염시키므로 파일 끝에 직렬 블록으로 격리한다.
describe.sequential("backend outage and restart contracts", () => {
  it("surfaces an infrastructure error instead of an anonymous redirect while BE is down", async () => {
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    await stopBackend();
    try {
      const response = await fetch(`${FE}/dashboard`, { headers: { cookie: cookie! }, redirect: "manual" });
      // 장애를 익명으로 접으면 로그인 화면으로 위장되고 리다이렉트 루프가 된다.
      expect(response.status).toBeGreaterThanOrEqual(500);
      const location = response.headers.get("location");
      expect(location === null || (!location.includes("/login") && !location.includes("/connect-wallet"))).toBe(true);
    } finally {
      await startBackend({ port: 3200 });
    }
  }, 120_000);

  it("exposes the stale-JWT split between session and events after a BE restart", async () => {
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    await stopBackend();
    await startBackend({ port: 3200 });

    // BE의 /api/auth/session은 jwt.verifyAsync만 하고 사용자 저장소를 조회하지 않는다.
    // 반면 JwtStrategy.validate는 조회하므로 같은 토큰이 세션에선 살아 있고 이벤트에선 401이 된다.
    const session = await fetch(`${FE}/api/auth/session`, { headers: { cookie: cookie! } });
    expect(session.status).toBe(200);
    const body = await session.json() as { data: { didVerified: boolean; walletAddress: string | null; chainId?: number } };
    expect(body.data).toMatchObject({ didVerified: true, walletAddress: null });
    // 세션 계약에서 chainId가 제거됐다 — 남아 있으면 BE가 옛 계약을 내려주는 것이다.
    expect(body.data.chainId).toBeUndefined();

    const events = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(events.status).toBe(401);
  }, 120_000);
});
