import "server-only";

import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import type { EventDetailDTO, EventListDTO, OverrideTransition, ReclassifyRequestDTO, SummaryDTO } from "@/lib/http/dto";
import type { ReclassifyResult } from "@/lib/ports/event-repository";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { effectiveClassification, needsReview, taxExclusionReason } from "@/lib/review";

type StoredEvent = { event: NormalizedEvent; version: number; transitions: OverrideTransition[] };

function addDecimals(values: string[]): string {
  const parsed = values.map((value) => {
    const sign = value.startsWith("-") ? BigInt(-1) : BigInt(1);
    const unsigned = value.replace(/^-/, "");
    const [whole, fraction = ""] = unsigned.split(".");
    return { sign, whole, fraction };
  });
  const scale = Math.max(0, ...parsed.map(({ fraction }) => fraction.length));
  const total = parsed.reduce((sum, { sign, whole, fraction }) => {
    const magnitude = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
    return sum + sign * magnitude;
  }, BigInt(0));
  const sign = total < BigInt(0) ? "-" : "";
  const digits = (total < BigInt(0) ? -total : total).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  const result = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return `${sign}${result}`;
}

export class MockEventStore {
  private readonly events = new Map<string, StoredEvent>();

  constructor(fixtures = createNormalizedEventFixtures()) {
    for (const event of fixtures) this.events.set(event.id, { event, version: 1, transitions: [] });
  }

  list(input: { cursor?: string; limit?: number } = {}): EventListDTO {
    const all = [...this.events.values()].map(({ event, version }) => ({ event, version }));
    const start = input.cursor ? all.findIndex(({ event }) => event.id === input.cursor) + 1 : 0;
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const items = all.slice(Math.max(0, start), Math.max(0, start) + limit);
    return { items, nextCursor: start + limit < all.length && items.length ? items.at(-1)!.event.id : null };
  }

  getById(id: string): EventDetailDTO | null {
    const stored = this.events.get(id);
    return stored ? { event: stored.event, version: stored.version, override_history: [...stored.transitions] } : null;
  }

  reclassify(id: string, input: ReclassifyRequestDTO): ReclassifyResult {
    const stored = this.events.get(id);
    if (!stored) return { status: "not_found", event: null, version: null };
    if (stored.version !== input.expectedVersion) return { status: "conflict", event: stored.event, version: stored.version };
    const event: NormalizedEvent = {
      ...stored.event,
      classification: input.classification,
      user_override: {
        classification: input.classification,
        reason: input.reason ?? null,
        overridden_at: new Date().toISOString(),
      },
    };
    stored.transitions.push({
      from: effectiveClassification(stored.event),
      to: input.classification,
      reason: input.reason ?? null,
      overridden_at: event.user_override!.overridden_at,
    });
    stored.event = event;
    stored.version += 1;
    return { status: "ok", event, version: stored.version };
  }

  summary(input: { from?: string; to?: string } = {}): SummaryDTO {
    const all = [...this.events.values()].map(({ event }) => event);
    // stage-05 Change 6-ii: 명시적 기간은 [from, to). 기본값(미지정)은 전체 이벤트를 포함한다.
    // RFC 3339 offset 문자열은 사전식 순서가 시간 순서와 다르므로 epoch ms로 정규화해 비교한다.
    const fromMs = input.from === undefined ? undefined : Date.parse(input.from);
    const toMs = input.to === undefined ? undefined : Date.parse(input.to);
    const events = all.filter((event) => {
      const at = Date.parse(event.block_timestamp);
      return (fromMs === undefined || at >= fromMs) && (toMs === undefined || at < toMs);
    });
    // 계산 가능 여부는 lib/review.ts 하나로 판정한다. 과세 대상 건수는 그 위에 분류 조건을 더한다.
    // 자기 지갑 간 이체는 처분이 아니므로 실현손익에도 넣지 않는다(세무 파생과 같은 판단).
    const priced = events.filter(
      (event) => taxExclusionReason(event) === null && effectiveClassification(event) !== "INTERNAL_TRANSFER",
    );
    // 통화 불변식은 기간 내 전체 이벤트(UNKNOWN 포함)에 적용해 잘못된 통화 라벨을 원천 차단한다.
    const currencies = new Set(events.map((event) => event.fiat_currency));
    if (currencies.size > 1) {
      throw new Error(`summary requires a single fiat currency; found: ${[...currencies].join(", ")}`);
    }
    return {
      // 실현손익 관례(stage-05 Change 6-iv): 처분(OUT)은 양수 수취, 취득(IN)은 원가 차감.
      periodPnl: addDecimals(priced.map((event) => `${event.direction === "IN" ? "-" : ""}${event.fiat_value}`)),
      computableEventCount: priced.length,
      // 확인 필요·과세 대상 판정은 lib/review.ts 하나만 쓴다.
      // 서버 요약이 자체 술어를 쓰면 카드 숫자와 확인 필요 탭·세금 계산이 서로 다른 말을 한다.
      // priced는 이미 taxExclusionReason이 null인 집합이다. 여기서는 분류만 본다.
      taxableEventCount: priced.filter((event) =>
        ["RECEIVE", "SEND", "EXCHANGE"].includes(effectiveClassification(event)),
      ).length,
      pendingReviewCount: events.filter(needsReview).length,
      currency: events[0]?.fiat_currency ?? all[0]?.fiat_currency ?? "KRW",
      period: {
        from: input.from ?? all[0]?.block_timestamp ?? "",
        to: input.to ?? all.at(-1)?.block_timestamp ?? "",
      },
    };
  }
}
