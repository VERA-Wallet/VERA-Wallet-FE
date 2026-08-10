import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { describe, expect, it, vi } from "vitest";
import { isCompletedOnboarding } from "@/lib/dal";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as present } from "@/app/api/auth/did/present/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as testLogin } from "@/app/api/auth/test-login/route";
import { GET as events } from "@/app/api/events/route";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f094538dc9e7b3b3e6eec5bc8b54e8f7f4f0b5d7");
const origin = "https://wallet.example";
type Challenge = { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number };

async function challenge() {
  const response = await nonce(new Request(`${origin}/api/auth/nonce`, { method: "POST", body: JSON.stringify({ chainId: 1, domain: "foreign", uri: "https://foreign", address: "0x0" }) }));
  return (await response.json()).data as Challenge;
}
async function signed(record: Challenge, changes: Partial<Challenge> = {}) {
  const value = { ...record, ...changes };
  const message = new SiweMessage({ address: account.address, version: "1", chainId: value.chainId, domain: value.domain, uri: value.uri, nonce: value.nonce, issuedAt: value.issuedAt, expirationTime: new Date(value.expiresAtMs).toISOString() }).prepareMessage();
  return { message, signature: await account.signMessage({ message }) };
}
async function verifyChallenge(record: Challenge, changes: Partial<Challenge> = {}) {
  const body = await signed(record, changes);
  return verify(new Request(`${origin}/api/auth/verify`, { method: "POST", body: JSON.stringify(body) }));
}

describe("SIWE contract matrix", () => {
  it("derives trusted origin and leaves mismatched challenges reusable", async () => {
    const record = await challenge();
    expect(record).toMatchObject({ domain: "wallet.example", uri: `${origin}/connect-wallet` });
    // nonce는 조회 키(jti=nonce)라 변조 시 레코드 부재 → 400 challenge_not_found가 정본이다.
    const tamperedNonce = await verifyChallenge(record, { nonce: "othernonce" });
    expect(tamperedNonce.status).toBe(400);
    expect((await tamperedNonce.json()).error).toMatchObject({ code: "challenge_not_found" });
    for (const [field, value] of Object.entries({ domain: "other.example", uri: "https://other.example", chainId: 8453, issuedAt: "2026-01-01T00:00:00.000Z" })) {
      const response = await verifyChallenge(record, { [field]: value });
      expect(response.status).toBe(422);
      expect((await response.json()).error).toMatchObject({ code: "challenge_mismatch", details: { field } });
    }
    expect((await verifyChallenge(record)).status).toBe(200);
  });

  it("permits exactly one concurrent consume and consumes invalid signatures", async () => {
    const record = await challenge();
    const body = await signed(record);
    const responses = await Promise.all([1, 2].map(() => verify(new Request(`${origin}/api/auth/verify`, { method: "POST", body: JSON.stringify(body) }))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 422]);
    const invalid = await challenge();
    const invalidBody = await signed(invalid);
    const rejected = await verify(new Request(`${origin}/api/auth/verify`, { method: "POST", body: JSON.stringify({ ...invalidBody, signature: "0xdeadbeef" }) }));
    expect(rejected.status).toBe(401);
    expect((await verifyChallenge(invalid)).status).toBe(422);
  });

  it("preserves DID claims through wallet verification and guards incomplete sessions", async () => {
    const did = await present(new Request(`${origin}/api/auth/did/present`, { method: "POST", body: JSON.stringify({ country: "KR" }) }));
    const cookie = did.headers.get("set-cookie")!.split(";")[0];
    const record = await challenge();
    const body = await signed(record);
    const verified = await verify(new Request(`${origin}/api/auth/verify`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
    const sessionCookie = verified.headers.get("set-cookie")!.split(";")[0];
    expect((await (await session(new Request(`${origin}/api/auth/session`, { headers: { cookie: sessionCookie } }))).json()).data).toMatchObject({ countryCode: "KR", walletAddress: account.address });
    expect((await events(new Request(`${origin}/api/events`))).status).toBe(401);
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
