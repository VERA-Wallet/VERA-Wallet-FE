import { chainLabel } from "@/lib/format";

/**
 * 지갑 홈이 그리는 보유 자산 한 줄.
 *
 * 가격은 **데모 예시 시세(USD)** 다 — 실시간 시세 피드가 아니다(목/데모 모드). 실 BE가 붙으면
 * 이 소스를 잔액+시세 API로 교체하면 되고, 화면 계약(수량·단가·평가액)은 그대로 쓸 수 있다.
 */
export interface Holding {
  key: string; // `${chainId}:${symbol}`
  symbol: string;
  name: string;
  chainId: number;
  chainName: string; // chainLabel(chainId)
  isNft: boolean;
  amount: string; // 사람이 읽는 수량(십진 문자열)
  priceUsd: string; // 단가(USD, 십진 문자열)
  valueUsd: string; // 평가액 = amount × priceUsd (USD, 십진 문자열)
  // 취득 평가액(USD, 십진 문자열) — **데모 예시 mock**이다. 실시간 원가 추적이 아니다.
  // 실 BE가 붙으면 원장 취득가로 교체한다. 화면은 이 값으로 평가손익·수익률을 **표시만** 한다.
  costUsd: string;
}

// ── 십진 문자열 산술 ─────────────────────────────────────────────────────────
// 금액을 Number로 태우면 2^53 밖에서 값이 바뀐다. 자릿수만 맞춰 BigInt로 계산한다.

function fractionLength(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

function toScaledInt(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const magnitude = BigInt(`${whole || "0"}${fraction.padEnd(scale, "0")}`);
  return negative ? -magnitude : magnitude;
}

function fromScaledInt(scaled: bigint, scale: number): string {
  const negative = scaled < BigInt(0);
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale) || "0";
  const fraction = scale > 0 ? digits.slice(digits.length - scale).replace(/0+$/, "") : "";
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

/** 두 십진 문자열의 곱. 후행 0은 다듬는다. */
export function multiplyDecimal(a: string, b: string): string {
  const scaleA = fractionLength(a);
  const scaleB = fractionLength(b);
  return fromScaledInt(toScaledInt(a, scaleA) * toScaledInt(b, scaleB), scaleA + scaleB);
}

/** 두 십진 문자열의 합. */
export function addDecimal(a: string, b: string): string {
  const scale = Math.max(fractionLength(a), fractionLength(b));
  return fromScaledInt(toScaledInt(a, scale) + toScaledInt(b, scale), scale);
}

/** 두 십진 문자열의 차(a − b). 평가손익(평가액 − 취득원가) 표시 산술용. */
export function subtractDecimal(a: string, b: string): string {
  const scale = Math.max(fractionLength(a), fractionLength(b));
  return fromScaledInt(toScaledInt(a, scale) - toScaledInt(b, scale), scale);
}

/** 자리수를 보존한 반올림 정수 나눗셈(divisor > 0). 절반은 0에서 멀어지는 방향으로 올린다. */
function roundedDiv(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < BigInt(0);
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude + divisor / BigInt(2)) / divisor;
  return negative ? -quotient : quotient;
}

/**
 * 취득원가 대비 평가손익 수익률(%)을 소수 둘째 자리까지 십진 문자열로 낸다.
 * 세무 엔진이 아니라 **표시 산술**이다 — 원가가 0이면 수익률을 정의할 수 없어 null.
 * 부호는 손익을 따른다("12.5" / "-5.56" / "0").
 */
export function returnPercent(costUsd: string, gainUsd: string): string | null {
  const scale = Math.max(fractionLength(costUsd), fractionLength(gainUsd));
  const cost = toScaledInt(costUsd, scale);
  if (cost === BigInt(0)) return null;
  const gain = toScaledInt(gainUsd, scale);
  const absCost = cost < BigInt(0) ? -cost : cost;
  // 백분율을 소수 2자리(× 100)까지 스케일해 반올림한다: gain / cost × 100 × 100.
  return fromScaledInt(roundedDiv(gain * BigInt(10000), absCost), 2);
}

/** 보유 자산 한 줄의 평가손익(평가액 − 취득원가, USD). */
export function holdingGainUsd(holding: Holding): string {
  return subtractDecimal(holding.valueUsd, holding.costUsd);
}

/** 토큰 보유 묶음의 평가액·취득원가·평가손익·수익률(표시용 합산). */
export interface HoldingsGainSummary {
  valueUsd: string;
  costUsd: string;
  gainUsd: string;
  returnPercent: string | null;
}

export function holdingsGainSummary(holdings: Holding[]): HoldingsGainSummary {
  const valueUsd = holdings.reduce((total, holding) => addDecimal(total, holding.valueUsd), "0");
  const costUsd = holdings.reduce((total, holding) => addDecimal(total, holding.costUsd), "0");
  const gainUsd = subtractDecimal(valueUsd, costUsd);
  return { valueUsd, costUsd, gainUsd, returnPercent: returnPercent(costUsd, gainUsd) };
}

/** 십진 문자열 비교(a<b:-1, a>b:1, 같음:0). */
export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(fractionLength(a), fractionLength(b));
  const left = toScaledInt(a, scale);
  const right = toScaledInt(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 보유 자산 전체 평가액 합(USD). */
export function totalValueUsd(holdings: Holding[]): string {
  return holdings.reduce((total, holding) => addDecimal(total, holding.valueUsd), "0");
}

// ── 데모 보유 자산 ───────────────────────────────────────────────────────────
// 이 앱은 목/데모 모드다. 지갑 홈은 ETH·USDT·USDC 세 자산을 데모 시세와 함께 보여준다.
// costUsd는 데모용 mock 취득 평가액(USD)이다. 실시간 원가 추적이 아니라, 평가손익·수익률을 화면이
// **표시만** 하도록 그럴듯한 값을 담는다: ETH는 이익, USDT는 소폭 손실, USDC는 소폭 이익.
const DEMO_TOKENS: ReadonlyArray<{ symbol: string; name: string; chainId: number; amount: string; priceUsd: string; costUsd: string }> = [
  { symbol: "ETH", name: "Ethereum", chainId: 1, amount: "0.75", priceUsd: "3200.00", costUsd: "1800.00" },
  { symbol: "USDT", name: "Tether USD", chainId: 137, amount: "850", priceUsd: "1.00", costUsd: "900.00" },
  { symbol: "USDC", name: "USD Coin", chainId: 8453, amount: "500", priceUsd: "1.00", costUsd: "480.00" },
];

/**
 * 지갑 홈에 표시할 데모 보유 자산. 평가액(=수량×단가) 기준 **내림차순**으로 정렬한다.
 * 동률이면 심볼 오름차순(코드포인트)으로 결정론적 순서를 보장한다.
 */
export function demoWalletHoldings(): Holding[] {
  return DEMO_TOKENS.map((token) => ({
    key: `${token.chainId}:${token.symbol}`,
    symbol: token.symbol,
    name: token.name,
    chainId: token.chainId,
    chainName: chainLabel(token.chainId),
    isNft: false,
    amount: token.amount,
    priceUsd: token.priceUsd,
    valueUsd: multiplyDecimal(token.amount, token.priceUsd),
    costUsd: token.costUsd,
  })).sort((left, right) => {
    const byValue = compareDecimal(right.valueUsd, left.valueUsd);
    if (byValue !== 0) return byValue;
    return left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0;
  });
}

// ── NFT 보유 ─────────────────────────────────────────────────────────────────

/** NFT 한 점(데모). 대중적인 컬렉션을 예시로 담되, 아트워크는 생성 플레이스홀더로 그린다(상표/저작권 보호). */
export interface NftHolding {
  key: string; // `${chainId}:${shortName}:${tokenId}`
  collection: string; // 컬렉션 전체 이름
  shortName: string; // 티커/약칭
  tokenId: string;
  chainId: number;
  chainName: string;
  floorUsd: string; // 데모 바닥가(USD)
  valueUsd: string; // = floorUsd (1점)
}

const DEMO_NFTS: ReadonlyArray<{ collection: string; shortName: string; tokenId: string; chainId: number; floorUsd: string }> = [
  { collection: "Bored Ape Yacht Club", shortName: "BAYC", tokenId: "4521", chainId: 1, floorUsd: "8000" },
  { collection: "Pudgy Penguins", shortName: "PPG", tokenId: "777", chainId: 1, floorUsd: "5200" },
  { collection: "Azuki", shortName: "AZUKI", tokenId: "1234", chainId: 1, floorUsd: "3100" },
  { collection: "Doodles", shortName: "DOODLE", tokenId: "88", chainId: 1, floorUsd: "1200" },
];

/** 지갑 홈 NFT 탭의 데모 보유 목록. 바닥가(USD) 내림차순 정렬. */
export function demoNftHoldings(): NftHolding[] {
  return DEMO_NFTS.map((nft) => ({
    key: `${nft.chainId}:${nft.shortName}:${nft.tokenId}`,
    collection: nft.collection,
    shortName: nft.shortName,
    tokenId: nft.tokenId,
    chainId: nft.chainId,
    chainName: chainLabel(nft.chainId),
    floorUsd: nft.floorUsd,
    valueUsd: nft.floorUsd,
  })).sort((left, right) => {
    const byValue = compareDecimal(right.valueUsd, left.valueUsd);
    if (byValue !== 0) return byValue;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
}

// ── 디파이 포지션 ────────────────────────────────────────────────────────────

export type DefiKind = "liquidity" | "staking" | "lending";

/** 디파이 포지션 한 개(데모). 프로토콜/유형/평가액을 담는다. */
export interface DefiPosition {
  key: string;
  protocol: string;
  kind: DefiKind;
  kindLabel: string; // 유동성 공급 / 스테이킹 / 예치
  asset: string; // "ETH / USDC" 등
  chainId: number;
  chainName: string;
  valueUsd: string;
  apy: string | null; // "3.2%" 등, 없으면 null
}

const DEFI_KIND_LABEL: Record<DefiKind, string> = {
  liquidity: "유동성 공급",
  staking: "스테이킹",
  lending: "예치",
};

const DEMO_DEFI: ReadonlyArray<{ protocol: string; kind: DefiKind; asset: string; chainId: number; valueUsd: string; apy: string | null }> = [
  { protocol: "Uniswap v3", kind: "liquidity", asset: "ETH / USDC", chainId: 1, valueUsd: "3200", apy: null },
  { protocol: "Lido", kind: "staking", asset: "stETH", chainId: 1, valueUsd: "2100", apy: "3.2%" },
  { protocol: "Aave v3", kind: "lending", asset: "USDC", chainId: 137, valueUsd: "1500", apy: "4.1%" },
];

/** 지갑 홈 디파이 탭의 데모 포지션. 평가액(USD) 내림차순 정렬. */
export function demoDefiPositions(): DefiPosition[] {
  return DEMO_DEFI.map((position) => ({
    key: `${position.chainId}:${position.protocol}:${position.asset}`,
    protocol: position.protocol,
    kind: position.kind,
    kindLabel: DEFI_KIND_LABEL[position.kind],
    asset: position.asset,
    chainId: position.chainId,
    chainName: chainLabel(position.chainId),
    valueUsd: position.valueUsd,
    apy: position.apy,
  })).sort((left, right) => {
    const byValue = compareDecimal(right.valueUsd, left.valueUsd);
    if (byValue !== 0) return byValue;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
}

/** 토큰·NFT·디파이 평가액을 합친 포트폴리오 총액(USD). */
export function portfolioTotalUsd(tokens: Holding[], nfts: NftHolding[], defi: DefiPosition[]): string {
  const all: Array<{ valueUsd: string }> = [...tokens, ...nfts, ...defi];
  return all.reduce((total, item) => addDecimal(total, item.valueUsd), "0");
}
