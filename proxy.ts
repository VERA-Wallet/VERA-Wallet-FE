import { NextResponse } from "next/server";
import { backendOrigin } from "@/lib/api-mode";
import type { NextRequest } from "next/server";

const ACCESS_TOKEN_COOKIE_NAME = "vw_access_token";

/**
 * BE가 소유하는 경로만 열거하는 positive allowlist.
 *
 * 여기 없는 경로(`/api/tax/*`, `/api/rulesets`, `/api/portfolio/*`, `/api/auth/test-login`)는 FE Route Handler가 그대로 처리한다.
 * `/api/portfolio/holdings`는 ON 모드에서도 FE가 소유한다 — BE 응답의 KRW 원가를 환율로 USD 환산해야 하기 때문이다(`/api/tax/*`와 같은 이유).
 * "가릴 것을 빼는" negative 방식을 쓰지 않는 이유: 규칙을 하나 빠뜨리면 조용히 BE로 새어 나가고,
 * 번들된 path-to-regexp는 `?`로 시작하는 그룹(negative lookahead)을 거부한다.
 * VERAWALLET_MOCK_MODE=true면 backendOrigin()이 undefined를 돌려 프록시가 전면 OFF(FE mock 처리)한다.
 */
const BACKEND_OWNED_PATHS = new Set([
  "/api/auth/did/present",
  "/api/auth/nonce",
  "/api/auth/verify",
  "/api/auth/wallet/watch",
  "/api/auth/wallets",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/anchor-proof",
]);

/**
 * BE로 전달할 요청 헤더 allowlist.
 *
 * 통째로 복사하지 않는 이유: BE `JwtStrategy`가 Authorization을 쿠키보다 먼저 읽으므로
 * 호출자가 심은 bearer가 쿠키 신원을 덮어쓸 수 있고, forwarding/hop-by-hop 헤더도 상류로 샐 필요가 없다.
 * 쿠키는 아래에서 `vw_access_token` 하나로 다시 만든다.
 */
const FORWARDED_HEADERS = ["accept", "accept-language", "content-type", "content-length", "user-agent"] as const;

function isBackendOwned(pathname: string): boolean {
  // 지갑 등록 해제(`DELETE /api/auth/wallets/:address`)는 바인딩과 그 거래·커서를 BE가 함께 지운다. 하위 경로도 BE 소유다.
  return BACKEND_OWNED_PATHS.has(pathname) || pathname === "/api/events" || pathname.startsWith("/api/events/") || pathname.startsWith("/api/auth/wallets/");
}

/**
 * 하이브리드 프록시. `next.config.ts`의 rewrite가 아니라 여기서 처리하는 이유가 둘 있다.
 *
 * 1. **쿠키 최소 노출**: external rewrite는 원 요청 헤더를 그대로 전달해 `vw_session` 같은 FE 전용 쿠키까지
 *    BE로 나간다. 여기서는 요청 헤더를 다시 만들어 `vw_access_token` 하나만 실어 보낸다.
 * 2. **모드가 런타임 결정**: `next.config.ts`의 rewrite는 `.next/routes-manifest.json`에 빌드 시점으로 박힌다.
 *    OFF로 빌드한 산출물에 env만 켜서 `next start`하면 인증은 ON, 브라우저 이벤트 경로는 FE mock인 혼합 모드가 된다.
 *    proxy는 매 요청 시점에 env를 보므로 그런 절반짜리 상태가 생기지 않는다.
 */
export function proxy(request: NextRequest) {
  const origin = backendOrigin();
  if (!origin || !isBackendOwned(request.nextUrl.pathname)) return NextResponse.next();

  // 헤더도 통째로 넘기지 않는다. BE `JwtStrategy`는 Authorization을 쿠키보다 먼저 읽으므로,
  // 호출자가 심은 bearer 토큰이 쿠키 신원을 덮어쓸 수 있다. hop-by-hop·forwarding 헤더도 상류로 보내지 않는다.
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (token) headers.set("cookie", `${ACCESS_TOKEN_COOKIE_NAME}=${token}`);

  const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, origin);
  const res = NextResponse.rewrite(destination, { request: { headers } });
  res.headers.set("x-verawallet-fe-rewrite", request.nextUrl.pathname);
  return res;
}

export const config = {
  // 실효 allowlist와 같은 폭으로 좁힌다. matcher가 더 넓으면 앞으로 추가될 auth 라우트가 조용히 proxy를 타게 된다.
  matcher: [
    "/api/auth/did/present",
    "/api/auth/nonce",
    "/api/auth/verify",
    "/api/auth/wallet/watch",
    "/api/auth/wallets",
    "/api/auth/wallets/:address",
    "/api/auth/session",
    "/api/auth/logout",
    "/api/events",
    "/api/events/:path*",
    "/api/anchor-proof",
  ],
};
