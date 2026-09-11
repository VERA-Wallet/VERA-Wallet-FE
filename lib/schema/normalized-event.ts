import { z } from "zod";

import type { IncomeKind } from "@/lib/tax/types";

const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const classificationSchema = z.enum([
  "RECEIVE",
  "SEND",
  "EXCHANGE",
  "INTERNAL_TRANSFER",
  "UNKNOWN",
  /**
   * 더스트·에어드랍 스팸. 파이프라인이 태그만 하고 **지우지는 않는다**(오탐이면 되돌릴 수 있어야 한다).
   * 원장·계산·확인 필요 큐에서는 빠지고 건수로만 고지된다 — `lib/review.ts`의 `isSpam` 참고.
   */
  "SPAM",
]);

/**
 * **수신 전용** 분류 스키마. 모르는 값이 오면 거절하지 않고 `UNKNOWN`으로 강등한다.
 *
 * 이 파일은 이미 `asset_symbol`·`value_override`·`income_kind`에 `default`를 둬서
 * "칸 하나가 비었다고 이력 전부를 못 보여주는 건 균형이 맞지 않는다"는 원칙을 지키는데,
 * enum에는 그 방어가 없었다. 서버가 분류를 하나 추가하는 순간(SPAM이 그랬다) 목록 전체가
 * 파싱에 실패해 거래를 한 건도 못 보게 된다 — 모르는 분류 하나 때문에 원장을 통째로 잃는 건
 * 균형이 맞지 않는다. 모른다고 읽고 화면이 그렇게 말하게 한다(UNKNOWN은 확인 필요로 뜬다).
 *
 * **송신 요청에는 쓰지 않는다.** `reclassifyRequestSchema`는 엄격한 `classificationSchema`를 쓴다 —
 * 나가는 값까지 강등하면 사용자가 고른 적 없는 분류를 서버에 저장하게 된다.
 */
export const incomingClassificationSchema = classificationSchema.catch("UNKNOWN");

/**
 * 수령분(INCOME)의 소득 종류. `lib/tax/types.ts`의 `IncomeKind`가 단일 진실 원천이며,
 * `satisfies`로 그 유니온을 벗어난 값이 섞이면 컴파일 타임에 잡는다.
 */
const INCOME_KINDS = [
  "STAKING",
  "LENDING",
  "AIRDROP",
  "AIRDROP_INITIAL",
  "MINING",
  "DEFI_REWARD",
] as const satisfies readonly IncomeKind[];

export const incomeKindSchema = z.enum(INCOME_KINDS);

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
    /**
     * 상대 주소의 표시 이름. BE가 자기 레지스트리(브릿지·애그리게이터 컨트랙트)에서 확인한 주소에만 붙인다.
     * 화면은 이 값을 먼저 쓰고, 없으면 FE mock 레지스트리(lib/contracts.ts), 그것도 없으면 축약 주소다 — 지어내지 않는다.
     */
    counterparty_label: z.string().min(1).nullable().optional(),
    gas_fee_native: decimalString,
    // 수신 값이라 모르는 분류는 UNKNOWN으로 강등한다(위 incomingClassificationSchema 주석 참고).
    classification: incomingClassificationSchema,
    confidence: z.number().min(0).max(1),
    user_override: z
      .object({
        classification: incomingClassificationSchema,
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
    /**
     * DeFi 수익(수령분) 종류. 값이 있으면 이 취득(RECEIVE·IN)은 매수가 아니라 **소득 수령**이며,
     * derive가 ACQUIRE 대신 INCOME 세무 이벤트로 매핑한다(fmv = 원화 평가액).
     * null이면 종래대로 취득으로 본다.
     *
     * `default(null)`은 **버전 스큐 방어**다. 이 칸을 모르는 옛 응답(구버전 BE·재시드 전 dev 스토어)이
     * 와도 파싱이 깨지지 않는다(asset_symbol·value_override default 패턴과 동일).
     */
    income_kind: incomeKindSchema.nullable().default(null),
    /**
     * **스왑 페어링 키**(서버 발급). 하나의 스왑을 이루는 처분(OUT·EXCHANGE) leg와
     * 취득(IN·RECEIVE) leg가 **동일한 값**을 가진다. 목록·상세는 이 값이 같은 leg끼리 한 행으로
     * 묶는다 — tx_hash·leg 개수(정확히 2건) 휴리스틱을 대체한다. **불투명 문자열**로 다루고
     * 파싱하지 않는다: 현재 서버 파생식은 `chain:txHash`지만 향후 브릿지·수수료 등 다중 leg
     * 액션이 같은 필드를 다른 파생식(한 tx에 1:1로 대응하지 않는)으로 재사용한다. 페어링 대상이
     * 아닌 leg(순수 송·수신·스팸)에는 null이다.
     * `default(null)`은 이 칸을 모르는 옛 응답에도 파싱이 깨지지 않게 하는 버전 스큐 방어다.
     */
    group_id: z.string().min(1).nullable().default(null),
    /**
     * **스왑(EXCHANGE)에서 받은 상대 자산의 심볼** — 목록에서 "무엇을 무엇으로 바꿨나"를
     * 두 로고로 보이기 위한 **표시 힌트**다(계산에는 쓰지 않는다 — EXCHANGE 손익은 여전히
     * 피아트 처분으로 근사한다). 지갑 데이터에 상대 자산이 잡히기 전까지는 null이고,
     * 그때 목록은 종래대로 단일 로고로 그린다. `default(null)`은 이 칸을 모르는 옛 응답에도
     * 파싱이 깨지지 않게 하는 버전 스큐 방어다(asset_symbol 패턴과 동일).
     */
    swap_to_symbol: z.string().min(1).nullable().default(null),
    /** 스왑 상대 자산의 로고. 없으면 null이고 화면은 대체 마크(심볼 이니셜)로 그린다. */
    swap_to_icon_url: z.string().min(1).nullable().default(null),
    /**
     * **브릿지(크로스체인 이동)의 도착 체인 id** — 이동이 어느 체인으로 갔는지를 목록에서
     * 두 체인 배지로 보이기 위한 **표시 힌트**다. 한 이벤트는 출발 체인(chain_id)만 담으므로
     * 도착 체인은 별도로 싣는다. null이면 단일 체인 이동으로 보고 종래대로 그린다.
     * 계산에는 영향이 없다(INTERNAL_TRANSFER는 처분이 아니다).
     */
    bridge_dest_chain_id: z.number().int().positive().nullable().default(null),
    /**
     * 브릿지 페어링 키(서버 발급). 하나의 크로스체인 이동을 이루는 출발 체인의 leg와 도착 체인의
     * leg가 동일한 값을 가진다. 스왑(group_id)과 달리 두 leg는 tx_hash도 체인도 달라서, 이 키가
     * 유일한 연결고리다. 서버가 도착 IN을 자기 지갑으로 확인해 양쪽을 INTERNAL_TRANSFER(비과세
     * 자기이동)로 만들 때만 찍힌다. 불투명 문자열로 다룬다. `default(null)`은 이 칸을 모르는 옛
     * 응답에도 파싱이 깨지지 않게 하는 버전 스큐 방어다.
     */
    bridge_group_id: z.string().min(1).nullable().default(null),
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
    // 수익 수령은 자산이 지갑으로 들어오는 흐름이다. 나가는(OUT) 이벤트에 income_kind가 붙으면
    // derive가 취득으로 볼지 소득으로 볼지 모순되므로 원본 결함으로 잡는다.
    if (event.income_kind !== null && event.direction !== "IN") {
      ctx.addIssue({ code: "custom", path: ["income_kind"], message: "income_kind requires direction IN" });
    }
  });

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type Classification = z.infer<typeof classificationSchema>;
/** 사용자가 입력한 금액 override(존재할 때의 형태). */
export type ValueOverride = NonNullable<NormalizedEvent["value_override"]>;
