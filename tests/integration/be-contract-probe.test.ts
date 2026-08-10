import { beforeAll, describe, expect, it } from "vitest";
import { startBackend, stopBackend } from "./support/server-harness";

const origin = "http://localhost:3200";

// 이 파일은 "지갑이 아직 바인딩되지 않은 사용자" 전제를 쓴다.
// BE mock identity가 모든 DID를 같은 user로 매핑하므로 앞선 파일이 바인딩해 두면 전제가 깨진다 — 프로세스를 재기동해 초기화한다.
beforeAll(async () => {
  // 정리 실패를 삼키면 옛 BE가 살아 있는 채로 다음 파일이 green이 된다. stopBackend()는 PID 기록이 없으면 no-op이다.
  await stopBackend();
  await startBackend({ port: 3200 });
}, 180_000);

type SessionEnvelope = { data: { didVerified: boolean; countryCode: string | null; walletAddress: string | null; chainId: number | null } };

describe("BE authentication contract", () => {
  it("runs in the mock mode required by the integration harness", async () => {
    // FE mock은 /health와 mockMode를 제공하지 않으므로, 엉뚱한 모드의 BE에 붙지 않도록 고정한다.
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).mockMode).toBe(true);
  });

  it("rejects nonce issuance without a DID session", async () => {
    // FE mock은 nonce 접근 제어를 대신 검증하지 않으므로, 실제 BE의 선행 DID 요구를 고정한다.
    const response = await fetch(`${origin}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: 1 }),
    });
    expect(response.status).toBe(401);
  });

  it("issues an access-token cookie after DID presentation", async () => {
    // FE mock의 vw_session이 아니라 BE의 vw_access_token JWT를 발급하는 지점을 고정한다.
    // 201인 이유: NestJS는 @Post 기본 성공 코드가 201이고 이 컨트롤러는 @HttpCode(200)으로 덮지 않는다.
    // FE 어댑터는 response.ok(200~299)로 판정하므로 동작에는 영향이 없지만,
    // raw status를 200으로 단언하는 e2e(g002 등)는 반드시 201로 고쳐야 한다.
    const response = await fetch(`${origin}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR" }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("vw_access_token");
  });

  it("returns 201 for the authenticated SIWE nonce POST", async () => {
    // POST 계열이 전부 201이라는 사실을 nonce에서도 고정한다 — FE mock은 200이었다.
    const presented = await fetch(`${origin}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR" }),
    });
    const cookie = presented.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
    expect(cookie).toBeDefined();

    const response = await fetch(`${origin}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ chainId: 1 }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number } };
    expect(body.data.domain).toBe("localhost:3100");
    expect(body.data.uri).toBe("http://localhost:3100/connect-wallet");
    expect(body.data.chainId).toBe(1);
  });

  it("returns an anonymous session inside the response envelope", async () => {
    // FE mock과 달리 BE는 익명도 200 envelope로 표현하므로 data 안쪽을 읽는 계약을 고정한다.
    const response = await fetch(`${origin}/api/auth/session`);
    expect(response.status).toBe(200);
    expect((await response.json() as SessionEnvelope).data).toEqual({ didVerified: false, countryCode: null, walletAddress: null, chainId: null });
  });

  it("reads the DID session from the BE access-token cookie", async () => {
    // FE mock 쿠키 이름으로는 BE 세션을 복원할 수 없으므로 JWT 쿠키 전달과 envelope를 함께 고정한다.
    const presented = await fetch(`${origin}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR" }),
    });
    const cookie = presented.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
    expect(cookie).toBeDefined();

    const response = await fetch(`${origin}/api/auth/session`, { headers: { cookie: cookie! } });
    expect(response.status).toBe(200);
    const body = await response.json() as SessionEnvelope;
    expect(body.data.didVerified).toBe(true);
    expect(body.data.countryCode).toBe("KR");
    expect(body.data.walletAddress).toBeNull();
  });

  it("rejects events before a wallet is bound and exposes its BE error code", async () => {
    // FE mock 이벤트는 지갑 미바인딩 오류를 재현하지 않으므로, 실제 IndexerService의 404 경계를 고정한다.
    const presented = await fetch(`${origin}/api/auth/did/present`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "KR" }),
    });
    const cookie = presented.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
    expect(cookie).toBeDefined();

    const response = await fetch(`${origin}/api/events`, { headers: { cookie: cookie! } });
    expect(response.status).toBe(404);
    const body = await response.json() as { error?: { code?: unknown } };
    expect(typeof body.error?.code).toBe("string");
    console.info(`[be-contract-probe] GET /api/events error.code=${body.error?.code}`);
  });
});
