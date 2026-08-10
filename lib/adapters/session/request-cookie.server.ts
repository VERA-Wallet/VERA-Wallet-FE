import "server-only";

import { cookies } from "next/headers";

const ACCESS_TOKEN_COOKIE_NAME = "vw_access_token";

// 이 모듈은 vw_access_token 단일 쿠키만 추출·전달한다. 전체 쿠키를 흘리면 FE가 나중에 추가할 쿠키가 BE로 새어나간다.
export async function resolveAccessTokenCookie(request?: Request): Promise<string | undefined> {
  if (request) {
    const cookieHeader = request.headers.get("cookie");
    return cookieHeader?.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`))?.slice(ACCESS_TOKEN_COOKIE_NAME.length + 1);
  }

  return (await cookies()).get(ACCESS_TOKEN_COOKIE_NAME)?.value;
}

export async function resolveCookieHeader(request?: Request): Promise<string | undefined> {
  const token = await resolveAccessTokenCookie(request);
  return token === undefined ? undefined : `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
}

/**
 * 요청의 쿠키 헤더 전문. OFF(mock) 모드 전용이다.
 *
 * mock 세션 리더는 `vw_session`을 읽어야 하는데 위 access-token 전용 추출기는 그걸 버린다.
 * 그렇다고 raw 헤더를 BE로 보내면 최소 노출 원칙이 깨지므로, 목적지가 네트워크인 쪽(BE)과
 * 프로세스 안에서 끝나는 쪽(mock 저장소 조회)을 다른 함수로 분리한다. 이 값은 절대 beFetch로 넘기지 않는다.
 */
export async function resolveRawCookieHeader(request?: Request): Promise<string | undefined> {
  if (request) return request.headers.get("cookie") ?? undefined;
  const jar = (await cookies()).toString();
  return jar.length === 0 ? undefined : jar;
}

/** 설정 누락은 네트워크 장애가 아니다. 세션 리더가 이걸 "network"로 뭉개면 원인 진단이 어긋난다. */
export class BackendOriginNotConfiguredError extends Error {
  constructor() {
    super("VERAWALLET_BACKEND_ORIGIN이 설정되지 않은 상태에서 beFetch가 호출됐다.");
    this.name = "BackendOriginNotConfiguredError";
  }
}

export async function beFetch(path: string, opts: { cookieHeader?: string; timeoutMs?: number; init?: RequestInit } = {}): Promise<Response> {
  const origin = process.env.VERAWALLET_BACKEND_ORIGIN;
  if (!origin) throw new BackendOriginNotConfiguredError();

  const { cookieHeader, timeoutMs = 2000, init } = opts;
  const headers = new Headers(init?.headers);
  // 이 모듈이 유일한 쿠키 창구라는 불변식을 코드로 강제한다.
  // 호출자가 init.headers에 raw cookie를 실어 보내거나 cookieHeader에 헤더 전문을 넘겨도
  // vw_access_token 외에는 절대 BE로 나가지 않도록 여기서 한 번 더 걸러 낸다(방어적 심층 방어).
  headers.delete("cookie");
  const token = cookieHeader
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
  if (token) headers.set("cookie", token);

  // 사용자별 인증 응답이 요청 간에 재사용되면 안 된다.
  return fetch(`${origin}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}
