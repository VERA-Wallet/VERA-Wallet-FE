import { z } from "zod";

import { classificationSchema, normalizedEventSchema } from "@/lib/schema/normalized-event";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";

export type EventMutation = { event: NormalizedEvent; version: number };
export type OverrideTransition = {
  from: Classification;
  to: Classification;
  reason: string | null;
  overridden_at: string;
};
export type EventDetailDTO = EventMutation & { override_history: OverrideTransition[] };
export type EventListDTO = {
  items: EventMutation[];
  nextCursor: string | null;
  /**
   * 형식이 맞지 않아 이 페이지에서 버린 항목 수. 화면이 "몇 건이 빠졌다"를 말할 수 있어야 한다 —
   * 조용히 버리면 목록이 완전한 것처럼 보이면서 거래가 사라진다. 선택 필드인 이유는 이미 canonical인
   * mock 경로가 이 값을 만들지 않아도 되게 하기 위함이다(없으면 버린 것이 없다는 뜻).
   */
  dropped?: number;
};
export type ReclassifyRequestDTO = {
  classification: Classification;
  reason?: string;
  expectedVersion: number;
};
/**
 * 사용자가 입력한 금액 override. overridden_at은 서버가 찍는다.
 * 각 칸 미지정(undefined)은 "비움"(null)과 같게 저장한다. value_override 전체를 null로 보내면 override를 제거한다.
 */
export type ValueOverrideInput = {
  acquisition_cost?: string | null;
  disposal_value?: string | null;
  incidental_cost?: string | null;
  gas_fee?: string | null;
  price_source?: string | null;
  evidence_url?: string | null;
  deemed_expense_50?: boolean;
};
export type SetValueOverrideRequestDTO = {
  value_override: ValueOverrideInput | null;
  expectedVersion: number;
};
export type SummaryDTO = {
  periodPnl: string;
  /**
   * 손익·과세 대상 계산에 실제로 들어간 이벤트 수.
   * 0이면 `periodPnl`의 "0"은 계산된 손익이 아니라 **계산할 것이 없었다**는 뜻이다.
   */
  computableEventCount: number;
  taxableEventCount: number;
  pendingReviewCount: number;
  currency: string;
  period: { from: string; to: string };
};

const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const eventMutationSchema: z.ZodType<EventMutation> = z.object({
  event: normalizedEventSchema,
  version: z.number().int().positive(),
});

export const overrideTransitionSchema: z.ZodType<OverrideTransition> = z.object({
  from: classificationSchema,
  to: classificationSchema,
  reason: z.string().nullable(),
  overridden_at: z.string().datetime(),
});

export const eventDetailSchema: z.ZodType<EventDetailDTO> = z.object({
  event: normalizedEventSchema,
  version: z.number().int().positive(),
  override_history: z.array(overrideTransitionSchema),
});

/**
 * 목록을 **항목 단위로** 파싱한다. `z.array(itemSchema)`는 전부 아니면 전무라, 한 건이 계약을 벗어나면
 * 배열 전체가 실패해 거래를 한 건도 못 보게 된다. 실제로 서버가 분류를 하나 추가했을 때 그 일이 일어났다.
 *
 * 그렇다고 조용히 버리면 목록이 완전한 것처럼 보이면서 거래가 사라진다 — 그래서 버린 수를 함께 돌려주고
 * 화면이 그 사실을 말한다. 이 파일이 이미 지키는 원칙과 같다: 모르면 모른다고 하되, 아는 것까지 버리지 않는다.
 */
export function tolerantEventListSchema(itemSchema: z.ZodType<EventMutation>): z.ZodType<EventListDTO> {
  return z
    .object({ items: z.array(z.unknown()), nextCursor: z.string().nullable() })
    .transform(({ items, nextCursor }) => {
      const parsed: EventMutation[] = [];
      let dropped = 0;
      for (const raw of items) {
        const result = itemSchema.safeParse(raw);
        if (result.success) parsed.push(result.data);
        else dropped += 1;
      }
      return { items: parsed, nextCursor, dropped };
    }) as unknown as z.ZodType<EventListDTO>;
}

export const eventListSchema: z.ZodType<EventListDTO> = tolerantEventListSchema(eventMutationSchema);

export const summarySchema: z.ZodType<SummaryDTO> = z.object({
  periodPnl: decimalString,
  computableEventCount: z.number().int().nonnegative(),
  taxableEventCount: z.number().int().nonnegative(),
  pendingReviewCount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  period: z.object({ from: z.string(), to: z.string() }),
});

export const reclassifyRequestSchema: z.ZodType<ReclassifyRequestDTO> = z.object({
  classification: classificationSchema,
  reason: z.string().optional(),
  expectedVersion: z.number().int().positive(),
});

const valueOverrideInputSchema = z.object({
  acquisition_cost: decimalString.nullable().optional(),
  disposal_value: decimalString.nullable().optional(),
  incidental_cost: decimalString.nullable().optional(),
  gas_fee: decimalString.nullable().optional(),
  price_source: z.string().min(1).nullable().optional(),
  evidence_url: z.string().min(1).nullable().optional(),
  deemed_expense_50: z.boolean().optional(),
});

export const setValueOverrideRequestSchema: z.ZodType<SetValueOverrideRequestDTO> = z.object({
  value_override: valueOverrideInputSchema.nullable(),
  expectedVersion: z.number().int().positive(),
});

// ── 포트폴리오(보유 자산) ────────────────────────────────────────────────────

export type HoldingPriceStatus = "priced" | "illiquid" | "no_market" | "unknown";
/**
 * 취득원가의 상태. 원가는 원장(인덱싱된 이벤트)의 이동평균이고 시세는 현재 스팟이라 출처가 다르다.
 * - ready: 원장이 잔액 전량의 원가를 안다.
 * - partial: 원장이 아는 수량(`trackedAmount`)이 잔액과 다르다 — 불러오기 중이거나 이벤트가 빠졌다.
 * - unknown: 원장이 이 자산을 모른다.
 * - fx_unavailable: 원가는 있는데(원장 통화) 환율 소스가 응답하지 않아 USD로 옮기지 못했다.
 */
export type HoldingCostStatus = "ready" | "partial" | "unknown" | "fx_unavailable";

export type PortfolioHoldingDTO = {
  chainId: number;
  assetType: "NATIVE" | "ERC20";
  /** 소문자 컨트랙트. 네이티브 코인은 null. */
  contract: string | null;
  symbol: string;
  name: string;
  decimals: number;
  /** 사람이 읽는 수량(십진 문자열, 반올림 없음). */
  amount: string;
  priceUsd: string | null;
  valueUsd: string | null;
  priceStatus: HoldingPriceStatus;
  /** USD로 환산한 취득원가. `costStatus`가 ready·partial일 때만 값이 있다. */
  costUsd: string | null;
  costStatus: HoldingCostStatus;
  /** 원장이 원가를 아는 수량. `amount`와 다르면 partial. */
  trackedAmount: string | null;
};

export type PortfolioHoldingsDTO = {
  walletAddresses: string[];
  holdings: PortfolioHoldingDTO[];
  /** 읽지 못한 체인. 그 체인 자산은 없는 게 아니라 모르는 것이다. */
  skippedChainIds: number[];
  /** 토큰 목록이 상한에 걸려 일부를 생략한 체인. */
  truncatedChainIds: number[];
  /** 메타데이터 조회 실패로 빠진 토큰 수. 0보다 크면 목록이 불완전하다. */
  unresolvedCount: number;
  /** 형식이 맞지 않아 FE가 버린 행 수. 조용히 버리면 목록이 완전한 것처럼 보이면서 자산이 사라진다(이벤트 목록의 `dropped`와 같은 이유). */
  droppedCount: number;
  /** 시세가 있는 보유분의 USD 합. 시세 없는 자산은 0이 아니라 빠져 있다. */
  totalValueUsd: string;
  unpricedCount: number;
  asOf: string;
};

const nullableDecimalString = decimalString.nullable();

export const portfolioHoldingSchema: z.ZodType<PortfolioHoldingDTO> = z.object({
  chainId: z.number().int(),
  assetType: z.enum(["NATIVE", "ERC20"]),
  contract: z.string().nullable(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().nonnegative(),
  amount: decimalString,
  priceUsd: nullableDecimalString,
  valueUsd: nullableDecimalString,
  priceStatus: z.enum(["priced", "illiquid", "no_market", "unknown"]),
  costUsd: nullableDecimalString,
  costStatus: z.enum(["ready", "partial", "unknown", "fx_unavailable"]),
  trackedAmount: nullableDecimalString,
});

export const portfolioHoldingsSchema: z.ZodType<PortfolioHoldingsDTO> = z.object({
  walletAddresses: z.array(z.string()),
  holdings: z.array(portfolioHoldingSchema),
  skippedChainIds: z.array(z.number().int()),
  truncatedChainIds: z.array(z.number().int()),
  unresolvedCount: z.number().int().nonnegative(),
  droppedCount: z.number().int().nonnegative(),
  totalValueUsd: decimalString,
  unpricedCount: z.number().int().nonnegative(),
  asOf: z.string(),
});
