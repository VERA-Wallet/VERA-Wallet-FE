import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";

const chains = [1, 8453, 42161, 10, 137] as const;
const classifications: Classification[] = ["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"];

export function createNormalizedEventFixtures(): NormalizedEvent[] {
  return Array.from({ length: 25 }, (_, index) => {
    const eventNumber = index + 1;
    const classification = classifications[index % classifications.length];
    const unknownPrice = [3, 9, 17].includes(index);
    const lowConfidence = [3, 9, 20].includes(index);
    const override = index === 6;

    return {
      id: `event-${String(eventNumber).padStart(2, "0")}`,
      tx_hash: `0x${eventNumber.toString(16).padStart(64, "0")}`,
      chain_id: chains[index % chains.length],
      log_index: index,
      block_timestamp: new Date(Date.UTC(2025, 0, 1 + index, 12, 0, 0)).toISOString(),
      wallet_address: "0x1111111111111111111111111111111111111111",
      direction: index % 2 === 0 ? "IN" : "OUT",
      asset_type: index % 4 === 0 ? "NATIVE" : index % 4 === 1 ? "ERC20" : index % 4 === 2 ? "ERC721" : "ERC1155",
      asset_contract: index % 4 === 0 ? null : `0x${(1000 + index).toString(16).padStart(40, "0")}`,
      token_id: index % 4 >= 2 ? String(index + 100) : null,
      decimals: index % 4 >= 2 ? 0 : 18,
      // decimals와 정합하는 원시 단위 — 18 decimals 자산은 0.01·n, NFT(0 decimals)는 수량 자체다.
      raw_amount: index % 4 >= 2 ? String((index % 3) + 1) : `${eventNumber}${"0".repeat(16)}`,
      counterparty: `0x${(2000 + index).toString(16).padStart(40, "0")}`,
      gas_fee_native: "0.001",
      classification,
      confidence: lowConfidence ? 0.3 : 0.9,
      user_override: override
        ? { classification: "SEND", reason: "Verified transfer purpose", overridden_at: "2025-01-07T13:00:00.000Z" }
        : null,
      price_status: unknownPrice ? "UNKNOWN" : index % 3 === 0 ? "ESTIMATED" : "RESOLVED",
      fiat_value: unknownPrice ? null : `${eventNumber * 1000}.00`,
      fiat_currency: "KRW",
    };
  });
}
