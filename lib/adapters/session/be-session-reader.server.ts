import "server-only";

import { z } from "zod";

import { BackendOriginNotConfiguredError, beFetch } from "@/lib/adapters/session/request-cookie.server";
import { anonymousSnapshot, type SessionSnapshot } from "@/lib/ports/session-snapshot";
import { SessionInfrastructureError, type SessionReader } from "@/lib/ports/session-reader";

const sessionEnvelopeSchema = z.object({
  data: z.object({
    didVerified: z.boolean(),
    countryCode: z.string().nullable(),
    walletAddress: z.string().nullable(),
    // 선택인 이유: BE 세션 계약에 아직 이 필드가 없다. 필수로 걸면 지금 BE 응답이 invalid_contract로 떨어져
    // 미인증이 아니라 인프라 장애로 분류되고 전 페이지가 에러 화면이 된다. BE가 내려주기 시작하면 그대로 실린다.
    walletVerification: z.enum(["siwe", "watch_only"]).nullable().optional(),
  }),
});

export class BeSessionReader implements SessionReader {
  readonly cookieMode = "access-token" as const;

  async read(cookieHeader: string | undefined): Promise<SessionSnapshot> {
    // 액세스 토큰이 없으면 BE도 인증할 수 없으므로 불필요한 왕복을 제거한다.
    if (!cookieHeader) return anonymousSnapshot();

    let response: Response;
    try {
      response = await beFetch("/api/auth/session", { cookieHeader, timeoutMs: 2000 });
    } catch (error) {
      // 설정 누락은 인프라 장애가 아니라 프로그램 오류다. network로 뭉개면 원인을 영영 못 찾는다.
      if (error instanceof BackendOriginNotConfiguredError) throw error;
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SessionInfrastructureError(isTimeout ? "timeout" : "network", "BE 세션 조회에 실패했다.");
    }

    if (response.status !== 200) {
      // 폐기할 응답도 body를 닫아 준다. 남겨 두면 Node/undici가 연결을 재사용하지 못하고 소켓·힙이 샌다.
      // 닫기 실패가 원래 오류 분류를 덮지 않도록 삼킨다.
      await response.body?.cancel().catch(() => undefined);
      throw new SessionInfrastructureError("http_status", "BE 세션 조회가 성공 상태가 아니다.", response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SessionInfrastructureError("invalid_json", "BE 세션 응답 JSON을 해석할 수 없다.");
    }

    const parsed = sessionEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw new SessionInfrastructureError("invalid_contract", "BE 세션 응답 계약이 올바르지 않다.");

    const { data } = parsed.data;
    // 미인증 또는 DID 국가 미완성은 오류가 아니라 BE가 알려 준 정상적인 익명 상태다.
    if (!data.didVerified || data.countryCode === null) return anonymousSnapshot();

    return { source: "be", didVerified: true, countryCode: data.countryCode, walletAddress: data.walletAddress, walletVerification: data.walletVerification };
  }
}

// BE 이벤트 선행 동기화(warm-up)는 Stage 1 범위가 아니다.
// rewrite가 꺼져 있는 동안에는 브라우저의 이벤트 요청이 BE로 가지 않으므로 선행 동기화가 아무것도 덜어 주지 못하고,
// RSC 렌더만 최대 5초 지연시키며 BE `listOrSync`의 비멱등 앵커 제출만 남긴다.
// 브라우저 요청이 실제로 BE로 향하는 Stage 2(rewrite 활성화)에서 그 소비 경계와 함께 도입한다.