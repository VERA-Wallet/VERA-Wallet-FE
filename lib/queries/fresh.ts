/**
 * "지금 것인가" 게이트.
 *
 * React Query는 재조회 중에도, 심지어 쿼리가 비활성일 때도 이전 `data`를 그대로 노출한다.
 * 그 자체는 깜빡임을 막는 좋은 기본값이지만, 화면이 그 값을 **최신 사실인 것처럼 단정**하면 거짓이 된다.
 * 실제로 그랬다: 분류를 바꾼 직후 판정 총액·나라별 비교·한계 기여도·재분류 이력이
 * 모두 옛 계산 결과를 그대로 보여줬고, 근거 기간이 사라진 뒤에도 캐시가 남아 답을 말했다.
 *
 * 규칙은 하나다. **지금 조회한 결과가 아니면 쓰지 않는다.**
 * 대신 각 표면이 "확인 중"인지 "실패"인지 "계산하지 않음"인지를 밝힌다.
 */

export type FreshState = "ready" | "pending" | "error" | "disabled";

type QueryLike<T> = {
  data: T | undefined;
  isFetching: boolean;
  isError: boolean;
  /** 아직 실제 응답이 아니라 이전 결과를 자리에 끼워둔 상태. */
  isPlaceholderData?: boolean;
};

export type Fresh<T> = {
  /** 지금 이 순간 신뢰할 수 있는 값. 보류·실패·비활성이면 undefined. */
  data: T | undefined;
  state: FreshState;
};

/**
 * @param query  대상 쿼리
 * @param disabled  근거가 없어 **계산 자체를 하지 않는** 상태. 캐시가 남아 있어도 쓰지 않는다.
 */
export function fresh<T>(query: QueryLike<T>, disabled = false): Fresh<T> {
  const state: FreshState = disabled
    ? "disabled"
    : query.isError
      ? "error"
      : query.isFetching || query.isPlaceholderData === true || query.data === undefined
        ? "pending"
        : "ready";
  return { data: state === "ready" ? query.data : undefined, state };
}

/**
 * 받침 유무로 을/를을 고른다. 문구가 어색하면 사용자는 화면을 신뢰하지 않는다.
 * 한글이 아닌 끝말(영문 약어·숫자)은 읽는 소리를 알 수 없으므로 조사를 붙이지 않는다.
 */
function objectParticle(word: string): "을" | "를" | "" {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

/** 보류/실패/비활성 상태에 붙일 표준 문구. 표면마다 다른 말을 하지 않게 한다. */
export function freshNotice(state: FreshState, subject: string): string | null {
  const trimmed = subject.trim();
  if (!trimmed) throw new Error("freshNotice: subject는 비어 있을 수 없습니다");
  const particle = objectParticle(trimmed);
  const target = particle ? `${trimmed}${particle}` : `${trimmed} 정보를`;
  if (state === "pending") return `${target} 확인하는 중입니다.`;
  if (state === "error") return `${target} 불러오지 못했습니다.`;
  // 계산하지 않은 것을 "불러오는 중"이라 말하면 없는 진행을 지어내는 것이다.
  if (state === "disabled") return `기준 기간을 확인하지 못해 ${target} 계산하지 않았습니다.`;
  return null;
}
