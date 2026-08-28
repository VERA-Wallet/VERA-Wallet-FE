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
