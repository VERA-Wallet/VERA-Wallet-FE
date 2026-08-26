import { describe, expect, it } from "vitest";

import { normalizedEventSchema } from "@/lib/schema/normalized-event";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { IncomeKind } from "@/lib/tax/types";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeTaxEstimate } from "@/lib/tax/engine";

/** RECEIVE·방향 IN·원화 평가액이 있는 수령 이벤트 하나. income_kind만 케이스마다 바꾼다. */
function receive(id: string, incomeKind: IncomeKind | null, fiat: string): NormalizedEvent {
  return {
    id,
    tx_hash: `0x${id}`,
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2027-09-01T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "IN",
    asset_type: "ERC20",
    asset_contract: "0x000000000000000000000000000000000000dEaD",
    asset_symbol: "stETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "40000000000000000",
    counterparty: "Lido: stETH staking rewards",
    gas_fee_native: "0.001",
    classification: "RECEIVE",
    confidence: 0.9,
    user_override: null,
    value_override: null,
    price_status: "RESOLVED",
    fiat_value: fiat,
    fiat_currency: "KRW",
    income_kind: incomeKind,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
  };
}

describe("스키마 income_kind 하위호환", () => {
  it("옛 응답(income_kind 없음)도 파싱되고 null로 채워진다", () => {
    const withoutField: Record<string, unknown> = { ...receive("legacy", null, "1000000") };
    delete withoutField.income_kind;
    const parsed = normalizedEventSchema.parse(withoutField);
    expect(parsed.income_kind).toBeNull();
  });

  it("income_kind가 실린 응답은 그대로 파싱된다", () => {
    const parsed = normalizedEventSchema.parse(receive("staked", "STAKING", "1000000"));
    expect(parsed.income_kind).toBe("STAKING");
  });

  it("income_kind는 방향 IN에서만 붙는다 — OUT이면 결함으로 잡는다", () => {
    const result = normalizedEventSchema.safeParse({ ...receive("bad", "STAKING", "1000000"), direction: "OUT" });
    expect(result.success).toBe(false);
  });
});

describe("derive income_kind → INCOME 매핑", () => {
  it("income_kind가 있으면 ACQUIRE 대신 INCOME으로 파생한다(incomeKind·fmv)", () => {
    const derived = deriveTaxEvents([receive("inc", "DEFI_REWARD", "1250000")]).events;
    expect(derived).toHaveLength(1);
    const event = derived[0];
    expect(event.kind).toBe("INCOME");
    if (event.kind !== "INCOME") throw new Error("expected INCOME");
    expect(event.incomeKind).toBe("DEFI_REWARD");
    // fmv = 원화 평가액(override가 없으면 fiat_value).
    expect(event.fmv).toBe("1250000");
  });

  it("income_kind가 없으면 종래대로 ACQUIRE다", () => {
    const derived = deriveTaxEvents([receive("buy", null, "1250000")]).events;
    expect(derived[0].kind).toBe("ACQUIRE");
  });
});

describe("KR — DeFi 수익 종류별 판정", () => {
  // 대여 이자만 과세 income(대여 대가), 스테이킹·디파이 보상은 명문 규정이 없어 판정 보류.
  const events = deriveTaxEvents([
    receive("kr-lend", "LENDING", "3000000"),
    receive("kr-stake", "STAKING", "1000000"),
    receive("kr-defi", "DEFI_REWARD", "2000000"),
  ]).events;
  const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events });
  const groupOf = (eventId: string) => estimate.judgments.find((row) => row.eventId === eventId)?.group;

  it("대여 이자는 과세 income으로 총수입금액에 든다", () => {
    expect(groupOf("kr-lend")).toBe("income");
    expect(estimate.totals.incomeTotal).toBe("3000000");
  });

  it("스테이킹·디파이 보상은 판정 보류로 총수입금액에서 빠진다", () => {
    expect(groupOf("kr-stake")).toBe("pending");
    expect(groupOf("kr-defi")).toBe("pending");
    // 보류분 FMV 합(1,000,000 + 2,000,000)이 계산 제외로 별도 표기된다.
    expect(estimate.lines.find((line) => line.key === "pending_income")?.amount).toBe("3000000");
  });
});
