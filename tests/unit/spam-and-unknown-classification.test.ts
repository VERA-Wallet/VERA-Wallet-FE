import { describe, expect, it } from "vitest";

import { beEventListSchema } from "@/lib/schema/be-event-transport";
import { classificationSchema, normalizedEventSchema } from "@/lib/schema/normalized-event";
import { reclassifyRequestSchema } from "@/lib/http/dto";
import { isSpam, needsReview, taxExclusionReason } from "@/lib/review";

/**
 * 스팸 계약과 알 수 없는 분류에 대한 복원력.
 *
 * 서버가 `SPAM`을 내보내기 시작했을 때 FE enum에 그 값이 없어 **목록 전체가 파싱에 실패했다** —
 * 거래를 한 건도 못 보는 상태가 됐다. 이 파일이 고정하는 것은 두 가지다:
 * 계약에 SPAM이 있다는 것, 그리고 **모르는 분류가 와도 원장을 통째로 잃지 않는다**는 것.
 */
const baseEvent = {
  id: "event-01",
  tx_hash: "0xabc",
  chain_id: 1,
  log_index: 0,
  block_timestamp: "2026-01-02T03:04:05.000Z",
  wallet_address: "0x1111111111111111111111111111111111111111",
  direction: "IN" as const,
  asset_type: "ERC20" as const,
  asset_contract: "0x2222222222222222222222222222222222222222",
  asset_symbol: "USDC",
  asset_verified: true,
  asset_icon_url: null,
  token_id: null,
  decimals: 6,
  raw_amount: "1000000",
  counterparty: "0x3333333333333333333333333333333333333333",
  gas_fee_native: "0.0004",
  classification: "RECEIVE",
  confidence: 0.95,
  user_override: null,
  value_override: null,
  price_status: "RESOLVED" as const,
  fiat_value: "1400.00",
  fiat_currency: "KRW",
  income_kind: null,
  swap_to_symbol: null,
  swap_to_icon_url: null,
  bridge_dest_chain_id: null,
};

const envelopeItem = (overrides: Record<string, unknown>) => ({
  event: { ...baseEvent, ...overrides },
  version: 1,
});

describe("SPAM 계약", () => {
  it("분류 enum이 SPAM을 받는다", () => {
    expect(classificationSchema.safeParse("SPAM").success).toBe(true);
  });

  it("스팸 이벤트가 파싱되고 isSpam으로 식별된다", () => {
    const parsed = normalizedEventSchema.parse({ ...baseEvent, classification: "SPAM" });
    expect(parsed.classification).toBe("SPAM");
    expect(isSpam(parsed)).toBe(true);
  });

  it("사용자가 되돌리면 더 이상 스팸이 아니다", () => {
    const parsed = normalizedEventSchema.parse({
      ...baseEvent,
      classification: "SPAM",
      user_override: { classification: "RECEIVE", reason: "오탐", overridden_at: "2026-01-03T00:00:00.000Z" },
    });
    // 유효 분류를 보므로 오탐을 되돌린 순간 원장으로 돌아온다.
    expect(isSpam(parsed)).toBe(false);
  });

  // 스팸은 원장에 들어오기 전(질의 경계)에서 걸러낸다. 여기 술어에 스팸 갈래를 두면
  // "계산 제외 ⊆ 확인 필요" 불변식이 깨지거나 확인 필요 큐가 스팸으로 덮인다.
  it("review 술어는 스팸을 특별 취급하지 않는다", () => {
    const parsed = normalizedEventSchema.parse({ ...baseEvent, classification: "SPAM" });
    expect(taxExclusionReason(parsed)).toBeNull();
    expect(needsReview(parsed)).toBe(false);
  });
});

describe("알 수 없는 분류에 대한 복원력", () => {
  it("모르는 분류는 UNKNOWN으로 강등된다", () => {
    const parsed = normalizedEventSchema.parse({ ...baseEvent, classification: "BRIDGE_HOP" });
    expect(parsed.classification).toBe("UNKNOWN");
    // UNKNOWN은 계산에서 빠지고 확인 필요로 뜬다 — 모른다고 읽고 화면이 그렇게 말한다.
    expect(taxExclusionReason(parsed)).toBe("분류 확인 필요");
  });

  it("송신 요청은 강등하지 않고 거절한다", () => {
    // 나가는 값까지 강등하면 사용자가 고른 적 없는 분류를 서버에 저장하게 된다.
    expect(reclassifyRequestSchema.safeParse({ classification: "BRIDGE_HOP", expectedVersion: 1 }).success).toBe(false);
  });

  it("항목 하나가 계약을 벗어나도 나머지 목록은 살아남고 버린 수를 고지한다", () => {
    const parsed = beEventListSchema.parse({
      items: [
        envelopeItem({ id: "ok-1" }),
        // decimals가 문자열이라 어떤 강등으로도 살릴 수 없는 항목.
        envelopeItem({ id: "broken", decimals: "여섯" }),
        envelopeItem({ id: "ok-2", classification: "SPAM" }),
      ],
      nextCursor: null,
    });

    expect(parsed.items.map((item) => item.event.id)).toEqual(["ok-1", "ok-2"]);
    expect(parsed.dropped).toBe(1);
  });

  it("모르는 분류만 든 목록은 한 건도 버리지 않는다", () => {
    const parsed = beEventListSchema.parse({
      items: [envelopeItem({ id: "future", classification: "DUST" })],
      nextCursor: null,
    });

    expect(parsed.dropped).toBe(0);
    expect(parsed.items[0].event.classification).toBe("UNKNOWN");
  });
});
