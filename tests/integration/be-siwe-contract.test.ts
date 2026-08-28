import { beforeAll, describe, expect, it } from "vitest";
import { startBackend, stopBackend } from "./support/server-harness";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const FE = "http://localhost:3100";

// BE mock identity는 모든 DID를 같은 user로 매핑한다. 앞선 파일이 지갑을 바인딩해 두면
// "DID만 있고 지갑은 없는" 전제가 깨지므로, 이 파일은 자기 전제를 스스로 만든다(프로세스 재기동 = 인메모리 초기화).
beforeAll(async () => {
  // 정리 실패를 삼키면 옛 BE가 살아 있는 채로 다음 파일이 green이 된다. stopBackend()는 PID 기록이 없으면 no-op이다.
  await stopBackend();
  await startBackend({ port: 3200 });
}, 180_000);
const KEY = "0x6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f" as const;

type Nonce = { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number };

async function presentDid(country: "KR" | "US" = "US"): Promise<string> {
  const response = await fetch(`${FE}/api/auth/did/present`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country }),
  });
  const cookie = response.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
  if (!cookie) throw new Error(`DID presentation failed with ${response.status}.`);
  return cookie;
}

async function issueNonce(cookie: string): Promise<Nonce> {
  const response = await fetch(`${FE}/api/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chainId: 1 }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { data: Nonce }).data;
}

function siwe(nonce: Nonce, address: `0x${string}`, overrides: Partial<{ domain: string; uri: string }> = {}): string {
  return new SiweMessage({
    address,
    version: "1",
    chainId: nonce.chainId,
    domain: overrides.domain ?? nonce.domain,
    uri: overrides.uri ?? nonce.uri,
    nonce: nonce.nonce,
    issuedAt: nonce.issuedAt,
  }).prepareMessage();
}

async function verify(cookie: string, message: string, signature: string) {
  const response = await fetch(`${FE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message, signature }),
  });
  return { status: response.status, body: await response.json() as { error?: { code?: string } } };
}

// BE의 raw SIWE 계약. 이제 FE mock도 동일(409/400·consume-먼저)라 이 스펙은 rewrite 경유 raw BE 관측을 고정한다.
describe.sequential("BE SIWE raw contract through the rewrite", () => {
  it("requires a DID session before issuing a nonce", async () => {
    const response = await fetch(`${FE}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: 1 }),
    });
    // FE mock은 익명 nonce를 허용했지만 BE는 JwtAuthGuard로 막는다.
    expect(response.status).toBe(401);
  });

  it("serves events for a DID-only session as an empty 200, never a 401", async () => {
    // 핵심은 DID 쿠키가 인증으로는 유효하다는 것 — 워치온리 전환 후 미바인딩 읽기는 200 빈 목록이고,
    // 지갑을 요구하는 경계는 명시적 resync의 bound-wallet 404로만 남는다.
    const cookie = await presentDid();
    const response = await fetch(`${FE}/api/events`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data?: { items?: unknown[] } }).data?.items).toEqual([]);

    const resync = await fetch(`${FE}/api/events/resync`, { method: "POST", headers: { cookie } });
    expect(resync.status).toBe(404);
    expect((await resync.json() as { error?: { message?: string } }).error?.message).toContain("bound wallet");
  });

  it("binds a wallet once and reports the replay as already-consumed with 409", async () => {
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const nonce = await issueNonce(cookie);
    const message = siwe(nonce, account.address);
    const signature = await account.signMessage({ message });

    const first = await verify(cookie, message, signature);
    expect(first.status).toBe(201);

    const replay = await verify(cookie, message, signature);
    // FE mock도 이제 409/400으로 정렬됨(정렬 이전엔 422). BE는 ConflictException이라 409다.
    expect(replay.status).toBe(409);
    expect(replay.body.error?.code).toBe("already-consumed");
  });

  it("rejects a foreign-domain message with 400 challenge_mismatch", async () => {
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const nonce = await issueNonce(cookie);
    const message = siwe(nonce, account.address, { domain: "attacker.example", uri: "https://attacker.example/login" });

    const mismatch = await verify(cookie, message, await account.signMessage({ message }));
    // FE mock도 이제 409/400으로 정렬됨(정렬 이전엔 422). BE는 BadRequestException이라 400이다.
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error?.code).toBe("challenge_mismatch");
  });

  it("rejects an invalid signature with 401 and consumes the nonce", async () => {
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const nonce = await issueNonce(cookie);
    const message = siwe(nonce, account.address);

    const invalid = await verify(cookie, message, `0x${"1".repeat(130)}`);
    expect(invalid.status).toBe(401);

    const retry = await verify(cookie, message, await account.signMessage({ message }));
    expect(retry.status).toBe(409);
    expect(retry.body.error?.code).toBe("already-consumed");
  });

  it("keeps an existing wallet binding when the DID is presented again", async () => {
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const nonce = await issueNonce(cookie);
    const message = siwe(nonce, account.address);
    expect((await verify(cookie, message, await account.signMessage({ message }))).status).toBe(201);

    // FE mock과 BE 양쪽 모두 지갑 클레임을 유지한다.
    const reissued = await presentDid();
    const session = await fetch(`${FE}/api/auth/session`, { headers: { cookie: reissued } });
    const body = await session.json() as { data: { walletAddress: string | null } };
    expect(body.data.walletAddress?.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("distinguishes a missing challenge from a mismatched one", async () => {
    // nonce를 발급받지 않고 곧장 verify하면 소비할 challenge가 없다.
    // mismatch(400 challenge_mismatch)와 코드가 갈려야 화면이 "요청이 어긋났다"와 "요청 자체가 없다"를 다르게 말한다.
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const message = new SiweMessage({
      address: account.address,
      version: "1",
      chainId: 1,
      domain: "localhost:3100",
      uri: "http://localhost:3100/connect-wallet",
      nonce: "00000000000000000000000000000000",
      issuedAt: new Date().toISOString(),
    }).prepareMessage();

    const result = await verify(cookie, message, await account.signMessage({ message }));
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("challenge_not_found");
  });

  it("issues a challenge with the five-minute TTL the expiry contract depends on", async () => {
    // 410 challenge_expired는 이 TTL이 지나야 난다. 실제 만료 대기는 아래 별도 블록에서 한다.
    const cookie = await presentDid();
    const before = Date.now();
    const nonce = await issueNonce(cookie);
    const ttl = nonce.expiresAtMs - before;
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 5_000);
  });
});

// 만료 계약(410)은 실제로 TTL이 지나야 관측된다. 조건부 skip으로 덮지 않고 별도 직렬 블록에서 실제로 기다려 확인한다.
// lane 시간이 늘지만, "만료된 challenge를 소비할 수 있는가"는 조용히 비워 둘 수 있는 경계가 아니다.
describe.sequential("BE SIWE expiry contract", () => {
  it("rejects a challenge consumed after its TTL with 410 challenge_expired", async () => {
    const account = privateKeyToAccount(KEY);
    const cookie = await presentDid();
    const nonce = await issueNonce(cookie);

    const waitMs = nonce.expiresAtMs - Date.now() + 1_000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));

    const message = siwe(nonce, account.address);
    const result = await verify(cookie, message, await account.signMessage({ message }));
    expect(result.status).toBe(410);
    expect(result.body.error?.code).toBe("challenge_expired");
  }, 400_000);
});
