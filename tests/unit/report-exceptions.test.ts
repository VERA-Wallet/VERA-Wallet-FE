import { describe, expect, it } from "vitest";
import { buildExceptions } from "@/lib/export/report";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { Limitation, OpenQuestion, TaxEstimate } from "@/lib/tax/types";

function event(id: string, fiat: string | null): NormalizedEvent {
  return {
    id,
    tx_hash: "0xabc",
    chain_id: 1,
    log_index: 0,
    block_timestamp: "2027-06-01T00:00:00.000Z",
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: "OUT",
    asset_type: "NATIVE",
    asset_contract: null,
    asset_symbol: "ETH",
    asset_verified: true,
    asset_icon_url: null,
    token_id: null,
    decimals: 18,
    raw_amount: "1000000000000000000",
    counterparty: "0xcounter",
    gas_fee_native: "0.001",
    classification: "SEND",
    confidence: 0.9,
    user_override: null,
    value_override: null,
    price_status: fiat === null ? "UNKNOWN" : "RESOLVED",
    fiat_value: fiat,
    fiat_currency: "KRW",
    income_kind: null,
  };
}

function estimateWith(limitations: Limitation[], openQuestions: OpenQuestion[], excludedEventIds: string[]): TaxEstimate {
  return {
    country: "KR",
    countryLabel: "한국",
    currency: "KRW",
    taxYear: 2027,
    method: "거주자별 총평균법",
    status: "PARTIAL",
    lines: [],
    totals: { taxableGains: "0", exemptGains: "0", incomeTotal: "0", taxableBase: "0", estimatedCharge: "0", effectiveRatePercent: "0" },
    lossCarryforward: "0",
    notes: [],
    limitations,
    openQuestions,
    requiredInputs: [],
    excludedEventIds,
    provenance: "mock",
    period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
    judgments: [],
  };
}

describe("P2-D 예외·판단보류 목록", () => {
  const events = [event("e1", "400000"), event("e2", null), event("e3", "800000")];
  const estimate = estimateWith(
    [{ kind: "zero_basis", message: "원장에 없는 수량을 취득가액 0으로 계산했습니다.", eventIds: ["e1"] }],
    [{ topic: "STAKING", status: "UNDETERMINED", reason: "스테이킹 수령분 규정 부재", affectedEventIds: ["e2"] }],
    ["e3"],
  );
  const rows = buildExceptions(events, estimate);

  it("한계·판단보류·제외를 각각 한 줄로 모은다", () => {
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => String(row.내용).includes("취득가액 0"))?.구분).toBe("취득가액 0원");
    expect(rows.find((row) => String(row.구분).includes("판단보류"))?.구분).toContain("스테이킹");
    expect(rows.find((row) => row.관련이벤트 === "e3")?.구분).toBe("계산 제외");
  });

  it("금액 영향을 관련 이벤트 원화 가액 합으로 싣되, 가격 미확인이면 '-'로 정직하게 둔다", () => {
    expect(rows.find((row) => row.관련이벤트 === "e1")?.금액영향_원).toBe(400000);
    // e2는 가격 미확인(UNKNOWN)이라 금액을 세울 수 없다.
    expect(rows.find((row) => row.관련이벤트 === "e2")?.금액영향_원).toBe("-");
    expect(rows.find((row) => row.관련이벤트 === "e3")?.금액영향_원).toBe(800000);
  });

  it("estimate가 없으면 예외 목록도 없다", () => {
    expect(buildExceptions(events, null)).toEqual([]);
  });
});
