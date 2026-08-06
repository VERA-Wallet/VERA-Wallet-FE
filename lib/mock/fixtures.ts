import { demoTaxYear } from "@/lib/mock/demo-calendar";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";

const chains = [1, 8453, 42161, 10, 137] as const;
const classifications: Classification[] = ["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"];

/** 25건을 7일 간격으로 놓으면 7/1 + 168일 = 12/16 — 공통 창(7/1~12/31) 안에 전부 들어간다. */
const EVENT_SPACING_DAYS = 7;

/** 이벤트 번호 1건당 원화 금액. 25건이 ₩40만~₩1,000만 사이에 퍼진다. */
const PER_EVENT_KRW = 400_000;

/**
 * 체인·자산 타입별 심볼. 데모 픽스처는 **토큰 목록으로 검증된 자산만** 담는다는 가정이다.
 * 실제 지갑에는 심볼을 모르는 토큰과 심볼을 사칭하는 스팸이 섞여 들어오고,
 * 그때는 `asset_symbol: null` / `asset_verified: false`로 실려 화면이 그렇게 말한다.
 */
const ASSET_SYMBOL: Record<NormalizedEvent["asset_type"], Record<number, string>> = {
  NATIVE: { 1: "ETH", 10: "ETH", 8453: "ETH", 42161: "ETH", 137: "POL" },
  ERC20: { 1: "USDC", 10: "OP", 8453: "USDC", 42161: "ARB", 137: "USDT" },
  ERC721: { 1: "BAYC", 10: "QUEST", 8453: "BASEPAINT", 42161: "SMOL", 137: "LENS" },
  ERC1155: { 1: "OPENSTORE", 10: "OPBADGE", 8453: "BASEBADGE", 42161: "TREASURE", 137: "POLYPASS" },
};

/**
 * 지갑 이벤트 픽스처.
 * 시각은 `taxYear`의 공통 창(7/1~12/31) 안에만 놓는다.
 * 역년 밖으로 새면 같은 연도를 골라도 영국·호주만 다른 건수를 세게 된다.
 */
export function createNormalizedEventFixtures(taxYear: number = demoTaxYear()): NormalizedEvent[] {
  return Array.from({ length: 25 }, (_, index) => {
    const eventNumber = index + 1;
    const classification = classifications[index % classifications.length];
    const unknownPrice = [3, 9, 17].includes(index);
    const lowConfidence = [3, 9, 20].includes(index);
    const override = index === 6;
    const at = new Date(Date.UTC(taxYear, 6, 1 + index * EVENT_SPACING_DAYS, 12, 0, 0));

    const chainId = chains[index % chains.length];
    const assetType = index % 4 === 0 ? "NATIVE" : index % 4 === 1 ? "ERC20" : index % 4 === 2 ? "ERC721" : "ERC1155";

    return {
      id: `event-${String(eventNumber).padStart(2, "0")}`,
      tx_hash: `0x${eventNumber.toString(16).padStart(64, "0")}`,
      chain_id: chainId,
      log_index: index,
      block_timestamp: at.toISOString(),
      wallet_address: "0x1111111111111111111111111111111111111111",
      direction: index % 2 === 0 ? "IN" : "OUT",
      asset_type: assetType,
      asset_contract: index % 4 === 0 ? null : `0x${(1000 + index).toString(16).padStart(40, "0")}`,
      asset_symbol: ASSET_SYMBOL[assetType][chainId] ?? null,
      // 데모 픽스처의 자산은 전부 토큰 목록으로 대조된 것으로 본다.
      asset_verified: true,
      // 로고 원본을 대신 그리면 상표를 왜곡한다. 메타데이터 출처가 붙기 전까지는 비워 두고,
      // 화면은 대체 마크(심볼 이니셜 · NFT 박스)로 그린다.
      asset_icon_url: null,
      token_id: index % 4 >= 2 ? String(index + 100) : null,
      decimals: index % 4 >= 2 ? 0 : 18,
      // decimals와 정합하는 원시 단위 — 18 decimals 자산은 0.01·n, NFT(0 decimals)는 수량 자체다.
      raw_amount: index % 4 >= 2 ? String((index % 3) + 1) : `${eventNumber}${"0".repeat(16)}`,
      counterparty: `0x${(2000 + index).toString(16).padStart(40, "0")}`,
      gas_fee_native: "0.001",
      classification,
      confidence: lowConfidence ? 0.3 : 0.9,
      // 정정은 거래보다 먼저 일어날 수 없다. 절대 시각을 박아두면 픽스처가 움직일 때 과거로 새어나간다.
      user_override: override
        ? {
            classification: "SEND",
            reason: "Verified transfer purpose",
            overridden_at: new Date(at.getTime() + 3_600_000).toISOString(),
          }
        : null,
      price_status: unknownPrice ? "UNKNOWN" : index % 3 === 0 ? "ESTIMATED" : "RESOLVED",
      // 표시통화가 원화다. 건당 1,000원짜리 거래로 두면 어떤 한국 규칙도(기본공제 250만원)
      // 화면에서 작동하는 모습을 볼 수 없다 — 원화로 말이 되는 규모를 쓴다.
      fiat_value: unknownPrice ? null : `${eventNumber * PER_EVENT_KRW}.00`,
      fiat_currency: "KRW",
    };
  });
}
