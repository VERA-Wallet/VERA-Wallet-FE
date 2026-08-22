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
export type EventListDTO = { items: EventMutation[]; nextCursor: string | null };
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

export const eventListSchema: z.ZodType<EventListDTO> = z.object({
  items: z.array(eventMutationSchema),
  nextCursor: z.string().nullable(),
});

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
