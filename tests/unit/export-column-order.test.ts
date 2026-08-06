import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, eventToRow } from "@/lib/export/schema";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

describe("export columns", () => {
  it("uses the complete fixed normalized-event field order", () => {
    // 새 칸은 끝에 붙는다. 순서가 바뀌면 열 위치로 읽는 소비자가 조용히 다른 값을 읽는다.
    expect(EXPORT_COLUMNS).toEqual(["id", "tx_hash", "chain_id", "log_index", "block_timestamp", "wallet_address", "direction", "asset_type", "asset_contract", "token_id", "decimals", "raw_amount", "counterparty", "gas_fee_native", "classification", "confidence", "user_override", "price_status", "fiat_value", "fiat_currency", "asset_symbol", "asset_verified"]);
    expect(Object.keys(eventToRow(createNormalizedEventFixtures()[0]))).toEqual(EXPORT_COLUMNS);
  });
});
