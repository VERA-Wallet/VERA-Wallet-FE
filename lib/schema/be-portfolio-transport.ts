import { z } from "zod";

/**
 * BE `GET /api/portfolio/holdings` 응답의 전송 스키마(VERA-Wallet-BE docs/frontend-integration.md 7-1절).
 *
 * BE는 통화를 둘로 준다 — 시세·평가액은 USD, 취득원가는 원장 통화(KRW). FE 계약(`PortfolioHoldingsDTO`)은
 * 원가까지 USD로 통일하므로, 이 스키마는 FE 서버 어댑터가 환산하기 **전** 모양이다. 클라이언트는 이 모양을 보지 않는다.
 */
const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);
// BE는 DexScreener의 priceUsd 문자열을 검증만 하고 그대로 싣는다. 초소액 토큰은 "1.2e-9"처럼 지수 표기로 올 수 있어
// 여기서는 지수형까지 받고, 어댑터가 평문 십진으로 정규화한다(FE 십진 산술은 지수를 모른다).
const providerDecimalString = z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/);

export const beHoldingCostBasisSchema = z.object({
  currency: z.string().min(1),
  totalCost: decimalString,
  avgCost: decimalString,
  trackedAmount: decimalString,
});

export const beHoldingSchema = z.object({
  chainId: z.number().int(),
  assetType: z.enum(["NATIVE", "ERC20"]),
  contract: z.string().nullable(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().nonnegative(),
  rawAmount: z.string(),
  amount: decimalString,
  priceUsd: providerDecimalString.nullable(),
  valueUsd: decimalString.nullable(),
  priceStatus: z.enum(["priced", "illiquid", "no_market", "unknown"]),
  costBasis: beHoldingCostBasisSchema.nullable(),
});

/**
 * 행은 개별 파싱한다. `z.array(beHoldingSchema)`면 행 하나의 형식 오류가 응답 전체를 502로 만들어 ETH·USDC까지 사라진다.
 * 어댑터가 행마다 safeParse해 맞는 행만 남기고 버린 수를 `droppedCount`로 알린다.
 */
export const beHoldingsSchema = z.object({
  walletAddresses: z.array(z.string()),
  holdings: z.array(z.unknown()),
  skippedChainIds: z.array(z.number().int()),
  truncatedChainIds: z.array(z.number().int()),
  unresolvedCount: z.number().int().nonnegative(),
  totalValueUsd: decimalString,
  unpricedCount: z.number().int().nonnegative(),
  asOf: z.string(),
});

export type BeHoldingDTO = z.infer<typeof beHoldingSchema>;
export type BeHoldingsDTO = Omit<z.infer<typeof beHoldingsSchema>, "holdings"> & { holdings: BeHoldingDTO[] };

/** 행을 하나씩 검증해 맞는 것만 남긴다. 버린 수를 함께 돌려줘 호출자가 "n개를 표시하지 못했다"고 말하게 한다. */
export function parseBeHoldingRows(rows: readonly unknown[]): { holdings: BeHoldingDTO[]; dropped: number } {
  const holdings: BeHoldingDTO[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = beHoldingSchema.safeParse(row);
    if (parsed.success) holdings.push(parsed.data);
    else dropped += 1;
  }
  return { holdings, dropped };
}
