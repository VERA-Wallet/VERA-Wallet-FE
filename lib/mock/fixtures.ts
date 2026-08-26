import { demoTaxYear } from "@/lib/mock/demo-calendar";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";
import type { IncomeKind } from "@/lib/tax/types";

/**
 * 데모 지갑 이력 픽스처 — **손으로 짠 현실적 시나리오**.
 *
 * 예전 버전은 하나의 순번 공식(`fiat_value = eventNumber × 400,000`, `수량 = (index+1)/100`)에서
 * 모든 걸 파생해, 자산·수량·가격·분류가 서로 아무 관계가 없었다(모든 코인이 개당 정확히 ₩40,000,000이
 * 되는 식). 그래서 취득가·양도가가 구조적으로 비었고, NFT를 수량 있는 대체가능 토큰처럼 다뤘다.
 *
 * 이제는 **자산 레지스트리 + 시세 기반**으로 짠다:
 * - `fiat_value = 수량 × 단가(₩)` — 항상 정합. 단가는 근사 현재 시세(mock, 세무 자문 아님)이고
 *   같은 자산도 시점마다 시세가 달라 실제 손익(이익·손실)이 나온다.
 * - 같은 자산을 취득한 뒤 처분해(같은 chain:contract 키) 취득가·양도가가 항상 차고 손익이 계산된다.
 * - **NFT는 취득·보유만** 둔다(처분 없음). 한국에서 대부분의 NFT는 특금법상 가상자산이 아니라
 *   (금융위 입장) 가상자산 소득 과세(2027 시행) 범위가 불확실하다 — 처분 손익을 계산해 붙이면
 *   과세된다는 잘못된 함의가 생긴다. 그래서 NFT는 개별 시가로 "취득"만 기록하고 손익은 두지 않는다.
 *   ("NFT → 과세 범위 불확실" 판정 배지를 붙이려면 엔진에 룰을 더해야 한다 — 데이터만으론 불가.)
 */

const WALLET = "0x1111111111111111111111111111111111111111";

type AssetType = NormalizedEvent["asset_type"];
type Asset = { symbol: string; chainId: number; assetType: AssetType; contract: string | null; decimals: number };

/**
 * 자산 레지스트리. 심볼·체인·계약·소수자리를 한 곳에서 고정한다 — 같은 자산은 같은 키(chain:contract)라
 * 취득과 처분이 매칭돼 원가가 잡힌다. 계약 주소는 실제 메인넷 주소를 써 현실감을 준다.
 * USDC·aUSDC는 실제로 6 decimals다(예전 픽스처는 전부 18로 뭉갰다).
 */
const ASSETS = {
  eth: { symbol: "ETH", chainId: 1, assetType: "NATIVE", contract: null, decimals: 18 },
  usdc: { symbol: "USDC", chainId: 8453, assetType: "ERC20", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  arb: { symbol: "ARB", chainId: 42161, assetType: "ERC20", contract: "0x912ce59144191c1204e64559fe8253a0e49e6548", decimals: 18 },
  op: { symbol: "OP", chainId: 10, assetType: "ERC20", contract: "0x4200000000000000000000000000000000000042", decimals: 18 },
  pol: { symbol: "POL", chainId: 137, assetType: "NATIVE", contract: null, decimals: 18 },
  steth: { symbol: "stETH", chainId: 1, assetType: "ERC20", contract: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", decimals: 18 },
  ausdc: { symbol: "aUSDC", chainId: 1, assetType: "ERC20", contract: "0xbcca60bb61934080951369a648fb03df4f96263c", decimals: 6 },
  azuki: { symbol: "AZUKI", chainId: 1, assetType: "ERC721", contract: "0xed5af388653567af2f388e6224dc7c4b3241c544", decimals: 0 },
  pudgy: { symbol: "PPG", chainId: 1, assetType: "ERC721", contract: "0xbd3531da5cf5857e7cfaa92426877b022e612cf8", decimals: 0 },
  // 심볼을 사칭하는 미검증 스팸(토큰 목록으로 대조 안 됨). 계약은 있지만 무엇인지 모른다.
  spam: { symbol: "USDC", chainId: 1, assetType: "ERC20", contract: "0x0000000000000000000000000000000000000bad", decimals: 18 },
} satisfies Record<string, Asset>;

/** 체인 원시 단위(정수 문자열). uint256 범위를 넘길 수 있어 문자열로 자릿수를 민다. */
function raw(amount: string, decimals: number): string {
  const [intPart, fracPart = ""] = amount.split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${intPart}${frac}`.replace(/^0+(?=\d)/, "");
  return digits.length ? digits : "0";
}

type Spec = {
  asset: Asset;
  dir: "IN" | "OUT";
  cls: Classification;
  /** 사람이 읽는 수량(예 "0.4", "3000"). NFT는 "1". */
  amount: string;
  /** 이 시점의 ₩/토큰 단가. NFT는 그 개체의 ₩ 시가. `unknownPrice`면 무시된다. */
  unitKrw: number;
  /** [month(0-based), day] — 해당 연도 공통 창(7/1~12/31) 안. */
  day: [number, number];
  tokenId?: string;
  incomeKind?: IncomeKind;
  swapTo?: string;
  bridgeDest?: number;
  /**
   * 같은 키를 가진 스펙들이 **같은 tx_hash를 공유**한다 — 스왑의 두 다리(처분 OUT + 취득 IN)가
   * 한 트랜잭션임을 원장에 그대로 싣는 방법이다. 목록은 이 tx_hash로 두 다리를 한 행으로 묶는다.
   */
  txKey?: string;
  counterparty?: string;
  /** 토큰 목록으로 대조됐는가. 기본 true. 스팸은 false. */
  verified?: boolean;
  /** 심볼조차 모르는 자산(대조 실패). asset_symbol을 null로 둔다. */
  symbolNull?: boolean;
  /** 가격 미확정(price_status UNKNOWN · fiat_value null). */
  unknownPrice?: boolean;
  /** 신뢰도 낮음 → 확인 필요 큐. */
  lowConf?: boolean;
};

function makeEvent(n: number, year: number, spec: Spec): NormalizedEvent {
  const { asset } = spec;
  const verified = spec.verified ?? true;
  const unknown = spec.unknownPrice === true;
  // txKey가 있으면 키에서 결정론적으로 tx_hash를 만든다 — 같은 키의 스펙(스왑 두 다리)이 같은 해시를 공유한다.
  const txHash = spec.txKey
    ? `0x${[...spec.txKey].map((ch) => ch.codePointAt(0)!.toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64)}`
    : `0x${n.toString(16).padStart(64, "0")}`;
  return {
    id: `event-${String(n).padStart(2, "0")}`,
    tx_hash: txHash,
    chain_id: asset.chainId,
    log_index: n,
    block_timestamp: new Date(Date.UTC(year, spec.day[0], spec.day[1], 9, 0, 0)).toISOString(),
    wallet_address: WALLET,
    direction: spec.dir,
    asset_type: asset.assetType,
    asset_contract: asset.contract,
    // 검증된 자산은 레지스트리 심볼을, 심볼조차 모르면 null을 둔다(지어내지 않는다).
    asset_symbol: spec.symbolNull ? null : asset.symbol,
    asset_verified: verified,
    asset_icon_url: null,
    token_id: spec.tokenId ?? null,
    decimals: asset.decimals,
    raw_amount: raw(spec.amount, asset.decimals),
    counterparty: spec.counterparty ?? `0x${(n + 0x2000).toString(16).padStart(40, "0")}`,
    gas_fee_native: "0.0004",
    classification: spec.cls,
    confidence: spec.lowConf ? 0.35 : 0.95,
    user_override: null,
    value_override: null,
    price_status: unknown ? "UNKNOWN" : "RESOLVED",
    // 시세 기반 평가액 — 수량 × 단가. 가격 미확정이면 null(화면이 그렇게 말한다).
    fiat_value: unknown ? null : (Number(spec.amount) * spec.unitKrw).toFixed(2),
    fiat_currency: "KRW",
    income_kind: spec.incomeKind ?? null,
    swap_to_symbol: spec.swapTo ?? null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: spec.bridgeDest ?? null,
  };
}

const A = ASSETS;

// 알려진 컨트랙트 상대(실제 메인넷 주소). 표시 이름(Aave·Lido 등)은 lib/contracts.ts 레지스트리가 결정한다 —
// 픽스처는 주소만 싣는다("Lido: staking rewards" 같은 텍스트를 counterparty에 넣지 않는다).
const LIDO = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const AAVE = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const ACROSS = "0x09aea4b2242abc8bb4bb78d537a67a245a7bec64";

/**
 * 기준 연도(taxYear, 데모 2025) 지갑 이력. 매수·매도(이익·손실 혼합)·스왑·브릿지·소득·NFT 보유·
 * 미검증/저신뢰(확인 필요 큐)를 한 이야기로 담는다. 시세는 시점마다 달라 실제 손익이 나온다.
 */
const BASE_SPECS: Spec[] = [
  // 매수: ETH 2.0 @ ₩4.5M (총 ₩9,000,000). 이후 처분들의 취득원가가 된다.
  { asset: A.eth, dir: "IN", cls: "RECEIVE", amount: "2.0", unitKrw: 4_500_000, day: [6, 3] },
  { asset: A.usdc, dir: "IN", cls: "RECEIVE", amount: "5000", unitKrw: 1_400, day: [6, 8] },
  { asset: A.arb, dir: "IN", cls: "RECEIVE", amount: "3000", unitKrw: 1_400, day: [6, 15] },
  // 스왑 ①: USDC → ETH — **같은 tx_hash를 공유하는 두 다리**(처분 OUT + 취득 IN)로 싣는다.
  // 내보낸 USDC는 스테이블이라 취득가≈양도가로 손익 거의 0. 받은 ETH는 취득가(원가)를 얻는다(이연).
  { asset: A.usdc, dir: "OUT", cls: "EXCHANGE", amount: "1000", unitKrw: 1_400, day: [6, 22], txKey: "swap-usdc-eth", counterparty: KYBER },
  { asset: A.eth, dir: "IN", cls: "RECEIVE", amount: "0.31", unitKrw: 4_500_000, day: [6, 22], txKey: "swap-usdc-eth", counterparty: KYBER },
  // 브릿지: USDC Base → Arbitrum(처분 아님). 상대는 Across SpokePool.
  { asset: A.usdc, dir: "OUT", cls: "INTERNAL_TRANSFER", amount: "2000", unitKrw: 1_400, day: [7, 1], bridgeDest: 42161, counterparty: ACROSS },
  // 소득: 스테이킹 보상 0.05 stETH(₩250,000). KR은 명문 규정이 없어 판정 보류로 뜬다. 상대는 Lido.
  { asset: A.steth, dir: "IN", cls: "RECEIVE", amount: "0.05", unitKrw: 5_000_000, day: [7, 10], incomeKind: "STAKING", counterparty: LIDO },
  // 매도: ETH 0.4 @ ₩5.5M(양도가 ₩2,200,000). 취득가 ₩4.5M 대비 이익.
  { asset: A.eth, dir: "OUT", cls: "SEND", amount: "0.4", unitKrw: 5_500_000, day: [7, 20] },
  // 소득: 대여 이자 120 aUSDC(₩168,000). KR에서 대여 대가는 과세 income. 상대는 Aave Pool.
  { asset: A.ausdc, dir: "IN", cls: "RECEIVE", amount: "120", unitKrw: 1_400, day: [8, 1], incomeKind: "LENDING", counterparty: AAVE },
  // 매도: ARB 3000 @ ₩1,100(양도가 ₩3,300,000). 취득가 ₩4,200,000 대비 손실.
  { asset: A.arb, dir: "OUT", cls: "SEND", amount: "3000", unitKrw: 1_100, day: [8, 10] },
  { asset: A.op, dir: "IN", cls: "RECEIVE", amount: "800", unitKrw: 3_000, day: [8, 20] },
  // 매도: OP 800 @ ₩2,600(양도가 ₩2,080,000). 취득가 ₩2,400,000 대비 손실.
  { asset: A.op, dir: "OUT", cls: "SEND", amount: "800", unitKrw: 2_600, day: [9, 1] },
  { asset: A.pol, dir: "IN", cls: "RECEIVE", amount: "5000", unitKrw: 550, day: [9, 10] },
  // 스왑 ②: ETH → USDC — 같은 tx_hash 두 다리. 내보낸 ETH는 취득가 ₩4.5M 대비 이익,
  // 받은 USDC는 그 시점 평가액으로 취득가를 얻는다(수수료만큼 OUT보다 약간 작다).
  { asset: A.eth, dir: "OUT", cls: "EXCHANGE", amount: "0.2", unitKrw: 5_600_000, day: [9, 20], txKey: "swap-eth-usdc", counterparty: KYBER },
  { asset: A.usdc, dir: "IN", cls: "RECEIVE", amount: "800", unitKrw: 1_397.5, day: [9, 20], txKey: "swap-eth-usdc", counterparty: KYBER },
  // NFT 취득(보유). 개별 시가로 기록하고 손익은 두지 않는다(위 파일 주석 참고).
  { asset: A.azuki, dir: "IN", cls: "RECEIVE", amount: "1", unitKrw: 8_000_000, day: [10, 1], tokenId: "3021" },
  { asset: A.pudgy, dir: "IN", cls: "RECEIVE", amount: "1", unitKrw: 18_000_000, day: [10, 8], tokenId: "5498" },
  // 미검증 스팸: USDC를 사칭하나 대조 실패 + 가격 미확정 → 확인 필요 큐(미검증·가격 확인 필요).
  { asset: A.spam, dir: "IN", cls: "RECEIVE", amount: "1000", unitKrw: 0, day: [10, 15], verified: false, unknownPrice: true },
  // 매도: ETH 0.3 @ ₩5.2M(양도가 ₩1,560,000). 이익.
  { asset: A.eth, dir: "OUT", cls: "SEND", amount: "0.3", unitKrw: 5_200_000, day: [10, 20] },
  // 매도: POL 5000 @ ₩600(양도가 ₩3,000,000). 취득가 ₩2,750,000 대비 소폭 이익이나 신뢰도 낮아 확인 필요.
  { asset: A.pol, dir: "OUT", cls: "SEND", amount: "5000", unitKrw: 600, day: [11, 1], lowConf: true },
];

/**
 * 다음 해(taxYear + 1, 데모 2026) 배치. 연도 필터·연도별 리포트가 무엇을 가르는지 보이게 한다.
 * `now` 이후(아직 오지 않은) 거래는 만들지 않는다 — 창이 열리기 전 실행되면 통째로 빈다.
 */
const NEXT_SPECS: Spec[] = [
  { asset: A.eth, dir: "IN", cls: "RECEIVE", amount: "0.5", unitKrw: 5_800_000, day: [6, 5] },
  { asset: A.eth, dir: "OUT", cls: "SEND", amount: "0.2", unitKrw: 6_200_000, day: [6, 20] },
];

/**
 * 시행연도(taxYear + 2, 데모 2027) **처분 쇼케이스**. 한국 룰셋은 2027-01-01 시행이라, 그 해에
 * 처분이 있어야 시행연도 리포트가 실제 부담을 낸다. 앞서 취득한 ETH를 큰 이익으로 처분해
 * 기본공제(250만원)를 넘겨 과세 표준이 잡히게 한다. mock 샘플이라 미래 필터에서 제외한다.
 */
const SHOWCASE_SPECS: Spec[] = [
  { asset: A.eth, dir: "OUT", cls: "SEND", amount: "0.6", unitKrw: 8_000_000, day: [6, 1] },
  // 스왑도 two-leg로 — 받은 USDC(취득)는 손익을 만들지 않아 시행연도 부담 숫자는 그대로다.
  { asset: A.eth, dir: "OUT", cls: "EXCHANGE", amount: "0.4", unitKrw: 8_500_000, day: [6, 20], txKey: "swap-2027", counterparty: KYBER },
  { asset: A.usdc, dir: "IN", cls: "RECEIVE", amount: "2400", unitKrw: 1_416, day: [6, 20], txKey: "swap-2027", counterparty: KYBER },
];

/**
 * 지갑 이벤트 픽스처. base(taxYear)·next(taxYear+1)·showcase(taxYear+2)를 이어 붙인다.
 * base·next는 `now` 이후 거래를 만들지 않고(창이 안 열렸으면 빈다), showcase는 시행연도 리포트를
 * 데모에서 보이게 하는 mock 샘플이라 미래 필터에서 의도적으로 제외한다.
 * 테스트는 고정 `now`를 넣어 배치 크기를 결정적으로 만들 수 있다.
 */
export function createNormalizedEventFixtures(
  taxYear: number = demoTaxYear(),
  now: Date = new Date(),
): NormalizedEvent[] {
  let n = 0;
  const build = (specs: Spec[], year: number, futureFilter: boolean) =>
    specs
      .map((spec) => makeEvent((n += 1), year, spec))
      .filter((event) => !futureFilter || Date.parse(event.block_timestamp) < now.getTime());

  const base = build(BASE_SPECS, taxYear, true);
  const next = build(NEXT_SPECS, taxYear + 1, true);
  const showcase = build(SHOWCASE_SPECS, taxYear + 2, false);

  return [...base, ...next, ...showcase];
}
