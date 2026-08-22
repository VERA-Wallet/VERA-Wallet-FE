import { z } from "zod";

const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const classificationSchema = z.enum([
  "RECEIVE",
  "SEND",
  "EXCHANGE",
  "INTERNAL_TRANSFER",
  "UNKNOWN",
]);

export const normalizedEventSchema = z
  .object({
    id: z.string().min(1),
    tx_hash: z.string().min(1),
    chain_id: z.number().int().positive(),
    log_index: z.number().int().nonnegative(),
    block_timestamp: z.string().datetime(),
    wallet_address: z.string().min(1),
    direction: z.enum(["IN", "OUT"]),
    asset_type: z.enum(["NATIVE", "ERC20", "ERC721", "ERC1155"]),
    asset_contract: z.string().nullable(),
    /**
     * 토큰 심볼. 메타데이터를 못 찾으면 null이고, 화면은 지어내지 않고 자산 타입으로 대체한다.
     * 네이티브 자산도 체인 심볼(ETH·POL)을 그대로 담는다.
     *
     * `default`는 **버전 스큐 방어**다. 이 칸을 모르는 옛 응답(배포 중인 구버전 서버,
     * 재시드되지 않은 dev 스토어)이 오면 목록 전체가 파싱에 실패해 "거래를 불러오지 못했습니다"가 된다.
     * 칸 하나가 비었다고 이력 전부를 못 보여주는 건 균형이 맞지 않는다 — 모른다고 읽고 그렇게 표시한다.
     */
    asset_symbol: z.string().min(1).nullable().default(null),
    /**
     * 토큰 목록으로 대조된 자산인가.
     * 심볼은 누구나 사칭할 수 있다("USDC"를 자칭하는 스팸 에어드랍). 심볼 한 칸만 두면
     * 화면이 사칭을 확인된 사실처럼 말하게 되므로 검증 여부를 따로 싣는다.
     *
     * 모르면 `false`다. 검증하지 않은 것을 검증됐다고 말하는 쪽이 훨씬 위험하다.
     */
    asset_verified: z.boolean().default(false),
    /**
     * 자산 로고 이미지. 메타데이터 출처가 주면 그대로 담고, 없으면 null이다.
     * 화면은 null이면 대체 마크를 그린다(`AssetMark`) — 로고를 지어내지 않는다.
     */
    asset_icon_url: z.string().min(1).nullable().default(null),
    token_id: z.string().nullable(),
    decimals: z.number().int().nonnegative(),
    raw_amount: decimalString,
    counterparty: z.string().min(1),
    gas_fee_native: decimalString,
    classification: classificationSchema,
    confidence: z.number().min(0).max(1),
    user_override: z
      .object({
        classification: classificationSchema,
        reason: z.string().nullable(),
        overridden_at: z.string().datetime(),
      })
      .nullable(),
    /**
     * 사용자가 직접 입력한 **금액 override**. 분류(user_override)와 분리한다 —
     * 재분류 없이 취득가·양도가만 채우거나, 반대로 분류만 고칠 수 있어야 한다.
     *
     * 이것이 "취득가 0원" 경고를 없애는 핵심 입력이다: 지갑 데이터로는 가격이 확정되지 않은
     * (price_status=UNKNOWN·fiat_value=null) 취득/처분이라도, 여기에 원화 금액을 채우면
     * `taxExclusionReason`이 계산 대상으로 인정하고 derive가 그 값을 cost/proceeds/fee에 싣는다.
     *
     * 전부 nullable + `default(null)`이다. 이 칸을 모르는 옛 응답(구버전 BE·재시드 전 dev 스토어)이
     * 와도 파싱이 깨지지 않는다(asset_symbol default 패턴과 동일한 버전 스큐 방어).
     */
    value_override: z
      .object({
        /** 취득가액(원화). 취득(RECEIVE) 이벤트의 원가를 확정한다. */
        acquisition_cost: decimalString.nullable().default(null),
        /** 양도가액(원화). 처분(SEND·EXCHANGE) 이벤트의 수취액을 확정한다. */
        disposal_value: decimalString.nullable().default(null),
        /** 부대비용(원화). 취득·양도 부대비용을 필요경비로 싣는다. */
        incidental_cost: decimalString.nullable().default(null),
        /** 가스비(원화). 네이티브 가스비를 법정통화로 환산해 필요경비에 싣는다. */
        gas_fee: decimalString.nullable().default(null),
        /** 가격 출처(거래소명·고시가 등). */
        price_source: z.string().min(1).nullable().default(null),
        /** 증빙 링크(거래내역·스크린샷 URL). */
        evidence_url: z.string().min(1).nullable().default(null),
        /**
         * 취득가 입증 곤란 시 "양도가액의 50%를 필요경비로" 의제한다.
         * 켜면 derive가 처분 원가를 proceeds × 0.5로 계산한다(acquisition_cost보다 우선).
         */
        deemed_expense_50: z.boolean().default(false),
        overridden_at: z.string().datetime(),
      })
      .nullable()
      .default(null),
    price_status: z.enum(["RESOLVED", "UNKNOWN", "ESTIMATED"]),
    fiat_value: decimalString.nullable(),
    fiat_currency: z.string().min(1),
  })
  .superRefine((event, ctx) => {
    if (event.price_status === "UNKNOWN" && event.fiat_value !== null) {
      ctx.addIssue({ code: "custom", path: ["fiat_value"], message: "UNKNOWN prices require a null fiat_value" });
    }
    if (event.price_status !== "UNKNOWN" && event.fiat_value === null) {
      ctx.addIssue({ code: "custom", path: ["fiat_value"], message: "Resolved prices require a fiat_value" });
    }
    // 심볼 없이 "검증됨"이라 말할 수 없다 — 무엇을 대조했다는 것인지 가리킬 대상이 없다.
    if (event.asset_verified && event.asset_symbol === null) {
      ctx.addIssue({ code: "custom", path: ["asset_symbol"], message: "Verified assets require a symbol" });
    }
  });

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type Classification = z.infer<typeof classificationSchema>;
/** 사용자가 입력한 금액 override(존재할 때의 형태). */
export type ValueOverride = NonNullable<NormalizedEvent["value_override"]>;
