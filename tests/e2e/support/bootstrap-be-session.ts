import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

/**
 * 브라우저 컨텍스트에 완료 세션 쿠키를 심는다.
 *
 * ON 모드에서는 `test-login`이 404이고(그 라우트는 `vw_session`만 발급해 BE 세션이 되지 않는다),
 * OFF 모드에서는 BE가 없으므로 기존 `test-login`을 그대로 쓴다. 한 헬퍼로 두 모드를 덮어
 * 스펙이 모드를 알지 않아도 되게 한다.
 *
 * BE `bindSiwe`는 domain·uri·chainId·issuedAt을 challenge와 완전 일치 비교하므로 nonce 응답값을 재생성하지 않는다.
 */
export async function bootstrapSession(
  page: Page,
  opts: { privateKey: `0x${string}`; country?: "KR" | "US" | "UK" | "DE" } ,
): Promise<void> {
  const request = page.context().request;

  if (!process.env.VERAWALLET_BACKEND_ORIGIN) {
    const response = await request.post("/api/auth/test-login");
    if (response.status() !== 204) throw new Error(`test-login failed with ${response.status()}.`);
    return;
  }

  const account = privateKeyToAccount(opts.privateKey);
  const presented = await request.post("/api/auth/did/present", { data: { country: opts.country ?? "KR" } });
  if (presented.status() !== 201) throw new Error(`DID presentation failed with ${presented.status()}.`);

  const nonceResponse = await request.post("/api/auth/nonce", { data: { chainId: 1 } });
  if (nonceResponse.status() !== 201) throw new Error(`nonce request failed with ${nonceResponse.status()}.`);
  const nonce = (await nonceResponse.json() as { data: { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string } }).data;

  const message = new SiweMessage({
    address: account.address,
    version: "1",
    chainId: nonce.chainId,
    domain: nonce.domain,
    uri: nonce.uri,
    nonce: nonce.nonce,
    issuedAt: nonce.issuedAt,
  }).prepareMessage();

  const verified = await request.post("/api/auth/verify", { data: { message, signature: await account.signMessage({ message }) } });
  if (!verified.ok()) throw new Error(`SIWE verify failed with ${verified.status()}: ${await verified.text()}`);
}
