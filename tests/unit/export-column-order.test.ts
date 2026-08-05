import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, eventToRow } from "@/lib/export/schema";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

describe("export columns", () => {
  it("uses the complete fixed normalized-event field order", () => {
    expect(EXPORT_COLUMNS).toEqual(["id", "tx_hash", "chain_id", "log_index", "block_timestamp", "wallet_address", "direction", "asset_type", "asset_contract", "token_id", "decimals", "raw_amount", "counterparty", "gas_fee_native", "classification", "confidence", "user_override", "price_status", "fiat_value", "fiat_currency"]);
    expect(Object.keys(eventToRow(createNormalizedEventFixtures()[0]))).toEqual(EXPORT_COLUMNS);
  });
});
