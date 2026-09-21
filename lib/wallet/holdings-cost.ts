import type { HoldingCostStatus, PortfolioHoldingDTO, PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { BeHoldingDTO, BeHoldingsDTO } from "@/lib/schema/be-portfolio-transport";
import { abs, div, lt, mul, round, sub, type Decimal } from "@/lib/tax/decimal";

/** 화면 통화. 이 앱은 원화만 말한다. BE 시세(USD)는 여기서 원화로 옮긴다. */
export const DISPLAY_CURRENCY = "KRW";

/** 단가의 소수 자릿수. 초소액 토큰(달러 기준 1e-9)은 원화로도 소수 여섯째 자리에서야 유효숫자가 나온다. */
export const PRICE_KRW_DP = 8;

/**
 * 원장이 아는 수량과 온체인 잔액의 상대 오차가 이 안이면 "전량 원가를 안다"(ready)로 본다.
 * 온체인 잔액은 wei 단위 정확값이고 원장 수량은 별도 fold라 완전 일치는 거의 없다. 인덱서가 놓친 내부 거래 한 건,
 * 가스 반올림, 자기 전송 한 번이면 wei가 어긋난다. 완전 일치를 요구하면 실지갑에서 손익이 늘 사라진다.
 */
export const COST_COVERAGE_TOLERANCE = "0.005";

/**
 * 환산에 쓰는 환율. 모두 **오늘** 것이다(원장에 취득일별 lot이 없어 합계를 한 번에 환산한다).
 * - `usdKrw`: USD 1단위당 KRW. 시세·평가액·총액에 쓴다. 이것이 없으면 이 화면은 답을 낼 수 없으므로 호출자가 조회 자체를 실패시킨다.
 * - `costKrwPer`: 원가 통화 1단위당 KRW. 원장 통화가 KRW면 표가 필요 없고, 표에 없는 통화의 원가는 `fx_unavailable`이다.
 */
export type HoldingsFx = {
  day: string;
  usdKrw: Decimal;
  costKrwPer: ReadonlyMap<string, Decimal>;
};

/**
 * 원화 금액의 반올림. 1원 이상은 원 단위로 끊는다(관례). 1원 미만은 소수 둘째 자리까지 남긴다.
 * 잔액이 있는 토큰을 ₩0으로 지우면 값을 숨긴 것이기 때문이다(format.test의 같은 원칙).
 */
export function roundKrw(value: Decimal): Decimal {
  return lt(abs(value), "1") ? round(value, 2) : round(value, 0);
}

/**
 * BE 보유 자산(시세 USD, 원가는 원장 통화 KRW)을 FE 계약(전부 KRW)으로 옮긴다. 순수 함수다. 환율은 호출자가 넘긴다.
 *
 * - 시세·평가액·총액은 `usdKrw`로 옮긴다. 세금 엔진은 거래일 환율로 이벤트마다 환산하므로 두 화면의 원화는 환율 변동만큼
 *   다를 수 있다. 화면이 이 사실을 말한다(`fx`).
 * - 원가는 원장 통화가 KRW라 그대로다. 다른 통화면 `costKrwPer`로 옮기고, 표에 없으면 `fx_unavailable`이다. 0으로 그리지 않는다.
 * - `trackedAmount`가 잔액을 허용 오차 밖에서 벗어나면 partial: 원장이 잔액을 다 설명하지 못한다(불러오기 중이거나 이벤트 누락).
 */
export function toPortfolioHoldings(be: BeHoldingsDTO, fx: HoldingsFx, droppedCount = 0): PortfolioHoldingsDTO {
  return {
    walletAddresses: be.walletAddresses,
    byWallet: be.byWallet.map((wallet) => ({
      address: wallet.address,
      verificationMethod: wallet.verificationMethod,
      totalValueKrw: roundKrw(mul(wallet.totalValueUsd, fx.usdKrw)),
      chainIds: wallet.chainIds,
      holdingsCount: wallet.holdingsCount,
      unpricedCount: wallet.unpricedCount,
    })),
    holdings: be.holdings.map((holding) => toPortfolioHolding(holding, fx)),
    skippedChainIds: be.skippedChainIds,
    truncatedChainIds: be.truncatedChainIds,
    unresolvedCount: be.unresolvedCount,
    droppedCount,
    totalValueKrw: roundKrw(mul(be.totalValueUsd, fx.usdKrw)),
    unpricedCount: be.unpricedCount,
    asOf: be.asOf,
    fx: { usdKrw: fx.usdKrw, day: fx.day },
  };
}

function toPortfolioHolding(holding: BeHoldingDTO, fx: HoldingsFx): PortfolioHoldingDTO {
  const priceUsd = holding.priceUsd === null ? null : normalizeDecimal(holding.priceUsd);
  const base = {
    chainId: holding.chainId,
    assetType: holding.assetType,
    contract: holding.contract,
    symbol: holding.symbol,
    name: holding.name,
    decimals: holding.decimals,
    amount: holding.amount,
    priceKrw: priceUsd === null ? null : round(mul(priceUsd, fx.usdKrw), PRICE_KRW_DP),
    valueKrw: holding.valueUsd === null ? null : roundKrw(mul(holding.valueUsd, fx.usdKrw)),
    priceStatus: holding.priceStatus,
    canonicalAssetId: holding.canonicalAssetId ?? null,
  };
  const cost = holding.costBasis;
  if (cost === null) return { ...base, costKrw: null, costStatus: "unknown", trackedAmount: null };

  const coverage = coverageOf(cost.trackedAmount, holding.amount);
  // ready면 원가는 "잔액 전량 × 평균 단가"다. 원장 수량이 wei 몇 개 어긋난 채 totalCost를 그대로 쓰면 그 오차만큼 원가가 빠진다.
  // partial이면 원장이 아는 수량의 원가(totalCost)를 그대로 싣고, 화면은 그 원가로 손익을 내지 않는다.
  const costInLedgerCurrency = coverage === "ready" ? mul(cost.avgCost, holding.amount) : cost.totalCost;
  const rate = cost.currency === DISPLAY_CURRENCY ? "1" : fx.costKrwPer.get(cost.currency);
  if (rate === undefined) return { ...base, costKrw: null, costStatus: "fx_unavailable", trackedAmount: cost.trackedAmount };
  return { ...base, costKrw: roundKrw(mul(costInLedgerCurrency, rate)), costStatus: coverage, trackedAmount: cost.trackedAmount };
}

/** 원장 수량이 잔액을 허용 오차 안에서 덮으면 ready, 아니면 partial. 잔액이 0이면 비교할 기준이 없어 partial. */
export function coverageOf(trackedAmount: string, amount: string): Extract<HoldingCostStatus, "ready" | "partial"> {
  if (amount === "0") return "partial";
  const relativeGap = div(abs(sub(trackedAmount, amount)), amount);
  return lt(relativeGap, COST_COVERAGE_TOLERANCE) ? "ready" : "partial";
}

/**
 * 지수 표기("1.2e-9")를 평문 십진 문자열로 편다. FE 십진 산술(BigInt 기반)은 지수를 모른다.
 * 이미 평문이면 그대로 돌려준다.
 */
export function normalizeDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([-+]?\d+)$/.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction = "", exponentRaw] = match;
  const exponent = Number(exponentRaw);
  // 소수점 위치를 계산해 자릿수를 옮긴다.
  const allDigits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  let plain: string;
  if (point <= 0) plain = `0.${"0".repeat(-point)}${allDigits}`;
  else if (point >= allDigits.length) plain = `${allDigits}${"0".repeat(point - allDigits.length)}`;
  else plain = `${allDigits.slice(0, point)}.${allDigits.slice(point)}`;
  plain = plain.replace(/^0+(?=\d)/, "");
  if (plain.includes(".")) plain = plain.replace(/0+$/, "").replace(/\.$/, "");
  return `${sign}${plain}`;
}

/** BE가 원가를 표기한 통화들 가운데 KRW가 아닌 것. 환율을 어느 통화에서 가져올지 정한다. 원장 통화가 KRW인 지금은 비어 있다. */
export function costCurrenciesNeedingFx(be: BeHoldingsDTO): string[] {
  const currencies = new Set<string>();
  for (const holding of be.holdings) {
    if (holding.costBasis !== null && holding.costBasis.currency !== DISPLAY_CURRENCY) currencies.add(holding.costBasis.currency);
  }
  return [...currencies];
}
