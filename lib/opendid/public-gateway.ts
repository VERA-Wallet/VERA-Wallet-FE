/** Only wallet-facing protocol endpoints. Admin, issuance offers/results and VP confirmation stay private. */
const routes: Record<string, { port: number; get?: string[]; post?: string[] }> = {
  tas: { port: 8090, get: ["certificate-vc", "vc-schema"], post: [
    "propose-register-user", "retrieve-kyc", "request-register-user", "confirm-register-user",
    "request-ecdh", "request-create-token", "request-register-wallet",
    "propose-issue-vc", "request-issue-profile", "request-issue-vc", "confirm-issue-vc",
    "propose-revoke-vc", "request-revoke-vc", "confirm-revoke-vc",
    "propose-update-diddoc", "request-update-diddoc", "confirm-update-diddoc",
    "propose-restore-diddoc", "request-restore-diddoc", "confirm-restore-diddoc",
  ] },
  list: { port: 8090, get: ["allowed-ca/list", "vcplan/list"] },
  issuer: { port: 8091, get: ["certificate-vc", "vc-schema", "vc/vcschema"] },
  verifier: { port: 8092, get: ["certificate-vc"], post: ["request-profile", "request-verify", "request-proof-request-profile", "request-verify-proof"] },
  "api-gateway": { port: 8093, get: ["did-doc", "vc-meta", "zkp-cred-def", "zkp-cred-schema"] },
  cas: { port: 8094, get: ["certificate-vc"], post: ["request-attested-appinfo", "request-wallet-tokendata"] },
  wallet: { port: 8095, get: ["certificate-vc"], post: ["request-sign-wallet"] },
};

export function publicDidTarget(path: string[], method: string, host: string): URL | null {
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || path.some(p => !/^[a-zA-Z0-9-]+$/.test(p))) return null;
  const [service, api, version, ...tail] = path;
  const route = routes[service];
  if (!route || api !== "api" || version !== "v1") return null;
  const allowed = method === "GET" ? route.get : method === "POST" ? route.post : undefined;
  if (!allowed?.includes(tail.join("/"))) return null;
  return new URL(`http://${host}:${route.port}/${path.join("/")}`);
}
