import "server-only";

import { beFetch } from "@/lib/adapters/session/request-cookie.server";
import { isMockApiMode } from "@/lib/api-mode";
import { collectBoundedEvents, EventCollectionTruncatedError } from "@/lib/collect/bounded-event-collector";
import { decodeResponse } from "@/lib/http/error-codec";
import type { EventListDTO } from "@/lib/http/dto";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";
import { beEventListSchema } from "@/lib/schema/be-event-transport";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 서버에서 BE 이벤트를 읽는 어댑터.
 *
 * 브라우저용 `HttpEventRepository`는 `client-only`라 RSC/Route Handler에서 쓸 수 없고,
 * RSC는 상대경로 fetch도 할 수 없다. 그래서 세션과 같은 쿠키 창구(`beFetch`)를 경유하는 server-only 구현을 따로 둔다.
 * 세금 계산이 대시보드와 같은 이벤트를 보게 하는 것이 이 어댑터의 존재 이유다.
 */
export class BeHttpEventRepository {
  constructor(private readonly cookieHeader: string | undefined) {}

  async list(input: { cursor?: string; limit?: number } = {}): Promise<EventListDTO> {
    const query = new URLSearchParams();
    if (input.cursor) query.set("cursor", input.cursor);
    if (input.limit) query.set("limit", String(input.limit));
    const path = `/api/events${query.size ? `?${query}` : ""}`;

    let response: Response;
    try {
      response = await beFetch(path, { cookieHeader: this.cookieHeader, timeoutMs: 5000 });
    } catch (error) {
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SessionInfrastructureError(isTimeout ? "timeout" : "network", "BE 이벤트 조회에 실패했다.");
    }

    const decoded = await decodeResponse(response, beEventListSchema);
    if ("data" in decoded && "meta" in decoded) return decoded.data;
    // 인증 실패(401)·지갑 미바인딩(404)은 인프라 장애가 아니라 도메인 상태다.
    // 하나로 뭉개면 호출부가 "계산할 거래 없음"과 "로그인 필요"를 구분하지 못한다.
    // 다만 2xx인데 오류 envelope가 온 경우는 도메인 상태가 아니라 계약 위반이다 — status 200짜리 오류를 만들지 않는다.
    if (response.ok) throw new SessionInfrastructureError("invalid_contract", `BE 이벤트 응답이 성공 상태인데 오류 envelope다: ${decoded.error.code}`, response.status);
    throw new BeEventReadError(response.status, decoded.error.code, decoded.error.message);
  }
}

/** BE 이벤트 조회가 상태 코드로 거절됐다. status와 code를 보존해 호출부가 사용자에게 맞는 말을 하게 한다. */
export class BeEventReadError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "BeEventReadError";
  }
}

/** 세금 계산 입력이 될 BE 이벤트 스냅샷. 잘린 스냅샷으로 계산하면 사용자에게 틀린 숫자를 말한다. */
export async function readBeWalletEvents(cookieHeader: string | undefined): Promise<NormalizedEvent[]> {
  const { items, truncated } = await collectBoundedEvents(new BeHttpEventRepository(cookieHeader), { pageLimit: 100 });
  if (truncated) throw new EventCollectionTruncatedError(items.length, 50);
  return items.map((item) => item.event);
}

/**
 * 이벤트를 병렬 조회하는 화면(대시보드·내보내기)이 렌더 전에 BE 첫 동기화를 한 번 직렬화한다.
 *
 * BE의 `/api/events`와 `/api/events/summary`는 둘 다 `listOrSync`를 탄다. 대시보드 첫 진입에서 두 훅이 병렬로 나가면
 * 각자 sync를 실행할 수 있고, BE `AnchorSubmissionService.submit`은 호출마다 enqueue하며 `MockAnchorAdapter`는
 * 매번 다른 txHash를 만든다 — 앵커 제출은 멱등이 아니라서 같은 이벤트의 `tx_hash`/`anchored_at`이 흔들린다.
 * RSC에서 먼저 한 번 채워 그 경합을 줄인다.
 *
 * 인증 판정(`lib/dal.ts`)에는 붙이지 않는다. 붙이면 tax·rulesets·anchor-proof 같은 보호 라우트까지
 * 인증 검사만으로 이 부수효과와 타임아웃을 떠안는다. 게이트가 아니라 최적화이므로 실패해도 렌더를 막지 않는다.
 */
export type EventSyncWarmUpResult =
  | { status: "ok" }
  | { status: "skipped"; reason: "no-cookie" | "off-mode" }
  | { status: "failed"; reason: "http_status" | "error"; detail: string };

export async function warmUpBeEventSync(cookieHeader: string | undefined): Promise<EventSyncWarmUpResult> {
  if (isMockApiMode()) return { status: "skipped", reason: "off-mode" };
  if (!cookieHeader) return { status: "skipped", reason: "no-cookie" };

  try {
    const response = await beFetch("/api/events?limit=1", { cookieHeader, timeoutMs: 5000 });
    // 내용은 쓰지 않지만 body를 닫아야 연결이 재사용된다.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) return { status: "failed", reason: "http_status", detail: String(response.status) };
    return { status: "ok" };
  } catch (error) {
    return { status: "failed", reason: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}
