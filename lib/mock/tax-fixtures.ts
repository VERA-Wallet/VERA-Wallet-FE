import type { TaxEvent } from "@/lib/tax/types";

const WALLET = "0x1111111111111111111111111111111111111111";
const asset = (symbol: string) => `1:${symbol.toLowerCase()}`;

/**
 * 룰셋 비교 데모용 시나리오.
 * 국가별 분기(장·단기 경계, 손실 상계, 교환 과세, 소득 인식, initial allocation, 30일 재매수)를
 * 모두 한 번씩 밟도록 구성했다. 금액 단위는 통화 중립이며 룰셋의 표시통화로 해석한다.
 */
export function createTaxScenarioEvents(): TaxEvent[] {
  return [
    { kind: "ACQUIRE", id: "acq-btc-01", at: "2024-02-10T09:00:00.000Z", wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.5", cost: "20000", fee: "30" },
    { kind: "ACQUIRE", id: "acq-eth-01", at: "2024-06-01T09:00:00.000Z", wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "10", cost: "20000", fee: "25" },
    { kind: "INCOME", id: "inc-stake-03", at: "2025-03-15T00:00:00.000Z", wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "0.4", fmv: "1000", incomeKind: "STAKING" },
    // 보유 435일 → 독일·포르투갈은 면세, 미국·호주는 장기(할인) 구간.
    { kind: "DISPOSE", id: "dsp-btc-04", at: "2025-04-20T10:00:00.000Z", wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.25", proceeds: "15000", fee: "20", trigger: "FIAT" },
    { kind: "INCOME", id: "inc-air-05", at: "2025-05-05T00:00:00.000Z", wallet: WALLET, asset: asset("ARB"), symbol: "ARB", quantity: "500", fmv: "600", incomeKind: "AIRDROP" },
    // 사전 거래이력 없는 initial allocation — 호주만 수령 시 비과세·원가 0으로 갈린다.
    { kind: "INCOME", id: "inc-air-06", at: "2025-06-10T00:00:00.000Z", wallet: WALLET, asset: asset("OP"), symbol: "OP", quantity: "300", fmv: "450", incomeKind: "AIRDROP_INITIAL" },
    { kind: "ACQUIRE", id: "acq-sol-07", at: "2025-07-01T09:00:00.000Z", wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "50", cost: "7000", fee: "15" },
    // 단기 손실 — 인도는 무시, 호주는 할인 전에 차감, 영국은 아래 재매수와 30일 매칭.
    { kind: "DISPOSE", id: "dsp-sol-08", at: "2025-08-15T10:00:00.000Z", wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "20", proceeds: "2000", fee: "10", trigger: "FIAT" },
    { kind: "ACQUIRE", id: "acq-sol-08", at: "2025-08-25T09:00:00.000Z", wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "20", cost: "2100", fee: "10" },
    // 크립토→크립토 — 프랑스·포르투갈은 비과세 이연, 나머지는 처분.
    {
      kind: "DISPOSE",
      id: "dsp-eth-09",
      at: "2025-09-10T10:00:00.000Z",
      wallet: WALLET,
      asset: asset("ETH"),
      symbol: "ETH",
      quantity: "3",
      proceeds: "9000",
      fee: "25",
      trigger: "CRYPTO",
      receives: { asset: asset("SOL"), symbol: "SOL", quantity: "25" },
    },
    { kind: "DISPOSE", id: "dsp-arb-11", at: "2025-11-20T10:00:00.000Z", wallet: WALLET, asset: asset("ARB"), symbol: "ARB", quantity: "500", proceeds: "900", fee: "12", trigger: "FIAT" },
    { kind: "DISPOSE", id: "dsp-btc-12", at: "2025-12-05T10:00:00.000Z", wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.1", proceeds: "7000", fee: "18", trigger: "FIAT" },
    { kind: "INCOME", id: "inc-stake-12", at: "2025-12-20T00:00:00.000Z", wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "0.2", fmv: "700", incomeKind: "STAKING" },
  ];
}
