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

/**
 * 브릿지 두 다리 페어링 — 같은 **bridge_group_id**(서버 발급 페어링 키)를 공유하는 **출발(OUT)+도착(IN)**
 * 한 쌍을 찾는다.
 *
 * 브릿지에는 두 모양이 있다:
 * - **같은 자산 이동**: 양 다리 모두 INTERNAL_TRANSFER(비과세 자기이동)라 세무 파생에는 영향이 없다.
 *   목록은 출발 leg를 대표로 그리고(도착 체인은 이미 `bridge_dest_chain_id`로 그 행에 실려 있다)
 *   도착 leg는 별도 행으로 렌더하지 않는다.
 * - **자산이 바뀌는 브릿지**(예: Mayan — Polygon USDT → Ethereum USDC): BE가 출발 다리를 EXCHANGE·
 *   도착 다리를 RECEIVE로 매긴다. 세무상 스왑(`pairSwapLegs`)과 동일한 처분+취득이고 표시도
 *   스왑과 같은 방식(한 행에 "−보낸 수량 → +받은 수량")을 따른다 — 다만 서버가 `group_id`가 아니라
 *   `bridge_group_id`로 연결한다(두 다리가 체인도 tx_hash도 다르기 때문. `pairSwapLegs`는 관여하지
 *   않는다 — 같은 체인 스왑과 혼동하지 않도록 이 함수가 별도로 본다).
 *
 * 어느 모양이든 **표시**만 한 행으로 묶는다(엔진 무변경, 계산은 그대로 두 건).
 */
export type BridgePairing = {
  /** OUT(출발) 다리 id → IN(도착) 다리 이벤트. 목록·상세가 도착 사실을 그릴 때 쓴다. */
  inLegByOutId: Map<string, NormalizedEvent>;
  /** 목록에서 별도 행으로 렌더하지 않을 IN 다리 id. */
  pairedInIds: Set<string>;
};

/**
 * 페어링 규칙 — 서버가 확정한 bridge_group_id로 묶는다:
 * - 같은 bridge_group_id 그룹에서만 본다.
 * - **그룹 안에서 한 쌍(OUT 1개·IN 1개)이 정확히 성립할 때만** 묶는다 — 스왑처럼 tx_hash 휴리스틱이
 *   없고 멀티홉 브릿지도 있을 수 있어, 어느 쪽이 짝인지 애매하면(0개·2개 이상) 보수적으로 각 행을
 *   그대로 둔다(스왑 페어링과 같은 태도). 같은 자산 이동(INTERNAL_TRANSFER 1:1)이 먼저 성립하면
 *   그쪽을 쓰고, 아니면 자산이 바뀌는 브릿지(EXCHANGE 1개 + RECEIVE 1개)를 본다 — 한 그룹이 둘 다
 *   동시에 1:1로 성립하는 경우는 서버가 같은 이동을 두 분류로 겹쳐 찍을 때뿐이라 사실상 없다.
 * - 같은 자산 이동: OUT 다리 방향 OUT + 유효 분류 INTERNAL_TRANSFER, IN 다리 방향 IN + 유효 분류
 *   INTERNAL_TRANSFER. 유효 분류를 보므로 사용자가 재분류로 INTERNAL_TRANSFER를 벗어난 다리는
 *   묶지 않는다 — 재분류는 "이건 자기이동이 아니다"라는 의도적 판단이라 페어링을 유지하면 그
 *   판단이 화면에서 사라진다.
 * - 자산이 바뀌는 브릿지: OUT 다리 방향 OUT + 유효 분류 EXCHANGE, IN 다리 방향 IN + 유효 분류
 *   RECEIVE + 소득 아님(income_kind null — 수령분은 스왑이 아니다). 스왑 페어링과 같은 유효 분류
 *   규칙이라, 사용자가 한쪽을 재분류해 이 모양을 벗어나면 마찬가지로 묶지 않는다.
 * - 신뢰도가 확인 필요 바닥(0.5) 미만인 다리는 묶지 않는다 — 스왑과 같은 안전장치.
 */
export function pairBridgeLegs(events: NormalizedEvent[]): BridgePairing {
  const byGroup = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    // bridge_group_id가 없는 leg는 서버가 페어링 대상으로 인정하지 않은 것 — 단독 행으로 둔다.
    // (같은 체인 스왑은 group_id만 갖고 bridge_group_id는 null이라 애초에 이 그룹에 들어오지 않는다.)
    if (!event.bridge_group_id) continue;
    const group = byGroup.get(event.bridge_group_id);
    if (group) group.push(event);
    else byGroup.set(event.bridge_group_id, [event]);
  }

  const inLegByOutId = new Map<string, NormalizedEvent>();
  const pairedInIds = new Set<string>();
  for (const group of byGroup.values()) {
    const internalOuts = group.filter(
      (event) => event.direction === "OUT" && effectiveClassification(event) === "INTERNAL_TRANSFER",
    );
    const internalIns = group.filter(
      (event) => event.direction === "IN" && effectiveClassification(event) === "INTERNAL_TRANSFER",
    );
    const exchangeOuts = group.filter(
      (event) => event.direction === "OUT" && effectiveClassification(event) === "EXCHANGE",
    );
    const receiveIns = group.filter(
      (event) =>
        event.direction === "IN" && event.income_kind === null && effectiveClassification(event) === "RECEIVE",
    );

    let out: NormalizedEvent | undefined;
    let received: NormalizedEvent | undefined;
    if (internalOuts.length === 1 && internalIns.length === 1) {
      out = internalOuts[0];
      received = internalIns[0];
    } else if (exchangeOuts.length === 1 && receiveIns.length === 1) {
      out = exchangeOuts[0];
      received = receiveIns[0];
    } else {
      // 정확히 1:1인 모양이 하나도 성립하지 않으면(0개 또는 다건) 어느 쪽이 짝인지 서버 키만으로
      // 단정할 수 없어 그대로 둔다.
      continue;
    }
    if (out.id === received.id) continue;
    if (isLowConfidence(out) || isLowConfidence(received)) continue;
    inLegByOutId.set(out.id, received);
    pairedInIds.add(received.id);
  }
  return { inLegByOutId, pairedInIds };
}
