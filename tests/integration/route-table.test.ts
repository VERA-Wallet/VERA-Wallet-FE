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

async function presentDid(origin: string): Promise<{ status: number; cookie: string | undefined }> {
  const response = await fetch(`${origin}/api/auth/did/present`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country: "KR" }),
  });
  return { status: response.status, cookie: response.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0] };
}

describe("hybrid proxy route table", () => {
  it("sends DID presentation to BE through the rewrite and returns its Set-Cookie", async () => {
    // FE mock은 204/vw_session을, BE는 201/vw_access_token을 준다. 이 차이가 rewrite 도달의 판별자다.
    // NestJS의 @Post 기본 성공 코드가 201이며 이 컨트롤러는 @HttpCode(200)으로 덮지 않는다.
    const proxied = await presentDid(FE);
    expect(proxied.status).toBe(201);
    expect(proxied.cookie).toBeDefined();

    const direct = await presentDid(BE);
    expect(direct.status).toBe(201);
  });

  it("routes /api/events (exact and nested) to BE", async () => {
    // 판별자: BE는 지갑 미바인딩 사용자에게 404를 준다(IndexerService.sync). FE mock에는 그 경로가 없고 401을 준다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    const list = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(list.status).toBe(404);
    const listBody = await list.json() as { error?: { message?: string } };
    expect(listBody.error?.message).toContain("bound wallet");

    const summary = await fetch(`${FE}/api/events/summary`, { headers: { cookie: cookie! } });
    expect(summary.status).toBe(404);
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
    // allowlist에 없으므로 FE Route Handler가 처리한다. FE는 완료 온보딩을 요구하고 BE는 JWT만 요구하므로
    // DID만 가진 쿠키로 호출하면 FE 계약(401 unauthorized envelope)이 그대로 드러난다.
    const { cookie } = await presentDid(FE);
    const feRulesets = await fetch(`${FE}/api/tax/rulesets`, { headers: { cookie: cookie! } });
    expect(feRulesets.status).toBe(401);
    const feBody = await feRulesets.json() as { error?: { code?: string } };
    expect(feBody.error?.code).toBe("unauthorized");

    // 같은 쿠키로 BE를 직접 부르면 200이다 — FE는 완료 온보딩을 요구하고 BE는 JWT만 요구하기 때문이며,
    // 이 상태 차이 자체가 "FE가 이 경로를 프록시하지 않았다"는 증거다.
    // 개수는 판별자가 아니다: BE `listFrontendRuleSets()`도 12개국을 돌려준다(실측 확인).
    const beRulesets = await fetch(`${BE}/api/tax/rulesets`, { headers: { cookie: cookie! } });
    expect(beRulesets.status).toBe(200);
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
    const body = await session.json() as { data: { didVerified: boolean; walletAddress: string | null; chainId: number | null } };
    expect(body.data).toMatchObject({ didVerified: true, walletAddress: null, chainId: null });

    const events = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(events.status).toBe(401);
  }, 120_000);
});
