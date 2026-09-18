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
  // 로고 조회 키. 네이티브 코인은 컨트랙트가 없어 null이고, 그때는 체인으로 로고를 정한다.
  // 심볼은 위조 가능해 로고 키로 쓰지 않으므로, 캐노니컬 컨트랙트 주소를 함께 싣는다.
  contract: string | null;
  isNft: boolean;
  amount: string; // 사람이 읽는 수량(십진 문자열)
  priceUsd: string; // 단가(USD, 십진 문자열)
  valueUsd: string; // 평가액 = amount × priceUsd (USD, 십진 문자열)
  /**
   * 취득 평가액(USD, 십진 문자열). **모르면 null이다.**
   *
   * 온체인 잔액에는 원가가 없다 — 원가는 거래 이력과 원가법(FIFO/이동평균/…)에 달린 값이라
   * "지금 얼마나 들고 있나"만으로는 만들 수 없다. null이면 화면이 평가손익 줄 자체를 내린다.
   * 0을 넣으면 "전액이 이익"이라는 없던 주장이 생긴다.
   */
  costUsd: string | null;
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

/** 보유 자산 한 줄의 평가손익(평가액 − 취득원가, USD). 원가를 모르면 null이다. */
export function holdingGainUsd(holding: Holding): string | null {
  return holding.costUsd === null ? null : subtractDecimal(holding.valueUsd, holding.costUsd);
}

/** 토큰 보유 묶음의 평가액·취득원가·평가손익·수익률(표시용 합산). */
export interface HoldingsGainSummary {
  valueUsd: string;
  /** 한 줄이라도 원가를 모르면 묶음 원가도 null이다 — 아는 것만 더하면 손익이 과대해진다. */
  costUsd: string | null;
  gainUsd: string | null;
  returnPercent: string | null;
}

export function holdingsGainSummary(holdings: Holding[]): HoldingsGainSummary {
  const valueUsd = holdings.reduce((total, holding) => addDecimal(total, holding.valueUsd), "0");
  // 부분 합산은 하지 않는다. ETH 원가만 알고 USDC 원가를 모르는 채 더하면, 모르는 쪽 평가액이
  // 통째로 이익으로 잡혀 "+100%" 같은 숫자가 나온다. 하나라도 모르면 묶음 전체를 모른다고 말한다.
  if (holdings.some((holding) => holding.costUsd === null)) return { valueUsd, costUsd: null, gainUsd: null, returnPercent: null };
  const costUsd = holdings.reduce((total, holding) => addDecimal(total, holding.costUsd!), "0");
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
const DEMO_TOKENS: ReadonlyArray<{ symbol: string; name: string; chainId: number; contract: string | null; amount: string; priceUsd: string; costUsd: string }> = [
  { symbol: "ETH", name: "Ethereum", chainId: 1, contract: null, amount: "0.75", priceUsd: "3200.00", costUsd: "1800.00" },
  { symbol: "USDT", name: "Tether USD", chainId: 137, contract: "0xc2132d05d31c914a87c6611c10748aecb2540811", amount: "850", priceUsd: "1.00", costUsd: "900.00" },
  { symbol: "USDC", name: "USD Coin", chainId: 8453, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "500", priceUsd: "1.00", costUsd: "480.00" },
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
    contract: token.contract,
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

// ── 보유 체인 ────────────────────────────────────────────────────────────────

/** 자산이 실제로 놓여 있는 체인 하나. 불러오기 화면이 "무엇을 스캔하는가"를 이 목록으로 말한다. */
export interface WalletChain {
  chainId: number;
  chainName: string;
  /** 그 체인 위의 자산 건수(토큰·NFT·디파이 합). 왜 이 체인을 보는지가 숫자로 드러난다. */
  assetCount: number;
}

/**
 * 보유 자산에서 체인을 뽑는다. **잔액이 있는 체인만** 남으므로 쓰지도 않는 체인을 훑지 않는다.
 *
 * 불러오기 시점에 알 수 있는 것은 거래가 아니라 잔액이다(거래는 아직 가져오는 중이다).
 * 그래서 스캔 대상은 이벤트가 아니라 보유 자산에서 나온다 — 실제 인덱서의 순서와도 같다.
 *
 * 자산이 많은 체인부터. 동수면 chainId 오름차순으로 순서를 못 박는다.
 */
export function walletChains(tokens: Holding[], nfts: NftHolding[], defi: DefiPosition[]): WalletChain[] {
  const counts = new Map<number, number>();
  for (const item of [...tokens, ...nfts, ...defi]) {
    counts.set(item.chainId, (counts.get(item.chainId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([chainId, assetCount]) => ({ chainId, chainName: chainLabel(chainId), assetCount }))
    .sort((left, right) => right.assetCount - left.assetCount || left.chainId - right.chainId);
}

/** 데모 지갑이 자산을 들고 있는 체인. 지갑 홈이 그리는 것과 같은 소스에서 파생한다. */
export function demoWalletChains(): WalletChain[] {
  return walletChains(demoWalletHoldings(), demoNftHoldings(), demoDefiPositions());
}

// ── BE 응답 → 화면 모델 ──────────────────────────────────────────────────────

/**
 * `GET /api/wallet/holdings` 응답을 지갑 홈이 그리는 모양으로 옮긴다.
 *
 * 시세를 못 찾은 항목과 스팸은 목록에서 **뺀다**. 대신 몇 건인지 함께 돌려줘 화면이 그 사실을 말하게 한다 —
 * 지우는 게 아니라 접는 것이다. 시세 없는 줄을 "$0"으로 끼워 넣으면 평가액 합계와 정렬이 동시에 거짓이 된다.
 */
export function holdingsFromDto(dto: {
  holdings: ReadonlyArray<{ key: string; chainId: number; contract: string | null; symbol: string; name: string; amount: string; priceUsd: string | null; valueUsd: string | null; spam: boolean }>;
}): { tokens: Holding[]; unpricedCount: number; spamCount: number } {
  const tokens: Holding[] = [];
  let unpricedCount = 0;
  let spamCount = 0;
  for (const item of dto.holdings) {
    if (item.spam) { spamCount += 1; continue; }
    if (item.priceUsd === null || item.valueUsd === null) { unpricedCount += 1; continue; }
    tokens.push({
      key: item.key,
      symbol: item.symbol,
      name: item.name,
      chainId: item.chainId,
      chainName: chainLabel(item.chainId),
      contract: item.contract,
      isNft: false,
      amount: item.amount,
      priceUsd: item.priceUsd,
      valueUsd: item.valueUsd,
      // 온체인 잔액에는 취득원가가 없다. 거래 이력 원장과 연결되기 전까지 화면은 평가손익을 말하지 않는다.
      costUsd: null,
    });
  }
  return { tokens, unpricedCount, spamCount };
}
