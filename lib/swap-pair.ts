import { effectiveClassification, needsReview } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 스왑 두 다리 페어링 — 같은 tx_hash를 공유하는 **처분(EXCHANGE·OUT) + 취득(IN)** 한 쌍을 찾는다.
 *
 * 스왑 1건은 원장에 이벤트 2개로 실린다(내보낸 자산·받은 자산). 세무 파생은 그대로 두 건을
 * 각각 처분·취득으로 계산하고(엔진 무변경), **표시**만 한 행으로 묶는다 — 목록은 OUT 다리를
 * 대표로 그리고 IN 다리는 받은 수량·자산을 공급하며 별도 행으로 렌더하지 않는다.
 */
export type SwapPairing = {
  /** OUT(처분) 다리 id → IN(취득) 다리 이벤트. 목록·상세가 받은 자산을 그릴 때 쓴다. */
  inLegByOutId: Map<string, NormalizedEvent>;
  /** 목록에서 별도 행으로 렌더하지 않을 IN 다리 id. */
  pairedInIds: Set<string>;
};

/**
 * 페어링 규칙 — 애매하면 묶지 않는다(따로 두 행이 정확하고, 잘못 묶으면 거래를 지운 셈이 된다):
 * - 같은 tx_hash 그룹에 이벤트가 **정확히 2개**일 때만 본다(3개 이상은 어느 둘인지 단정 불가).
 * - OUT 다리: 유효 분류 EXCHANGE + 방향 OUT.
 * - IN 다리: 방향 IN + 유효 분류 RECEIVE/EXCHANGE + 소득 아님(income_kind null — 수령분은 스왑이 아니다).
 * - **어느 다리든 확인이 필요하면(needsReview) 묶지 않는다** — 문제 있는 이벤트를 페어 안에 숨기면
 *   확인 필요 큐와 목록이 다른 말을 한다.
 */
export function pairSwapLegs(events: NormalizedEvent[]): SwapPairing {
  const byTx = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const group = byTx.get(event.tx_hash);
    if (group) group.push(event);
    else byTx.set(event.tx_hash, [event]);
  }

  const inLegByOutId = new Map<string, NormalizedEvent>();
  const pairedInIds = new Set<string>();
  for (const group of byTx.values()) {
    if (group.length !== 2) continue;
    const out = group.find(
      (event) => event.direction === "OUT" && effectiveClassification(event) === "EXCHANGE",
    );
    const received = group.find(
      (event) =>
        event.direction === "IN" &&
        event.income_kind === null &&
        ["RECEIVE", "EXCHANGE"].includes(effectiveClassification(event)),
    );
    if (!out || !received || out.id === received.id) continue;
    if (needsReview(out) || needsReview(received)) continue;
    inLegByOutId.set(out.id, received);
    pairedInIds.add(received.id);
  }
  return { inLegByOutId, pairedInIds };
}
