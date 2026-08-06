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
  // 새 칸은 끝에 붙인다. 중간에 끼우면 열 위치로 읽는 소비자가 조용히 다른 값을 읽는다.
  "asset_symbol",
  "asset_verified",
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
    // 심볼을 모르면 빈 칸이다. "UNKNOWN" 같은 글자를 넣으면 그런 이름의 토큰과 구분되지 않는다.
    asset_symbol: event.asset_symbol ?? "",
    asset_verified: event.asset_verified ? "true" : "false",
  };
}
