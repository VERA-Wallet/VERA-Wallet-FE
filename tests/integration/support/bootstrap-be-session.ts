import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

/**
 * BE가 인정하는 완료 세션(DID + SIWE 지갑 바인딩)을 만든다.
 *
 * `test-login`은 ON 모드에서 404이고 애초에 `vw_session`만 발급하므로 BE 세션이 되지 않는다.
 * BE `bindSiwe`는 domain·uri·chainId·issuedAt을 challenge와 완전 일치 비교하므로 nonce 응답값을 그대로 써야 한다.
 */
export async function bootstrapBeSession(
  origin: string,
  privateKey: `0x${string}`,
  country: "KR" | "US" | "UK" | "DE" = "KR",
): Promise<string> {
  const account = privateKeyToAccount(privateKey);

  const presented = await fetch(`${origin}/api/auth/did/present`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country }),
  });
  const cookie = presented.headers.get("set-cookie")?.match(/vw_access_token=[^;]+/)?.[0];
  if (!cookie) throw new Error(`DID presentation did not issue vw_access_token (status ${presented.status}).`);

  const nonceResponse = await fetch(`${origin}/api/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ chainId: 1 }),
  });
  if (!nonceResponse.ok) throw new Error(`nonce request failed with ${nonceResponse.status}.`);
  const nonce = (await nonceResponse.json() as { data: { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number } }).data;

  const message = new SiweMessage({
    address: account.address,
    version: "1",
    chainId: nonce.chainId,
    domain: nonce.domain,
    uri: nonce.uri,
    nonce: nonce.nonce,
    issuedAt: nonce.issuedAt,
  }).prepareMessage();

  const verified = await fetch(`${origin}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
  });
  if (!verified.ok) throw new Error(`SIWE verify failed with ${verified.status}: ${await verified.text()}`);

  return cookie;
}
