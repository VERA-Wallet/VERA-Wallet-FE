import { demoTaxYear } from "@/lib/tax/demo-calendar";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";
import type { IncomeKind } from "@/lib/tax/types";

const chains = [1, 8453, 42161, 10, 137] as const;
const classifications: Classification[] = ["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"];

/** 25건을 7일 간격으로 놓으면 7/1 + 168일 = 12/16 — 공통 창(7/1~12/31) 안에 전부 들어간다. */
const EVENT_SPACING_DAYS = 7;

/** 기준 연도 배치의 건수. 이 뒤로 다음 해 배치가 이어 붙는다(id는 event-26부터). */
const BASE_EVENT_COUNT = 25;

/**
 * 다음 해(`taxYear + 1`) 배치.
 *
 * 한 해치만 담으면 화면에 연도 경계가 없어, 연도 필터·연도별 리포트가 실제로 무엇을 가르는지
 * 데모에서 볼 수 없다. 그래서 **이제 막 열린 해**의 거래도 함께 만든다.
 * 그 해 공통 창(7/1~) 시작부터 5일 간격 10건이라 7/1~8/15에 놓이고,
 * 8월 중순이면 배치가 통째로 과거에 들어온다.
 */
const NEXT_YEAR_EVENT_COUNT = 10;
const NEXT_YEAR_SPACING_DAYS = 5;

/**
 * 시행연도(`taxYear + 2`, 데모 기준 2027) **처분 쇼케이스** 배치.
 *
 * 한국 룰셋은 2027-01-01부터 시행된다(가상자산 양도·대여 기타소득). 시행연도 리포트를
 * 데모에서 실제 숫자로 보이게 하려면 그 해에 **처분**이 있어야 한다 — 취득만 있으면 손익이
 * 없어 부담이 0이다. 그래서 이 배치는 SEND·EXCHANGE만 담고, **이전 배치(2025·2026)에서
 * 취득한 것과 같은 자산 키**를 처분해 거주자별 총평균법이 실제 취득단가 기준 손익을 내게 한다.
 *
 * 이 배치는 미래 날짜(2027)라 정상이라면 미래 필터에 걸린다. 하지만 이건 시행연도 리포트를
 * 데모에서 보이게 하려는 **mock 쇼케이스 샘플**이므로 미래 필터에서 의도적으로 제외한다
 * (아래 `createNormalizedEventFixtures`가 base·next와 달리 이 배치에는 필터를 걸지 않는다).
 * 2025·2026 배치의 기존 미래 필터·동작은 그대로 둔다.
 *
 * `assetIndex`는 buildEvent가 자산 정체성(체인·타입·계약·토큰·수량)을 파생하는 순번이다.
 * 계약 주소가 순번마다 유일해 처분 event 번호만으로는 이전 취득과 같은 자산에 걸 수 없어,
 * 취득분(RECEIVE·방향 IN)의 순번을 가리켜 같은 자산 키를 처분한다. base·next에서 취득가액이
 * 잡히는 자산 키는 셋뿐이다 — 1:native ETH(event-01·21), 1:BAYC #110(event-11),
 * 137:LENS #134(event-35). (나머지 RECEIVE는 방향 OUT이라 `directionClassificationConflict`로
 * 계산에서 빠져 취득가액이 없다.) 한 취득 lot을 여러 처분으로 쪼개려고 `rawAmount`로 부분 수량을 준다.
 * classification은 SEND(처분·짝수 event 번호라 방향 OUT) / EXCHANGE(방향 무관)로 두어
 * `directionClassificationConflict` 게이트(SEND+IN)에 걸리지 않게 한다.
 */
const SHOWCASE_YEAR_OFFSET = 2;
const SHOWCASE_SPACING_DAYS = 5;
/** n/100 ETH의 raw 수량(18 decimals). 0.01 ETH = 10^16. */
const ethRaw = (hundredths: number): string => `${hundredths}${"0".repeat(16)}`;
const SHOWCASE_DISPOSALS: { classification: Extract<Classification, "SEND" | "EXCHANGE">; assetIndex: number; rawAmount: string }[] = [
  // 1:native ETH — event-01(0.01)+event-21(0.21) 취득분(합 0.22)을 6건으로 나눠 총평균 단가로 처분한다.
  { classification: "SEND", assetIndex: 0, rawAmount: ethRaw(3) }, // event-36 · 0.03
  { classification: "EXCHANGE", assetIndex: 0, rawAmount: ethRaw(3) }, // event-37 · 0.03
  { classification: "SEND", assetIndex: 0, rawAmount: ethRaw(4) }, // event-38 · 0.04
  { classification: "EXCHANGE", assetIndex: 0, rawAmount: ethRaw(4) }, // event-39 · 0.04
  { classification: "SEND", assetIndex: 0, rawAmount: ethRaw(4) }, // event-40 · 0.04
  { classification: "EXCHANGE", assetIndex: 0, rawAmount: ethRaw(4) }, // event-41 · 0.04
  // 1:BAYC #110 — event-11 취득분(×2)을 1개씩 처분.
  { classification: "SEND", assetIndex: 10, rawAmount: "1" }, // event-42 · ×1
  { classification: "EXCHANGE", assetIndex: 10, rawAmount: "1" }, // event-43 · ×1
  // 137:LENS #134 — event-35 취득분(×2)을 1개씩 처분.
  { classification: "SEND", assetIndex: 34, rawAmount: "1" }, // event-44 · ×1
  { classification: "EXCHANGE", assetIndex: 34, rawAmount: "1" }, // event-45 · ×1
];

/** 이벤트 번호 1건당 원화 금액. 25건이 ₩40만~₩1,000만 사이에 퍼진다. */
const PER_EVENT_KRW = 400_000;

/**
 * DeFi 수익(수령분) 데모 배치.
 *
 * 지갑 파이프라인이 income을 표현하는지 데모에서 보이려면 실제 수령 이벤트가 있어야 한다.
 * 스테이킹 보상·디파이 보상·대여 이자를 각각 담는다 — 전부 기준 연도(taxYear) 공통 창(7/1~) 안,
 * RECEIVE·방향 IN, income_kind 설정, 원화 평가액(fiat_value) 있음. 과거(기준 연도)라 미래 필터와 무관하다.
 *
 * KR에서 대여 이자(LENDING)만 과세 income(대여 대가)이고, 스테이킹·디파이 보상은 명문 규정이 없어
 * 판정 보류로 예외·미결 질문에 뜬다(시행 후 또는 시행 가정에서).
 */
const INCOME_EVENTS: {
  incomeKind: IncomeKind;
  symbol: string;
  counterparty: string;
  /** ERC20 18 decimals 원시 수량. */
  rawAmount: string;
}[] = [
  { incomeKind: "STAKING", symbol: "stETH", counterparty: "Lido: stETH staking rewards", rawAmount: `4${"0".repeat(16)}` }, // 0.04 stETH
  { incomeKind: "DEFI_REWARD", symbol: "CRV", counterparty: "Curve: gauge rewards", rawAmount: `12${"0".repeat(18)}` }, // 12 CRV
  { incomeKind: "LENDING", symbol: "aUSDC", counterparty: "Aave: supply interest", rawAmount: `250${"0".repeat(18)}` }, // 250 aUSDC
];
/** 수익 이벤트 간격(일). 9월부터 놓아 세 건이 창(7/1~12/31) 안에 여유 있게 들어간다. */
const INCOME_SPACING_DAYS = 21;

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
 * 한 건의 픽스처가 채우는 자리. `eventNumber`(1부터)가 id·해시·원화 금액을 정하고,
 * 그 순번에서 파생되는 체인·자산 타입·방향은 아래 한 곳에서만 계산한다.
 */
type FixtureSpec = {
  eventNumber: number;
  at: Date;
  classification: Classification;
  unknownPrice: boolean;
  lowConfidence: boolean;
  override: boolean;
  /**
   * 자산 정체성(체인·타입·계약·토큰·수량)을 파생할 순번. 생략하면 `eventNumber - 1`.
   * 처분 쇼케이스가 이전 취득과 **같은 자산 키·lot 수량**을 가리키려고 쓴다 — 계약 주소가
   * 순번마다 유일해 event 번호만으로는 같은 자산을 재사용할 수 없기 때문이다.
   * id·해시·원화 금액·방향은 여전히 event 번호에서 나오므로 이 값을 넣어도 각 건은 유일하다.
   */
  assetIndex?: number;
  /**
   * 원시 수량(raw_amount) 오버라이드. 생략하면 assetIndex에서 파생한다.
   * 처분 쇼케이스가 한 취득 lot을 여러 처분으로 쪼개 총평균 풀 안에서 소비하려고 쓴다
   * (assetIndex만으로는 lot당 한 수량뿐이라 부분 처분을 만들 수 없다). decimals와 정합해야 한다.
   */
  rawAmount?: string;
};

function buildEvent({ eventNumber, at, classification, unknownPrice, lowConfidence, override, assetIndex: assetIndexOverride, rawAmount }: FixtureSpec): NormalizedEvent {
  const index = eventNumber - 1;
  // 자산 정체성·수량은 assetIndex에서, 그 밖(id·해시·방향·원화 금액)은 event 번호(index)에서 파생한다.
  const assetIndex = assetIndexOverride ?? index;
  const chainId = chains[assetIndex % chains.length];
  const assetType = assetIndex % 4 === 0 ? "NATIVE" : assetIndex % 4 === 1 ? "ERC20" : assetIndex % 4 === 2 ? "ERC721" : "ERC1155";

  return {
    id: `event-${String(eventNumber).padStart(2, "0")}`,
    tx_hash: `0x${eventNumber.toString(16).padStart(64, "0")}`,
    chain_id: chainId,
    log_index: index,
    block_timestamp: at.toISOString(),
    wallet_address: "0x1111111111111111111111111111111111111111",
    direction: index % 2 === 0 ? "IN" : "OUT",
    asset_type: assetType,
    asset_contract: assetIndex % 4 === 0 ? null : `0x${(1000 + assetIndex).toString(16).padStart(40, "0")}`,
    asset_symbol: ASSET_SYMBOL[assetType][chainId] ?? null,
    // 데모 픽스처의 자산은 전부 토큰 목록으로 대조된 것으로 본다.
    asset_verified: true,
    // 로고 원본을 대신 그리면 상표를 왜곡한다. 메타데이터 출처가 붙기 전까지는 비워 두고,
    // 화면은 대체 마크(심볼 이니셜 · NFT 박스)로 그린다.
    asset_icon_url: null,
    token_id: assetIndex % 4 >= 2 ? String(assetIndex + 100) : null,
    decimals: assetIndex % 4 >= 2 ? 0 : 18,
    // decimals와 정합하는 원시 단위 — 18 decimals 자산은 0.01·n, NFT(0 decimals)는 수량 자체다.
    // rawAmount가 있으면(처분 쇼케이스의 부분 처분) 그 값을 그대로 쓴다.
    raw_amount: rawAmount ?? (assetIndex % 4 >= 2 ? String((assetIndex % 3) + 1) : `${assetIndex + 1}${"0".repeat(16)}`),
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
    // 금액 override는 사용자가 상세 편집에서 채운다. 기본 픽스처는 비워 둔다.
    value_override: null,
    price_status: unknownPrice ? "UNKNOWN" : index % 3 === 0 ? "ESTIMATED" : "RESOLVED",
    // 표시통화가 원화다. 건당 1,000원짜리 거래로 두면 어떤 한국 규칙도(기본공제 250만원)
    // 화면에서 작동하는 모습을 볼 수 없다 — 원화로 말이 되는 규모를 쓴다.
    fiat_value: unknownPrice ? null : `${eventNumber * PER_EVENT_KRW}.00`,
    fiat_currency: "KRW",
    // 기본 픽스처는 매수 취득이라 수익 종류가 없다. DeFi 수익 배치만 이 칸을 채운다.
    income_kind: null,
    // These synthetic EXCHANGE rows are standalone disposals (not an IN/OUT pair sharing one tx),
    // so they are not a swap-pairing target -> null.
    group_id: null,
    swap_to_symbol: null,
    swap_to_icon_url: null,
    bridge_dest_chain_id: null,
    bridge_group_id: null,
  };
}

/**
 * 지갑 이벤트 픽스처. 네 배치가 이어진다 —
 * `taxYear`의 25건, `taxYear + 1`의 배치, 시행연도(`taxYear + 2`) 처분 쇼케이스,
 * 그리고 기준 연도(`taxYear`)의 DeFi 수익(수령분) 배치.
 *
 * base·next의 시각은 **그 배치가 속한 해**의 공통 창(7/1~12/31) 안에만 놓는다.
 * 역년 밖으로 새면 같은 연도를 골라도 영국·호주만 다른 건수를 세게 된다.
 *
 * `now`는 아직 오지 않은 거래를 만들지 않기 위한 기준 시각이다 — base·next에만 적용한다.
 * 시행연도 쇼케이스 배치는 시행연도(2027) 리포트를 데모에서 보이게 하는 mock 샘플이라
 * **미래 필터에서 의도적으로 제외**한다(아래 showcase에는 필터를 걸지 않는다).
 * 테스트는 고정 시각을 넣어 base·next 배치 크기를 결정적으로 만들 수 있다.
 */
export function createNormalizedEventFixtures(
  taxYear: number = demoTaxYear(),
  now: Date = new Date(),
): NormalizedEvent[] {
  const base = Array.from({ length: BASE_EVENT_COUNT }, (_, index) =>
    buildEvent({
      eventNumber: index + 1,
      at: new Date(Date.UTC(taxYear, 6, 1 + index * EVENT_SPACING_DAYS, 12, 0, 0)),
      classification: classifications[index % classifications.length],
      unknownPrice: [3, 9, 17].includes(index),
      lowConfidence: [3, 9, 20].includes(index),
      override: index === 6,
    }),
  );

  const next = Array.from({ length: NEXT_YEAR_EVENT_COUNT }, (_, position) =>
    buildEvent({
      eventNumber: BASE_EVENT_COUNT + 1 + position,
      at: new Date(Date.UTC(taxYear + 1, 6, 1 + position * NEXT_YEAR_SPACING_DAYS, 12, 0, 0)),
      // 이 배치는 첫 건이 처분이다. 창이 막 열려 한두 건만 과거일 때도
      // 12개 룰셋이 그 해에 셀 것을 갖게 된다(취득만 남으면 "이번 기간에 셀 것이 없음"이다).
      classification: classifications[(position + 1) % classifications.length],
      unknownPrice: position === 4,
      lowConfidence: position === 7,
      override: false,
    }),
    // 아직 일어나지 않은 거래는 만들지 않는다. 공통 창이 열리기 전(1~6월)에 실행되면
    // 이 배치가 통째로 비는 것이 정상이고, 그때 화면은 연도 칩을 숨긴다.
  ).filter((event) => Date.parse(event.block_timestamp) < now.getTime());

  // 시행연도(2027) 처분 쇼케이스. base·next에서 취득한 자산을 그 해에 처분해
  // 거주자별 총평균법이 실제 손익·부담을 내게 한다. mock 샘플이라 미래 필터를 걸지 않는다.
  const showcase = SHOWCASE_DISPOSALS.map((spec, position) =>
    buildEvent({
      eventNumber: BASE_EVENT_COUNT + NEXT_YEAR_EVENT_COUNT + 1 + position,
      at: new Date(Date.UTC(taxYear + SHOWCASE_YEAR_OFFSET, 6, 1 + position * SHOWCASE_SPACING_DAYS, 12, 0, 0)),
      classification: spec.classification,
      assetIndex: spec.assetIndex,
      rawAmount: spec.rawAmount,
      unknownPrice: false,
      lowConfidence: false,
      override: false,
    }),
  );

  // DeFi 수익(수령분) 배치. 기준 연도(taxYear) 창 안의 과거 수령이라 미래 필터와 무관하다.
  // buildEvent로 id·해시·지갑·원화 평가액을 만들고, 수익 특유의 방향(IN)·자산·상대방·수익 종류만 덮는다.
  const income = INCOME_EVENTS.map((spec, position) => {
    const built = buildEvent({
      eventNumber: BASE_EVENT_COUNT + NEXT_YEAR_EVENT_COUNT + SHOWCASE_DISPOSALS.length + 1 + position,
      at: new Date(Date.UTC(taxYear, 8, 1 + position * INCOME_SPACING_DAYS, 12, 0, 0)),
      classification: "RECEIVE",
      unknownPrice: false,
      lowConfidence: false,
      override: false,
    });
    return {
      ...built,
      // 수익 수령은 자산이 지갑으로 들어오는 흐름이다 — 방향을 IN으로 고정한다(buildEvent는 순번으로 방향을 정해 OUT일 수 있다).
      direction: "IN" as const,
      // 그럴듯한 DeFi 자산·상대방으로 덮는다(Lido stETH·Curve·Aave). 전부 ERC20으로 본다.
      asset_type: "ERC20" as const,
      asset_contract: `0x${(3000 + position).toString(16).padStart(40, "0")}`,
      asset_symbol: spec.symbol,
      token_id: null,
      decimals: 18,
      raw_amount: spec.rawAmount,
      counterparty: spec.counterparty,
      // 수령 시점 원화 평가액이 확정돼 있어야 소득 fmv로 쓸 수 있다.
      price_status: "RESOLVED" as const,
      income_kind: spec.incomeKind,
    };
  });

  return [...base, ...next, ...showcase, ...income];
}
