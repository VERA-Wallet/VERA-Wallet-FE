import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { describe, expect, it, vi } from "vitest";
import { MockAuthStore } from "@/lib/mock/auth-store";
import { isCompletedOnboarding } from "@/lib/dal";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as present } from "@/app/api/auth/did/present/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as testLogin } from "@/app/api/auth/test-login/route";
import { GET as events } from "@/app/api/events/route";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f094538dc9e7b3b3e6eec5bc8b54e8f7f4f0b5d7");
const origin = "https://wallet.example";
type Challenge = { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number; cookie: string };

async function challenge() {
  const did = await present(new Request(`${origin}/api/auth/did/present`, { method: "POST", body: JSON.stringify({ country: "KR" }) }));
  expect(did.status).toBe(201);
  const cookie = did.headers.get("set-cookie")!.split(";")[0];
  const response = await nonce(new Request(`${origin}/api/auth/nonce`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ chainId: 1, domain: "foreign", uri: "https://foreign", address: "0x0" }),
  }));
  expect(response.status).toBe(201);
  return { ...(await response.json()).data as Omit<Challenge, "cookie">, cookie };
}
async function signed(record: Challenge, changes: Partial<Challenge> = {}) {
  const value = { ...record, ...changes };
  const message = new SiweMessage({ address: account.address, version: "1", chainId: value.chainId, domain: value.domain, uri: value.uri, nonce: value.nonce, issuedAt: value.issuedAt, expirationTime: new Date(value.expiresAtMs).toISOString() }).prepareMessage();
  return { message, signature: await account.signMessage({ message }) };
}
async function verifyChallenge(record: Challenge, changes: Partial<Challenge> = {}) {
  const body = await signed(record, changes);
  return verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { cookie: record.cookie }, body: JSON.stringify(body) }));
}

describe("SIWE contract matrix", () => {
  it("derives trusted origin and consumes mismatched challenges like BE", async () => {
    const record = await challenge();
    expect(record).toMatchObject({ domain: "wallet.example", uri: `${origin}/connect-wallet` });
    // nonce는 조회 키(jti=nonce)라 변조 시 레코드 부재 → 400 challenge_not_found가 정본이다.
    const tamperedNonce = await verifyChallenge(record, { nonce: "othernonce" });
    expect(tamperedNonce.status).toBe(400);
    expect((await tamperedNonce.json()).error).toMatchObject({ code: "challenge_not_found" });
    for (const [field, value] of Object.entries({ domain: "other.example", uri: "https://other.example", chainId: 8453, issuedAt: "2026-01-01T00:00:00.000Z" })) {
      const mismatchRecord = await challenge();
      const response = await verifyChallenge(mismatchRecord, { [field]: value });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatchObject({ code: "challenge_mismatch", details: { field } });

      // BE처럼 mismatch 단계에서 이미 consume되므로 유효한 재시도도 409다.
      const retry = await verifyChallenge(mismatchRecord);
      expect(retry.status).toBe(409);
      await expect(retry.json()).resolves.toMatchObject({ error: { code: "already-consumed" } });
    }
    expect((await verifyChallenge(record)).status).toBe(201);
  });

  it("matches BE validation messages for country, chainId, and verify body", async () => {
    const badCountry = await present(new Request(`${origin}/api/auth/did/present`, {
      method: "POST",
      body: JSON.stringify({ country: "JP" }),
    }));
    expect(badCountry.status).toBe(400);
    await expect(badCountry.json()).resolves.toMatchObject({
      error: { code: "invalid_request", message: "country must be one of the following values: KR, DE, US, UK" },
    });

    const record = await challenge();
    const chainCases = [
      [{ chainId: 0 }, "chainId must not be less than 1"],
      [{ chainId: 1.5 }, "chainId must be an integer number"],
      [{ chainId: "1" }, "chainId must not be less than 1, chainId must be an integer number"],
      [{ chainId: null }, "chainId must not be less than 1, chainId must be an integer number"],
      [{}, "chainId must not be less than 1, chainId must be an integer number"],
    ] as const;
    for (const [body, message] of chainCases) {
      const invalidChain = await nonce(new Request(`${origin}/api/auth/nonce`, {
        method: "POST",
        headers: { cookie: record.cookie },
        body: JSON.stringify(body),
      }));
      expect(invalidChain.status).toBe(400);
      await expect(invalidChain.json()).resolves.toMatchObject({ error: { code: "invalid_request", message } });
    }

    const verifyCases = [
      [{}, "message must be a string, signature must be a string"],
      [{ message: "present" }, "signature must be a string"],
      [{ signature: "present" }, "message must be a string"],
    ] as const;
    for (const [body, message] of verifyCases) {
      const invalidBody = await verify(new Request(`${origin}/api/auth/verify`, {
        method: "POST",
        headers: { cookie: record.cookie },
        body: JSON.stringify(body),
      }));
      expect(invalidBody.status).toBe(400);
      await expect(invalidBody.json()).resolves.toMatchObject({ error: { code: "invalid_request", message } });
    }
  });

  it("requires a DID session and binds challenges to that session", async () => {
    const record = await challenge();
    const body = await signed(record);

    const cookieLess = await verify(new Request(`${origin}/api/auth/verify`, {
      method: "POST",
      body: JSON.stringify(body),
    }));
    expect(cookieLess.status).toBe(401);
    await expect(cookieLess.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });

    const otherDid = await present(new Request(`${origin}/api/auth/did/present`, {
      method: "POST",
      body: JSON.stringify({ country: "KR" }),
    }));
    expect(otherDid.status).toBe(201);
    const otherCookie = otherDid.headers.get("set-cookie")!.split(";")[0];
    const otherSession = await verify(new Request(`${origin}/api/auth/verify`, {
      method: "POST",
      headers: { cookie: otherCookie },
      body: JSON.stringify(body),
    }));
    expect(otherSession.status).toBe(400);
    await expect(otherSession.json()).resolves.toMatchObject({ error: { code: "challenge_not_found" } });

    // cross-session 소비 거부가 challenge 상태를 바꾸지 않는지 store 계약 자체에서도 고정한다.
    const store = new MockAuthStore();
    await store.issue({
      jti: record.nonce,
      domain: record.domain,
      uri: record.uri,
      chainId: record.chainId,
      issuedAt: record.issuedAt,
      expiresAtMs: record.expiresAtMs,
      consumedAt: null,
      sessionId: "owner-session",
    });
    expect(await store.consume(record.nonce, "other-session")).toBe("not-found");
    expect((await store.peek(record.nonce))?.consumedAt).toBeNull();
    expect(await store.consume(record.nonce, "owner-session")).toBe("ok");
    const invalidChain = await nonce(new Request(`${origin}/api/auth/nonce`, {
      method: "POST",
      headers: { cookie: record.cookie },
      body: JSON.stringify({ chainId: 0 }),
    }));
    expect(invalidChain.status).toBe(400);
    await expect(invalidChain.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });

    // 다른 세션의 시도가 challenge를 소비하지 않아 소유 세션은 계속 검증할 수 있다.
    expect((await verifyChallenge(record)).status).toBe(201);
  });

  it("permits exactly one concurrent consume and consumes invalid signatures", async () => {
    const record = await challenge();
    const body = await signed(record);
    const responses = await Promise.all([1, 2].map(() => verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { cookie: record.cookie }, body: JSON.stringify(body) }))));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const invalid = await challenge();
    const invalidBody = await signed(invalid);
    const rejected = await verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { cookie: invalid.cookie }, body: JSON.stringify({ ...invalidBody, signature: "0xdeadbeef" }) }));
    expect(rejected.status).toBe(401);
    expect((await verifyChallenge(invalid)).status).toBe(409);
  });

  it("preserves DID claims through wallet verification and guards incomplete sessions", async () => {
    const record = await challenge();
    const cookie = record.cookie;
    const incomplete = await events(new Request(`${origin}/api/events`, { headers: { cookie } }));
    expect(incomplete.status).toBe(404);
    await expect(incomplete.json()).resolves.toMatchObject({
      error: { code: "not_found", message: expect.stringContaining("bound wallet") },
    });

    const body = await signed(record);
    const verified = await verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
    expect(verified.status).toBe(201);
    const sessionCookie = verified.headers.get("set-cookie")!.split(";")[0];
    expect((await (await session(new Request(`${origin}/api/auth/session`, { headers: { cookie: sessionCookie } }))).json()).data).toMatchObject({ countryCode: "KR", walletAddress: account.address });
  });

  it("requires all six onboarding conditions and blocks production test login", async () => {
    const complete = { source: "mock" as const, didVerified: true as const, countryCode: "KR", walletAddress: account.address, chainId: 1, didExpiresAt: 2, walletExpiresAt: 2 };
    expect(isCompletedOnboarding(complete, 1)).toBe(true);
    // didVerified=false 또는 countryCode=null은 이제 mock variant로 표현할 수 없다. 그 불변식은 session-snapshot-invariant 테스트가 고정한다.
    for (const partial of [{ source: "anonymous" as const }, { ...complete, walletAddress: null }, { ...complete, chainId: null }, { ...complete, didExpiresAt: 1 }, { ...complete, walletExpiresAt: 1 }]) expect(isCompletedOnboarding(partial, 1)).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect((await testLogin()).status).toBe(404);
    vi.unstubAllEnvs();
  });
});
