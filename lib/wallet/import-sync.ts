import "client-only";

import { z } from "zod";

/**
 * 지갑 등록 직후 인덱서 강제 동기화의 클라이언트.
 *
 * BE `POST /api/events/resync`는 **작업을 받았다는 사실**(202 + jobId)만 돌려주고, 진행·완료·실패는
 * `GET /api/events/resync/:jobId`를 폴링해 본다. 동기 응답으로 두면 지갑 하나의 최초 동기화(체인 5개 수집 +
 * 과거 시세)가 프록시 타임아웃(Next 외부 rewrite 30초)에 먼저 끊겨, BE는 정상 완료하는데 모달만 실패로 끝났다.
 *
 * 완료·실패는 여전히 **실제 응답에서만** 나온다 — 폴링 간격이나 경과 시간은 실패의 근거가 아니다.
 * 구 BE(동기 응답에 `chains`가 바로 실림)도 그대로 받는다: BE 핀을 올리기 전의 CI·롤아웃 순서를 묶지 않기 위해서다.
 *
 * `chains`는 지원 체인 전체를 항상 포함하는 체인별 수집 건수(0 허용)라, 불러오기 모달이 이 한 응답으로
 * 체인별 완료 상태를 그린다.
 */
const syncResultSchema = z.object({
  bindings: z.number().int(),
  fetched: z.number().int(),
  normalized: z.number().int(),
  chains: z.array(z.object({ chainId: z.number().int(), fetched: z.number().int() })),
  skipped: z.array(z.object({
    bindingId: z.string(),
    chainId: z.number().int().optional(),
    code: z.string(),
    message: z.string().optional(),
  })),
});

export type ImportSyncResult = z.infer<typeof syncResultSchema>;

const syncJobSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(["queued", "running", "done", "failed"]),
  result: syncResultSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export type ImportSyncJob = z.infer<typeof syncJobSchema>;

/** 폴링 간격. 동기화는 수십 초 단위라 1초면 화면이 늦다고 느끼지 않고 BE도 부담이 없다. */
export const IMPORT_POLL_INTERVAL_MS = 1_000;

/** 동기화가 실제 응답으로 실패했다. code는 BE `error.code` 또는 HTTP 상태(`http_503`)·전송 상태(`job_lost`). */
export class ImportSyncError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ImportSyncError";
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readData(response: Response): Promise<unknown> {
  const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
  return body?.data;
}

export type ImportSyncOptions = {
  /** 폴링을 멈춘다. **화면이 닫히는 것은 이 신호가 아니다** — 불러오기는 창과 무관하게 끝까지 간다. */
  signal?: AbortSignal;
  /** 상태가 바뀔 때마다(받음·진행·완료·실패) 호출된다. 화면이 중간 상태를 쓰고 싶을 때. */
  onJob?: (job: ImportSyncJob) => void;
  pollIntervalMs?: number;
};

/** 작업 하나를 한 번 조회한다. 404·비정상 상태를 여기서 실패로 번역해 호출부가 같은 분기를 되풀이하지 않게 한다. */
async function fetchJob(jobId: string, signal?: AbortSignal): Promise<ImportSyncJob> {
  const polled = await fetch(`/api/events/resync/${encodeURIComponent(jobId)}`, { credentials: "same-origin", signal });
  // 작업 상태는 BE 메모리에만 있다. BE가 재시작되면 진행 중이던 작업은 사라지고 404가 온다 — 실패로 보고 재시도를 준다.
  if (polled.status === 404) throw new ImportSyncError("job_lost", "resync job disappeared (backend restarted?)");
  if (!polled.ok) throw new ImportSyncError(`http_${polled.status}`, `resync status failed with ${polled.status}`);
  return syncJobSchema.parse(await readData(polled));
}

/** 끝날 때까지 폴링한다. 접수 직후(POST 응답)든 이어받기(저장해 둔 jobId)든 그 다음은 같은 루프다. */
async function settleJob(initial: ImportSyncJob, options: ImportSyncOptions): Promise<ImportSyncResult> {
  const { signal, onJob, pollIntervalMs = IMPORT_POLL_INTERVAL_MS } = options;
  let job = initial;
  onJob?.(job);
  while (job.status === "queued" || job.status === "running") {
    await wait(pollIntervalMs, signal);
    job = await fetchJob(job.jobId, signal);
    onJob?.(job);
  }
  if (job.status === "failed") throw new ImportSyncError(job.error?.code ?? "sync_failed", job.error?.message ?? "resync failed");
  // done인데 result가 없으면 계약 위반이다 — 빈 결과로 "완료"를 말하지 않는다.
  return syncResultSchema.parse(job.result);
}

export async function runImportSync(options: ImportSyncOptions = {}): Promise<ImportSyncResult> {
  const accepted = await fetch("/api/events/resync", { method: "POST", credentials: "same-origin", signal: options.signal });
  if (!accepted.ok) throw new ImportSyncError(`http_${accepted.status}`, `resync failed with ${accepted.status}`);
  const data = await readData(accepted);

  // 구 계약: 동기 결과가 바로 온다.
  const legacy = syncResultSchema.safeParse(data);
  if (legacy.success) return legacy.data;

  return settleJob(syncJobSchema.parse(data), options);
}

/**
 * 이미 접수된 작업을 이어서 본다 — 새로고침이나 탭 이동으로 화면이 갈아엎혀도 진행 중인 불러오기를 되찾는 길.
 *
 * POST를 다시 하지 않는 것이 핵심이다. 다시 접수하면 같은 지갑에 동기화 작업이 하나 더 생겨
 * 인덱서를 두 번 돌리고, 사용자에게는 진행하던 불러오기가 처음부터 다시 시작한 것처럼 보인다.
 */
export async function resumeImportSync(jobId: string, options: ImportSyncOptions = {}): Promise<ImportSyncResult> {
  return settleJob(await fetchJob(jobId, options.signal), options);
}
