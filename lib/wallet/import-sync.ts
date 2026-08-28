import "client-only";

import { z } from "zod";

/**
 * 지갑 등록 직후 인덱서 강제 동기화(`POST /api/events/resync`)의 클라이언트.
 *
 * BE `IndexerService.sync` 계약을 그대로 받는다. `chains`는 지원 체인 전체를 항상 포함하는
 * 체인별 수집 건수(0 허용)라, 불러오기 모달이 이 한 응답으로 체인별 완료 상태를 그린다.
 * 블로킹 호출이다 — 진행 중간 상태는 오지 않고, 완료(성공/실패)만 실제 사실이다.
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

export async function runImportSync(): Promise<ImportSyncResult> {
  const response = await fetch("/api/events/resync", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error(`resync failed with ${response.status}`);
  const body = await response.json().catch(() => null) as { data?: unknown } | null;
  return syncResultSchema.parse(body?.data);
}
