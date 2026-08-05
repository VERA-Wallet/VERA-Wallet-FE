import { ZERO } from "@/lib/tax/decimal";
import { effectiveClassification, eventQuantity, taxExclusionReason } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEvent } from "@/lib/tax/types";
import { EXCLUSION_SUFFIX, LIMITATION_MESSAGE, limitationOf, toLimitations } from "@/lib/tax/limitations";
import type { Limitation } from "@/lib/tax/types";

export type DerivedTaxEvents = {
  events: TaxEvent[];
  /** 계산에 넣을 수 없어 제외한 이벤트. `lib/review.ts`의 확인 필요 집합의 부분집합이다. */
  excludedEventIds: string[];
  /** 파생 과정에서 사용한 가정. 결과와 함께 노출해야 근거가 추적된다. */
  assumptions: string[];
  /** 위 문구를 종류로 분류한 것. 화면이 산문을 정규식으로 뜯지 않게 한다. */
  limitations: Limitation[];
};

function assetKey(event: NormalizedEvent): string {
  return `${event.chain_id}:${event.asset_contract ?? "native"}${event.token_id ? `:${event.token_id}` : ""}`;
}

function symbolOf(event: NormalizedEvent): string {
  return event.asset_contract ? `${event.asset_type}:${event.asset_contract.slice(0, 10)}` : `CHAIN-${event.chain_id}`;
}

/**
 * 정규화 이벤트를 세무 이벤트로 변환한다.
 * 분류 신뢰도·가격 확정 여부가 계산 가능성의 전제이므로, 판단이 필요한 건은 계산에서 빼고 명시한다.
 */
export function deriveTaxEvents(events: NormalizedEvent[]): DerivedTaxEvents {
  const derived: TaxEvent[] = [];
  // 같은 id가 여러 번 들어와도 제외 목록은 이벤트 집합이어야 한다.
  const excludedEventIds = new Set<string>();
  const assumptions = new Set<string>();
  // 제외는 사유별로 어느 거래인지까지 말해야 한다. 사유만 말하면 사용자가 찾아갈 수 없다.
  const excludedByReason = new Map<string, string[]>();
  const seenEventIds = new Set<string>();

  for (const event of events) {
    if (seenEventIds.has(event.id)) {
      // 첫 건이 이미 계산에 들어갔다면 그 id는 "제외"가 아니다.
      // 같은 id를 judgments와 excludedEventIds 양쪽에 내보내면 계약이 깨진다.
      assumptions.add(LIMITATION_MESSAGE.DUPLICATE_ID);
      continue;
    }
    seenEventIds.add(event.id);

    const classification = effectiveClassification(event);
    if (classification === "INTERNAL_TRANSFER") {
      assumptions.add(LIMITATION_MESSAGE.INTERNAL_TRANSFER);
      continue;
    }

    // 제외 판정은 lib/review.ts 하나만 쓴다 — 대시보드 "확인 필요"와 갈리면 화면이 모순된다.
    const exclusion = taxExclusionReason(event);
    if (exclusion) {
      excludedEventIds.add(event.id);
      assumptions.add(`${exclusion}${EXCLUSION_SUFFIX}`);
      excludedByReason.set(exclusion, [...(excludedByReason.get(exclusion) ?? []), event.id]);
      continue;
    }
    // 여기까지 왔으면 taxExclusionReason이 가격 확정을 보증한다(review.ts가 유일한 판정).
    const fiatValue = event.fiat_value;
    if (fiatValue === null) throw new Error(`제외 판정과 가격 상태가 어긋났습니다: ${event.id}`);
    const quantity = eventQuantity(event);
    const base = {
      id: event.id,
      at: event.block_timestamp,
      wallet: event.wallet_address,
      asset: assetKey(event),
      symbol: symbolOf(event),
      quantity,
    };

    if (event.price_status === "ESTIMATED") {
      assumptions.add(LIMITATION_MESSAGE.ESTIMATED_PRICE);
    }
    // 가스비는 네이티브 수량이라 법정통화 환산 없이는 원가에 넣을 수 없다.
    assumptions.add(LIMITATION_MESSAGE.GAS_FEE);

    // 분류가 방향을 이긴다. direction은 체인에서 유도한 메타데이터고,
    // classification은 사용자가 확정할 수 있는 의미 판단이다.
    // 여기까지 온 분류는 RECEIVE/SEND/EXCHANGE뿐이라(UNKNOWN·INTERNAL_TRANSFER는 위에서 걸러짐)
    // direction 폴백이 필요 없다. 폴백을 두면 "송금"으로 확정한 거래에 "취득" 도장이 찍힌다.
    if (classification === "RECEIVE") {
      derived.push({ kind: "ACQUIRE", ...base, cost: fiatValue, fee: ZERO });
      continue;
    }
    if (classification === "EXCHANGE") {
      // 교환 상대 자산 메타데이터가 없어 피아트 처분으로 근사한다(비과세 교환 국가에서는 과대계상 가능).
      assumptions.add(LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION);
      derived.push({ kind: "DISPOSE", ...base, proceeds: fiatValue, fee: ZERO, trigger: "FIAT" });
      continue;
    }
    derived.push({ kind: "DISPOSE", ...base, proceeds: fiatValue, fee: ZERO, trigger: "FIAT" });
  }

  return {
    events: derived,
    excludedEventIds: [...excludedEventIds],
    assumptions: [...assumptions],
    limitations: [
      ...[...excludedByReason].map(([reason, ids]) => limitationOf(`${reason}${EXCLUSION_SUFFIX}`, ids)),
      // 제외는 위에서 id까지 붙여 냈으므로 여기서 다시 내지 않는다.
      ...toLimitations([...assumptions].filter((message) => !message.endsWith(EXCLUSION_SUFFIX))),
    ],
  };
}
