import type { Limitation, LimitationKind } from "@/lib/tax/types";

/**
 * 계산의 한계를 알리는 문구는 **생산자가 소유한다**.
 *
 * 화면이 한국어 산문을 정규식으로 찍어 분류하면, 문구를 한 글자 고치는 순간
 * 조용히 "영향 없음"으로 강등된다. 그래서 문구를 상수로 고정하고
 * 이 표 하나로만 분류한다. 표에 없는 문구는 숨기지 않고 `other`로 내보인다.
 */
export const LIMITATION_MESSAGE = {
  DUPLICATE_ID: "중복된 이벤트 id는 첫 건만 계산에 넘겼습니다.",
  INTERNAL_TRANSFER: "자기 지갑 간 이체(INTERNAL_TRANSFER)는 처분으로 보지 않았습니다.",
  ESTIMATED_PRICE: "추정가(ESTIMATED)로 평가된 이벤트가 포함되어 있습니다.",
  GAS_FEE: "가스비는 법정통화 환산 정보가 없어 취득원가·양도가액에 반영하지 않았습니다.",
  EXCHANGE_APPROXIMATION: "교환(EXCHANGE) 이벤트는 상대 자산 정보가 없어 피아트 처분으로 근사했습니다.",
} as const;

/** 제외 사유 문구. 사유가 여러 가지라 접두사만 고정한다. */
export const EXCLUSION_SUFFIX = " 상태인 이벤트는 계산에서 제외했습니다.";

/** 사유를 모른 채 id만 아는 제외의 고정 꼬리. */
export const EXCLUDED_ID_SUFFIX = " 확인이 필요해 계산에서 제외했습니다.";

/** 부인된 손실을 대체 취득분 원가에 반영하지 못했다는 경고의 고정 꼬리. */
export const DENIED_ACB_SUFFIX = " 대체 취득분 원가에 더하지 않았습니다 — 이후 처분 손익이 과대될 수 있습니다.";

/** 아직 팔지 않은 대체 취득분에 이연 원가가 남아 있다는 경고의 고정 꼬리. */
export const PENDING_ACB_SUFFIX = " 그 자산을 팔 때 반영됩니다.";

/** 원장에 없는 수량을 취득가액 0으로 계산했다는 경고의 고정 꼬리. */
export const ZERO_BASIS_SUFFIX = " 취득가액 0으로 계산했습니다.";

/**
 * 한국 의제취득가액(2026-12-31 시가)을 반영하지 못했다는 근사의 고정 꼬리.
 * 법정 취득가액은 Max(시가, 실제 취득가액)이므로, 실제 취득가액만 쓰면 손익이 과대될 수 있다.
 */
export const DEEMED_COST_SUFFIX = " 의제취득가액(2026-12-31 시가)을 확인하지 못해 실제 취득가액으로 계산했습니다 — 손익이 과대될 수 있습니다.";

/** 무상취득분 취득가액 규정이 없어 수령 시 FMV를 원가로 썼다는 근사의 고정 꼬리. */
export const RECEIPT_COST_SUFFIX = " 무상취득분 취득가액 규정이 없어 수령 시 FMV를 취득가액으로 계산했습니다 — 0원으로 보면 처분 시 과세분이 커집니다.";

/**
 * 거주자별 총평균법이 부분집계로 계산됐다는 근사의 고정 꼬리.
 * 총평균법은 그 거주자의 모든 출처(거래소·지갑)를 합산해야 하나, 아직 지갑 단위로만 통산해
 * 평균단가의 분모가 실제보다 작을 수 있다 — 예상 부담은 잠정치다.
 */
export const COST_METHOD_SUFFIX = " 거주자별 총평균법은 그 사람의 모든 출처를 합산해야 하나, 아직 지갑 단위로만 통산해 평균단가가 실제와 다를 수 있습니다 — 예상 부담은 잠정치입니다.";

/** 거래일 환율이 없어 계산에서 제외했다는 고정 꼬리(앞에는 이벤트 id). */
export const FX_RATE_SUFFIX = " 거래일 환율(ECB 기준)을 확인하지 못해 계산에서 제외했습니다.";

/**
 * 이벤트 통화를 룰셋 통화로 환산했다는 근사의 고정 꼬리(앞에는 "KRW → USD"처럼 통화쌍).
 * 세무 당국이 정한 환율·기준일(고시환율·월평균 등)과 다를 수 있으므로 근사로 분류한다.
 */
export const FX_CONVERSION_SUFFIX = " 금액은 거래일의 ECB 기준환율로 환산했습니다 — 세무 당국이 정한 환율·기준일과 다를 수 있습니다.";

/**
 * 답이 얼마나 흔들리는지의 순서.
 *
 * 숫자를 지어내지 않는다. 대신 **답에 어떻게 작용하는가**로만 줄을 세운다.
 * 1) 답에서 빠진 것 → 2) 답을 부풀릴 수 있는 것 → 3) 근사한 것 → 4) 반영하지 않은 것.
 */
export const LIMITATION_ORDER: LimitationKind[] = [
  "excluded",
  "zero_basis",
  "approximation",
  "not_reflected",
  "other",
];

const KIND_OF_MESSAGE = new Map<string, LimitationKind>([
  [LIMITATION_MESSAGE.DUPLICATE_ID, "not_reflected"],
  [LIMITATION_MESSAGE.INTERNAL_TRANSFER, "not_reflected"],
  [LIMITATION_MESSAGE.GAS_FEE, "not_reflected"],
  [LIMITATION_MESSAGE.ESTIMATED_PRICE, "approximation"],
  [LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION, "approximation"],
]);

/** 한 줄의 경고 문구를 종류로 분류한다. */
export function classifyLimitation(message: string): LimitationKind {
  const known = KIND_OF_MESSAGE.get(message);
  if (known) return known;
  if (message.endsWith(ZERO_BASIS_SUFFIX)) return "zero_basis";
  // 법정 취득가액·원가법을 그대로 쓰지 못하고 대체값으로 계산한 줄은 전부 근사다.
  if (
    message.endsWith(DEEMED_COST_SUFFIX) ||
    message.endsWith(RECEIPT_COST_SUFFIX) ||
    message.endsWith(COST_METHOD_SUFFIX) ||
    message.endsWith(FX_CONVERSION_SUFFIX)
  ) {
    return "approximation";
  }
  // 부인 손실의 원가 가산 누락은 "취득가액 0"이 아니라 "반영 안 함"이다.
  // zero_basis로 찍으면 화면 배지가 존재하지 않는 계산 사실을 말한다.
  if (message.endsWith(DENIED_ACB_SUFFIX) || message.endsWith(PENDING_ACB_SUFFIX)) return "not_reflected";
  if (message.endsWith(EXCLUSION_SUFFIX) || message.endsWith(EXCLUDED_ID_SUFFIX) || message.endsWith(FX_RATE_SUFFIX)) return "excluded";
  return "other";
}

/**
 * 문구 목록을 한계 행으로 바꾼다.
 *
 * **notes 전체를 넣으면 안 된다.** notes에는 "1년 초과 보유는 전액 비과세"처럼
 * 규칙이 어떻게 동작하는지를 설명하는 줄이 섞여 있고, 그건 한계가 아니다.
 * 계산이 못 한 일을 아는 생산자(원장·파생)만 이 함수를 부른다.
 */
export function toLimitations(messages: string[]): Limitation[] {
  // 이벤트가 특정되지 않는 문구다. 문장에서 id를 되뜯지 않고 빈 목록으로 못 박는다.
  return messages.map((message) => limitationOf(message, []));
}

/**
 * 한계 행을 만드는 유일한 입구.
 * 생산자가 kind를 직접 적으면 분류 정책이 바뀔 때 같은 문구가 경로에 따라 다른 종류가 된다.
 */
export function limitationOf(message: string, eventIds: string[]): Limitation {
  return { kind: classifyLimitation(message), message, eventIds };
}

/** 영향 순으로 줄을 세운다. 같은 순위 안에서는 들어온 순서를 지킨다. */
export function sortLimitations(rows: Limitation[]): Limitation[] {
  return [...rows].sort((a, b) => LIMITATION_ORDER.indexOf(a.kind) - LIMITATION_ORDER.indexOf(b.kind));
}
