import type { SessionSnapshot } from "@/lib/ports/session-snapshot";

export type SessionInfrastructureCause = "timeout" | "network" | "http_status" | "invalid_json" | "invalid_contract";

// 이 오류는 미인증이 아니라 인프라 장애다. null(익명)로 접으면 장애가 로그인 화면으로 위장되고 리다이렉트 루프가 된다.
export class SessionInfrastructureError extends Error {
  // Error 표준 cause 옵션과 이름이 겹치지만 계약의 오류 분류를 호출부에 그대로 전달하기 위해 자체 cause를 유지하고 super에는 message만 넘긴다.
  readonly cause: SessionInfrastructureCause;
  readonly status?: number;

  constructor(cause: SessionInfrastructureCause, message: string, status?: number) {
    super(message);
    this.name = "SessionInfrastructureError";
    this.cause = cause;
    this.status = status;
  }
}

export interface SessionReader {
  /**
   * 이 리더가 필요로 하는 쿠키의 종류.
   * - "access-token": BE로 나갈 `vw_access_token` 하나만(최소 노출).
   * - "raw": 프로세스 안에서 끝나는 mock 저장소 조회용 쿠키 헤더 전문(`vw_session` 포함).
   * DAL이 리더 구분 없이 access-token 헤더만 넘기면 OFF 모드에서 `vw_session`이 버려져 세션이 영원히 익명이 된다.
   */
  readonly cookieMode: "access-token" | "raw";
  read(cookieHeader: string | undefined): Promise<SessionSnapshot>;
}
