import "server-only";

import { eventRepository } from "@/lib/composition-root.server";
import type { ImportSyncResult } from "@/lib/wallet/import-sync";

/**
 * BE `IndexerService.sync` 결과의 FE mock. BE 계약을 미러한다: `chains`는 지원 체인 전체를 레지스트리 순서로
 * 항상 포함하는 체인별 수집 건수(0 허용)다. mock 저장소에는 증분 개념이 없으므로 저장된 이벤트 수를 그대로 센다.
 */
const SUPPORTED_CHAIN_IDS = [1, 8453, 42161, 10, 137] as const;

export async function mockResyncResult(): Promise<ImportSyncResult> {
  const counts = new Map<number, number>();
  let fetched = 0;
  let cursor: string | undefined;
  do {
    const page = await eventRepository.list({ cursor, limit: 100 });
    for (const item of page.items) {
      fetched += 1;
      counts.set(item.event.chain_id, (counts.get(item.event.chain_id) ?? 0) + 1);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    bindings: 1,
    fetched,
    normalized: fetched,
    chains: SUPPORTED_CHAIN_IDS.map((chainId) => ({ chainId, fetched: counts.get(chainId) ?? 0 })),
    skipped: [],
  };
}

/** mock 작업 id. 상태를 저장하지 않는다 — 조회 시점에 결과를 다시 세면 되므로 id는 형식만 갖춘다. */
export const MOCK_SYNC_JOB_PREFIX = "mock-sync-";
export function isMockSyncJobId(jobId: string): boolean {
  return jobId.startsWith(MOCK_SYNC_JOB_PREFIX);
}
