import "server-only";

const allowedPaths = process.env.SIWE_ALLOWED_URI_PATHS?.split(",").map((path) => path.trim()).filter((path) => path.startsWith("/"));

function parseTrustedOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("SIWE_TRUSTED_ORIGIN must be a bare origin (scheme + authority).");
  return url;
}

export const siweEnv = {
  /** 명시적 공개 origin (예: https://app.example.com). 설정 시 요청 Host 불일치는 거부된다. */
  trustedOrigin: parseTrustedOrigin(process.env.SIWE_TRUSTED_ORIGIN ?? (process.env.SIWE_TRUSTED_DOMAIN ? `https://${process.env.SIWE_TRUSTED_DOMAIN}` : undefined)),
  allowedUriPaths: allowedPaths?.length ? allowedPaths : ["/connect-wallet"],
};
