import { demoInstant, demoTaxYear } from "@/lib/tax/demo-calendar";
import { ONE_DECIMAL, mul } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { getRuleSet } from "@/lib/tax/rulesets";
import type { TaxEvent } from "@/lib/tax/types";

/**
 * 보조단위가 없는 통화(KRW·JPY)는 같은 숫자가 다른 규모다.
 *
 * 통화 중립 금액(BTC 0.5개에 20,000)을 원화로 그대로 읽으면 모든 거래가
 * 한국 기본공제 250만원보다 작아진다. 그러면 화면은 언제나 "비과세 · 기본공제 내"만 말하고,
 * 룰셋이 실제로 무엇을 계산하는지 영영 보이지 않는다.
 * 금액의 **자릿수**만 통화에 맞춰 옮긴다 — 거래 구조·건수·순서·보유기간은 그대로다.
 */
const MINOR_UNIT_ZERO = new Set(["KRW", "JPY"]);
const NO_MINOR_UNIT_SCALE: Decimal = "1000";

/** 이 국가 통화로 시나리오 금액을 읽을 때 쓸 배율. */
export function scenarioScaleFor(country: string): Decimal {
  const currency = getRuleSet(country)?.currency;
  return currency !== undefined && MINOR_UNIT_ZERO.has(currency) ? NO_MINOR_UNIT_SCALE : ONE_DECIMAL;
}

function scaleAmounts(events: TaxEvent[], scale: Decimal): TaxEvent[] {
  if (scale === ONE_DECIMAL) return events;
  return events.map((event) => {
    if (event.kind === "ACQUIRE") return { ...event, cost: mul(event.cost, scale), fee: mul(event.fee, scale) };
    if (event.kind === "INCOME") return { ...event, fmv: mul(event.fmv, scale) };
    return { ...event, proceeds: mul(event.proceeds, scale), fee: mul(event.fee, scale) };
  });
}

const WALLET = "0x1111111111111111111111111111111111111111";
const asset = (symbol: string) => `1:${symbol.toLowerCase()}`;

/**
 * 룰셋 비교 데모용 시나리오.
 * 국가별 분기(장·단기 경계, 손실 상계, 교환 과세, 소득 인식, initial allocation, 30일 재매수)를
 * 모두 한 번씩 밟도록 구성했다. 금액 단위는 통화 중립이며 룰셋의 표시통화로 해석한다.
 *
 * 과세 대상 거래는 전부 `taxYear`의 공통 창(7/1~12/31)에 놓는다.
 * 그 밖으로 새면 같은 연도를 골라도 호주·영국만 일부 거래를 놓쳐,
 * 화면은 "같은 거래를 12개 룰셋으로 비교했다"고 말하면서 실제로는 다른 집합을 비교한다.
 * 취득은 보유기간 분기를 만들기 위해 의도적으로 창 밖(전년)에 둔다 — 원장이 원가만 물려받는다.
 *
 * `scale`은 통화 자릿수만 옮긴다(`scenarioScaleFor`). 기본값 1이면 원본 그대로다.
 */
export function createTaxScenarioEvents(taxYear: number = demoTaxYear(), scale: Decimal = ONE_DECIMAL): TaxEvent[] {
  const y = taxYear;
  const prev = taxYear - 1;
  return scaleAmounts([
    // 처분(7/20)까지 436일 보유 → 독일·포르투갈 면세, 미국·호주 장기(할인) 구간.
    { kind: "ACQUIRE", id: "acq-btc-01", at: demoInstant(prev, 5, 10, 9), wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.5", cost: "20000", fee: "30" },
    { kind: "ACQUIRE", id: "acq-eth-01", at: demoInstant(prev, 6, 1, 9), wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "10", cost: "20000", fee: "25" },
    { kind: "INCOME", id: "inc-stake-03", at: demoInstant(y, 7, 5), wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "0.4", fmv: "1000", incomeKind: "STAKING" },
    { kind: "DISPOSE", id: "dsp-btc-04", at: demoInstant(y, 7, 20, 10), wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.25", proceeds: "15000", fee: "20", trigger: "FIAT" },
    { kind: "INCOME", id: "inc-air-05", at: demoInstant(y, 8, 5), wallet: WALLET, asset: asset("ARB"), symbol: "ARB", quantity: "500", fmv: "600", incomeKind: "AIRDROP" },
    // 사전 거래이력 없는 initial allocation — 호주만 수령 시 비과세·원가 0으로 갈린다.
    { kind: "INCOME", id: "inc-air-06", at: demoInstant(y, 8, 20), wallet: WALLET, asset: asset("OP"), symbol: "OP", quantity: "300", fmv: "450", incomeKind: "AIRDROP_INITIAL" },
    { kind: "ACQUIRE", id: "acq-sol-07", at: demoInstant(y, 9, 1, 9), wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "50", cost: "7000", fee: "15" },
    // 45일 보유 단기 손실 — 인도는 무시, 호주는 할인 전에 차감, 영국은 아래 재매수와 30일 매칭.
    { kind: "DISPOSE", id: "dsp-sol-08", at: demoInstant(y, 10, 16, 10), wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "20", proceeds: "2000", fee: "10", trigger: "FIAT" },
    { kind: "ACQUIRE", id: "acq-sol-08", at: demoInstant(y, 10, 26, 9), wallet: WALLET, asset: asset("SOL"), symbol: "SOL", quantity: "20", cost: "2100", fee: "10" },
    // 크립토→크립토 — 프랑스·포르투갈은 비과세 이연, 나머지는 처분.
    {
      kind: "DISPOSE",
      id: "dsp-eth-09",
      at: demoInstant(y, 11, 10, 10),
      wallet: WALLET,
      asset: asset("ETH"),
      symbol: "ETH",
      quantity: "3",
      proceeds: "9000",
      fee: "25",
      trigger: "CRYPTO",
      receives: { asset: asset("SOL"), symbol: "SOL", quantity: "25" },
    },
    { kind: "DISPOSE", id: "dsp-arb-11", at: demoInstant(y, 11, 25, 10), wallet: WALLET, asset: asset("ARB"), symbol: "ARB", quantity: "500", proceeds: "900", fee: "12", trigger: "FIAT" },
    { kind: "DISPOSE", id: "dsp-btc-12", at: demoInstant(y, 12, 5, 10), wallet: WALLET, asset: asset("BTC"), symbol: "BTC", quantity: "0.1", proceeds: "7000", fee: "18", trigger: "FIAT" },
    { kind: "INCOME", id: "inc-stake-12", at: demoInstant(y, 12, 20), wallet: WALLET, asset: asset("ETH"), symbol: "ETH", quantity: "0.2", fmv: "700", incomeKind: "STAKING" },
  ], scale);
}
