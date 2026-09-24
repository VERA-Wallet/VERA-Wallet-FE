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
    // 워치온리 전환 후 미바인딩 원장 읽기는 404가 아니라 200 빈 목록이다(던지는 건 명시적 resync뿐).
    // 상태코드는 판별자가 아니고, x-verawallet-fe-rewrite의 유무가 "BE로 넘겼는가"를 가른다.
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    const list = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(list.status).toBe(200);
    expect(list.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
    const listBody = await list.json() as { data?: { items?: unknown[] } };
    expect(listBody.data?.items).toEqual([]);

    const summary = await fetch(`${FE}/api/events/summary`, { headers: { cookie: cookie! } });
    expect(summary.status).toBe(200);
    expect(summary.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
  });

  it("routes /api/tax-evidence to BE", async () => {
    // §1-C: matcher에 tax-evidence가 빠져 있던 결함을 고정한다. F3(계획 §0)이 확인한 대로
    // 이 케이스는 지금까지 두 레인 어디에도 없었다. BE가 그 사용자의 기록을 갖고 있는지와 무관하게
    // 상태코드가 아니라 x-verawallet-fe-rewrite 유무로 "BE로 갔는가"를 판별한다(:68의 events 원칙과 같다).
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    const taxYear = new Date().getFullYear();
    const response = await fetch(`${FE}/api/tax-evidence?country=KR&taxYear=${taxYear}`, { headers: { cookie: cookie! } });
    expect(response.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
  });

  it("keeps the tax-evidence mock control route closed while the proxy is on", async () => {
    // /api/mock/tax-evidence-failure는 proxy.ts의 allowlist·matcher 어디에도 없다(§2).
    // ON 모드에서 이 라우트는 isMockApiMode()가 false라 자체적으로 404를 내고, 그 요청은
    // 애초에 프록시를 타지 않으므로 rewrite 헤더도 없다 — test-login(:139) 케이스와 같은 모양이다.
    const response = await fetch(`${FE}/api/mock/tax-evidence-failure`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(response.headers.get("x-verawallet-fe-rewrite")).toBeNull();
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
    // /api/tax/estimate는 프록시 allowlist 밖의 FE Route Handler다. FE Route Handler는 200을,
    // BE 직접 호출은 Nest POST 기본값인 201을 준다(워치온리 전환 후 BE는 미바인딩에도 던지지 않고
    // 빈 지갑 이벤트로 계산한다). 상태코드 비대칭 + rewrite 헤더 부재가 "tax는 FE가 처리한다"는 판별자다.
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
    expect(beEstimate.status).toBe(201);
    expect(beEstimate.headers.get("x-verawallet-fe-rewrite")).toBeNull();
    const beBody = await beEstimate.json() as { data?: { totals?: Record<string, string> } };
    expect(beBody.data?.totals).toBeDefined();
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

  it("treats a stale JWT consistently after a BE restart: session says anonymous and events say 401", async () => {
    const { cookie } = await presentDid(FE);
    expect(cookie).toBeDefined();

    await stopBackend();
    await startBackend({ port: 3200 });

    // BE 00875ea부터 /api/auth/session도 JwtStrategy처럼 사용자 존재를 확인한다. 인메모리 재시작으로 사용자가
    // 사라진 옛 토큰은 세션에서 익명(didVerified:false)으로 읽히고, 보호 API는 401을 낸다. 예전에는 세션만
    // 서명 검증으로 살아 있어 "DID 인증됨 + 지갑 없음"이라는 모순이 있었다(그 계약을 이 케이스가 고정하고 있었다).
    const session = await fetch(`${FE}/api/auth/session`, { headers: { cookie: cookie! } });
    expect(session.status).toBe(200);
    const body = await session.json() as { data: { didVerified: boolean; walletAddress: string | null; chainId?: number } };
    expect(body.data).toMatchObject({ didVerified: false, walletAddress: null });
    // 세션 계약에서 chainId가 제거됐다 — 남아 있으면 BE가 옛 계약을 내려주는 것이다.
    expect(body.data.chainId).toBeUndefined();

    const events = await fetch(`${FE}/api/events`, { headers: { cookie: cookie! } });
    expect(events.status).toBe(401);
  }, 120_000);
});
