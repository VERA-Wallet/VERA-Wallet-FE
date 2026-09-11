import type { HoldingCostStatus, PortfolioHoldingDTO, PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { FxRateTable } from "@/lib/ports/fx-rate";
import type { BeHoldingDTO, BeHoldingsDTO } from "@/lib/schema/be-portfolio-transport";
import { abs, div, lt, mul, round, sub } from "@/lib/tax/decimal";

/** 환산한 원가의 소수 자릿수. 표시는 센트까지지만 수익률 계산이 잘리지 않게 넉넉히 둔다. */
export const COST_USD_DP = 8;

/**
 * 원장이 아는 수량과 온체인 잔액의 상대 오차가 이 안이면 "전량 원가를 안다"(ready)로 본다.
 * 온체인 잔액은 wei 단위 정확값이고 원장 수량은 별도 fold라 완전 일치는 거의 없다 — 인덱서가 놓친 내부 거래 한 건,
 * 가스 반올림, 자기 전송 한 번이면 wei가 어긋난다. 완전 일치를 요구하면 실지갑에서 손익이 늘 사라진다.
 */
export const COST_COVERAGE_TOLERANCE = "0.005";

/**
 * BE 보유 자산(원가는 원장 통화)을 FE 계약(원가까지 USD)으로 옮긴다. 순수 함수 — 환율은 호출자가 넘긴다.
 *
 * - `rates`가 null이면 환율 소스가 응답하지 않은 것이다. 원가가 있는 자산은 `fx_unavailable`로 표시되고
 *   costUsd는 null이다. 환율이 없다고 원가를 0으로 그리지 않는다.
 * - 원가 통화가 이미 USD면 환율 없이 그대로 쓴다.
 * - `trackedAmount`가 잔액을 허용 오차 밖에서 벗어나면 partial: 원장이 잔액을 다 설명하지 못한다(불러오기 중이거나 이벤트 누락).
 * - 환율은 **오늘** 것이다. 세금 엔진은 거래일 환율로 이벤트마다 환산하므로 두 화면의 원가는 환율 변동만큼 다를 수 있다.
 *   원장에 취득일별 lot이 없어 여기서는 합계를 한 번에 환산한다. 화면이 이 사실을 말한다.
 */
export function toPortfolioHoldings(be: BeHoldingsDTO, rates: { table: FxRateTable; day: string } | null, droppedCount = 0): PortfolioHoldingsDTO {
  return {
    walletAddresses: be.walletAddresses,
    holdings: be.holdings.map((holding) => toPortfolioHolding(holding, rates)),
    skippedChainIds: be.skippedChainIds,
    truncatedChainIds: be.truncatedChainIds,
    unresolvedCount: be.unresolvedCount,
    droppedCount,
    totalValueUsd: be.totalValueUsd,
    unpricedCount: be.unpricedCount,
    asOf: be.asOf,
  };
}

function toPortfolioHolding(holding: BeHoldingDTO, rates: { table: FxRateTable; day: string } | null): PortfolioHoldingDTO {
  const base = {
    chainId: holding.chainId,
    assetType: holding.assetType,
    contract: holding.contract,
    symbol: holding.symbol,
    name: holding.name,
    decimals: holding.decimals,
    amount: holding.amount,
    priceUsd: holding.priceUsd === null ? null : normalizeDecimal(holding.priceUsd),
    valueUsd: holding.valueUsd,
    priceStatus: holding.priceStatus,
  };
  const cost = holding.costBasis;
  if (cost === null) return { ...base, costUsd: null, costStatus: "unknown", trackedAmount: null };

  const coverage = coverageOf(cost.trackedAmount, holding.amount);
  // ready면 원가는 "잔액 전량 × 평균 단가"다. 원장 수량이 wei 몇 개 어긋난 채 totalCost를 그대로 쓰면 그 오차만큼 원가가 빠진다.
  // partial이면 원장이 아는 수량의 원가(totalCost)를 그대로 싣고, 화면은 그 원가로 손익을 내지 않는다.
  const costInLedgerCurrency = coverage === "ready" ? mul(cost.avgCost, holding.amount) : cost.totalCost;
  if (cost.currency === "USD") return { ...base, costUsd: round(costInLedgerCurrency, COST_USD_DP), costStatus: coverage, trackedAmount: cost.trackedAmount };

  const rate = rates?.table.get(rates.day);
  if (rate === undefined) return { ...base, costUsd: null, costStatus: "fx_unavailable", trackedAmount: cost.trackedAmount };
  return { ...base, costUsd: round(mul(costInLedgerCurrency, rate), COST_USD_DP), costStatus: coverage, trackedAmount: cost.trackedAmount };
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

/** BE가 원가를 표기한 통화들(USD 제외). 환율을 어느 통화에서 가져올지 정한다. 지금은 KRW 하나다. */
export function costCurrenciesNeedingFx(be: BeHoldingsDTO): string[] {
  const currencies = new Set<string>();
  for (const holding of be.holdings) {
    if (holding.costBasis !== null && holding.costBasis.currency !== "USD") currencies.add(holding.costBasis.currency);
  }
  return [...currencies];
}
