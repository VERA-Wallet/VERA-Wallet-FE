import type { NormalizedEvent } from "@/lib/schema/normalized-event";

export const EXPORT_COLUMNS = [
  "id",
  "tx_hash",
  "chain_id",
  "log_index",
  "block_timestamp",
  "wallet_address",
  "direction",
  "asset_type",
  "asset_contract",
  "token_id",
  "decimals",
  "raw_amount",
  "counterparty",
  "gas_fee_native",
  "classification",
  "confidence",
  "user_override",
  "price_status",
  "fiat_value",
  "fiat_currency",
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportRow = Record<ExportColumn, string | number>;

export function eventToRow(event: NormalizedEvent): ExportRow {
  return {
    id: event.id,
    tx_hash: event.tx_hash,
    chain_id: event.chain_id,
    log_index: event.log_index,
    block_timestamp: event.block_timestamp,
    wallet_address: event.wallet_address,
    direction: event.direction,
    asset_type: event.asset_type,
    asset_contract: event.asset_contract ?? "",
    token_id: event.token_id ?? "",
    decimals: event.decimals,
    raw_amount: event.raw_amount,
    counterparty: event.counterparty,
    gas_fee_native: event.gas_fee_native,
    classification: event.classification,
    confidence: event.confidence,
    user_override: event.user_override === null ? "" : JSON.stringify(event.user_override),
    price_status: event.price_status,
    fiat_value: event.price_status === "UNKNOWN" ? "" : event.fiat_value ?? "",
    fiat_currency: event.fiat_currency,
  };
}
