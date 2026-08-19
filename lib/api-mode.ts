/**
 * API 모드 판정의 단일 진실 소스.
 *
 * - `VERAWALLET_BACKEND_ORIGIN`: BE API URL. 설정하면 ON(BE 프록시) 모드 후보다.
 * - `VERAWALLET_MOCK_MODE=true`: URL이 설정돼 있어도 FE mock API를 강제한다(BE의 MOCK_MODE 스위치와 대칭).
 *
 * 값은 process env라 변경 시 서버 재시작이 필요하다. 자동 failover는 없다.
 * 이 헬퍼를 우회해 process.env.VERAWALLET_BACKEND_ORIGIN을 직접 읽는 지점이 생기면
 * mock 강제 스위치를 그 지점만 못 보는 혼합 모드가 생긴다 — 모드 판정은 반드시 이 모듈을 경유한다.
 *
 * "server-only"를 import하지 않는 이유: proxy.ts(요청 프록시)와 RSC/Route Handler가 같은 헬퍼를
 * 써야 하는데, proxy 번들은 RSC 전용 마커와 궁합이 보장되지 않는다. 클라이언트 노출은
 * NEXT_PUBLIC_ 접두사가 아니므로 애초에 인라인되지 않는다.
 */
export function backendOrigin(): string | undefined {
  if (process.env.VERAWALLET_MOCK_MODE === "true") return undefined;
  return process.env.VERAWALLET_BACKEND_ORIGIN || undefined;
}

/** FE mock Route Handler + 인메모리 저장소로 동작하는 모드인가. */
export function isMockApiMode(): boolean {
  return backendOrigin() === undefined;
}

/**
 * BACKEND_ORIGIN 검증/정규화의 순수 함수. Slice 5에서 `backendOrigin()`과 instrumentation의
 * fail-closed 판정에 배선된다. 지금(Slice 0)은 순수 함수로만 추가하며 어떤 런타임 경로에도 배선하지 않는다
 * — `backendOrigin()`의 외부 관측 동작은 무변경이다.
 *
 * - 빈/미설정 → `undefined` (호출자가 fail-closed 여부를 결정)
 * - `http:`/`https:`만 허용, 그 외 스킴은 throw
 * - 자격증명(user:pass), 경로/쿼리/해시 포함은 throw (origin만 허용)
 * - 정규화: `scheme + host + port`만 반환, 후행 슬래시(`http://h:3200/`)는 제거
 */
export function parseBackendOrigin(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`VERAWALLET_BACKEND_ORIGIN이 유효한 URL이 아닙니다: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VERAWALLET_BACKEND_ORIGIN은 http/https만 허용됩니다: ${trimmed}`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`VERAWALLET_BACKEND_ORIGIN에 자격증명(user:pass)을 포함할 수 없습니다: ${trimmed}`);
  }
  // URL은 host가 있으면 빈 경로도 "/"로 정규화하므로, 후행 슬래시 하나는 통과시키되 실제 경로는 거부한다.
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`VERAWALLET_BACKEND_ORIGIN은 경로/쿼리/해시 없이 origin만 허용됩니다: ${trimmed}`);
  }
  return url.origin;
}
