import { z } from "zod";

import { nativeSymbol } from "@/lib/format";
import { classificationSchema } from "@/lib/schema/normalized-event";
import { normalizedEventSchema } from "@/lib/schema/normalized-event";
import { tolerantEventListSchema } from "@/lib/http/dto";
import type { EventDetailDTO, EventMutation } from "@/lib/http/dto";

/**
 * BE 이벤트 payload를 FE canonical 이벤트로 옮기는 transport 경계.
 *
 * BE(`indexer.adapters.ts`)는 `symbol` 키만 보내고 FE canonical 스키마는 `asset_symbol`/`asset_verified`/`asset_icon_url`을 기대한다.
 * zod object는 미지 키를 결과에 남기지 않으므로 **디코딩한 뒤 후처리로는 복구할 수 없다** — canonical 검증 앞단에서 옮겨야 한다.
 * OFF(mock) 모드 응답은 이미 canonical이므로 그대로 통과시켜 하나의 스키마로 양 모드를 덮는다.
 */
function toCanonical(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if ("asset_symbol" in obj) return obj;

  const beSymbol = typeof obj.symbol === "string" && obj.symbol.length > 0 ? obj.symbol : null;
  const chainId = typeof obj.chain_id === "number" ? obj.chain_id : null;
  const fallback = obj.asset_type === "NATIVE" && chainId !== null ? nativeSymbol(chainId) : null;

  return {
    ...obj,
    asset_symbol: beSymbol ?? fallback,
    // BE에는 토큰 화이트리스트 개념이 없다. 검증하지 않은 것을 검증됐다고 말하지 않는다.
    asset_verified: false,
    asset_icon_url: null,
  };
}

export const beNormalizedEventSchema = z.preprocess(toCanonical, normalizedEventSchema);

const beEventMutationShape = z.object({
  event: beNormalizedEventSchema,
  version: z.number().int().positive(),
});

export const beEventMutationSchema = beEventMutationShape as unknown as z.ZodType<EventMutation>;

// 항목 단위 파싱. 한 건이 계약을 벗어난다고 원장 전체를 잃지 않는다 — 버린 수는 화면이 고지한다.
export const beEventListSchema = tolerantEventListSchema(beEventMutationShape as unknown as z.ZodType<EventMutation>);

export const beEventDetailSchema = z.object({
  event: beNormalizedEventSchema,
  version: z.number().int().positive(),
  override_history: z.array(z.object({
    from: classificationSchema,
    to: classificationSchema,
    reason: z.string().nullable(),
    overridden_at: z.string().datetime(),
  })),
}) as unknown as z.ZodType<EventDetailDTO>;
