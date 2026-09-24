import { recordTiming } from "@/lib/diagnostics/performance";
import { ReportVcError } from "@/lib/report-vc/types";

/**
 * 시도 하나의 폴링. 로그인 흐름(`components/did/opendid-presentation.tsx`)과 같은 규칙을 한 곳에 모았다.
 *
 * - 응답이 오기 전에는 다음 요청을 보내지 않는다(겹치지 않는다).
 * - `expiresAt`이 지나면 서버에 묻지 않고 멈춘다. 만료된 QR로 계속 묻는 것은 무한 폴링이다.
 * - 429·503은 `Retry-After` 뒤 다시 묻고, 그 외 오류는 종결이다.
 * - `maxRequests`를 넘기면 "시간 안에 확인하지 못함"으로 끝낸다. 만료가 상한이지만 서버가 만료를 늦게 세우는 경우의 안전장치다.
 * - 돌려주는 함수는 정리(stop)다. 화면 이탈·취소·재시도 때 반드시 부른다. 그 뒤 도착한 응답은 버린다.
 */
export type PollStep<T> = { done: true; value: T } | { done: false; retryAfterMs: number };

export type PollOptions<T> = {
  diagnosticName?: "vc.link_wait" | "vc.issue_wait" | "vc.verify_wait";
  expiresAt: string;
  initialDelayMs: number;
  request: (signal: AbortSignal) => Promise<PollStep<T>>;
  onDone: (value: T) => void;
  onExpired: () => void;
  onError: (error: unknown) => void;
  /** 조회 상한. 기본 120회. */
  maxRequests?: number;
  /** 요청 하나의 제한 시간. 기본 35초. */
  requestTimeoutMs?: number;
  now?: () => number;
};

export const DEFAULT_MAX_POLL_REQUESTS = 120;

export function startPolling<T>(options: PollOptions<T>): () => void {
  const { request, onDone, onExpired, onError } = options;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_POLL_REQUESTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? 35_000;
  const now = options.now ?? Date.now;
  const expires = Date.parse(options.expiresAt);
  const controller = new AbortController();
  const startedAt = performance.now();
  let stopped = false;
  let requests = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = (outcome = "stopped") => {
    if (stopped) return;
    recordTiming({ kind: "interaction", name: options.diagnosticName ?? "vc.poll_wait", durationMs: performance.now() - startedAt, atMs: startedAt, outcome });
    stopped = true;
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };

  async function tick() {
    if (stopped) return;
    if (now() >= expires) { stop("expired"); onExpired(); return; }
    if (requests >= maxRequests) {
      stop("error");
      onError(new ReportVcError(0, "poll_exhausted", "시간 안에 결과를 확인하지 못했습니다. 다시 시도하세요."));
      return;
    }
    requests += 1;
    let delay: number;
    try {
      const step = await request(AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]));
      if (stopped) return;
      if (step.done) { stop("done"); onDone(step.value); return; }
      delay = step.retryAfterMs;
    } catch (cause) {
      if (stopped) return;
      if (cause instanceof ReportVcError && cause.transient) {
        delay = cause.retryAfterMs;
      } else if (cause instanceof DOMException && cause.name === "TimeoutError") {
        // 한 번의 요청이 늦은 것은 종결이 아니다. 다음 주기에 다시 묻는다.
        delay = 2000;
      } else {
        stop("error");
        onError(cause);
        return;
      }
    }
    if (now() >= expires) { stop("expired"); onExpired(); return; }
    timer = setTimeout(() => { void tick(); }, delay);
  }

  timer = setTimeout(() => { void tick(); }, options.initialDelayMs);
  return stop;
}
