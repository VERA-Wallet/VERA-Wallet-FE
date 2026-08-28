import { effectiveClassification, isLowConfidence } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 스왑 두 다리 페어링 — 같은 **group_id**(서버 발급 페어링 키)를 공유하는 **처분(EXCHANGE·OUT) + 취득(IN)** 한 쌍을 찾는다.
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
 * 페어링 규칙 — 서버가 확정한 group_id로 묶는다(BE가 하나의 스왑으로 인정한 leg에만 이 키를 찍는다):
 * - 같은 group_id 그룹에서만 본다 — tx_hash·leg 개수(정확히 2건) 휴리스틱을 대체한다.
 *   멀티홉/수수료로 leg가 몇 개든 서버가 한 그룹으로 표시하면 그 안에서 대표 OUT·IN을 고른다.
 * - OUT 다리: 유효 분류 EXCHANGE + 방향 OUT.
 * - IN 다리: 방향 IN + 유효 분류 RECEIVE/EXCHANGE + 소득 아님(income_kind null — 수령분은 스왑이 아니다).
 * - **신뢰도가 확인 필요 바닥(0.5) 미만인 다리(브릿지 의심 0.4 등)는 묶지 않는다** — 브릿지 안전장치.
 *   가격 미확정(price_status UNKNOWN·fiat_value null)은 페어링을 막지 않는다: 병합은 표시,
 *   가격은 세무의 몫이며, 미확정은 병합된 행 위 needsReview 배지로 계속 고지된다.
 */
export function pairSwapLegs(events: NormalizedEvent[]): SwapPairing {
  const byGroup = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    // group_id가 없는 leg는 서버가 페어링 대상으로 인정하지 않은 것 — 단독 행으로 둔다.
    if (!event.group_id) continue;
    const group = byGroup.get(event.group_id);
    if (group) group.push(event);
    else byGroup.set(event.group_id, [event]);
  }

  const inLegByOutId = new Map<string, NormalizedEvent>();
  const pairedInIds = new Set<string>();
  for (const group of byGroup.values()) {
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
    if (isLowConfidence(out) || isLowConfidence(received)) continue;
    inLegByOutId.set(out.id, received);
    pairedInIds.add(received.id);
  }
  return { inLegByOutId, pairedInIds };
}
