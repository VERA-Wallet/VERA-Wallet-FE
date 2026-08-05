import type { SummaryDTO } from "@/lib/http/dto";

/**
 * 기간 표시의 단일 소스.
 *
 * 빈 지갑의 요약은 `{from:"", to:""}`를 돌려준다. 그걸 그대로 쓰면
 * 화면에는 ` ~ `가, 파일명에는 `verawallet-명세-_.csv`가 나온다.
 * 둘 다 "기간이 있다"고 말하는 셈이라 거짓이다.
 */

/**
 * `Date.parse`는 관대하다. `"2025"`, `"2025-01"`도 유효로 보고
 * `"2025-02-30"` 같은 달력에 없는 날짜는 조용히 3월 2일로 정규화한다.
 * 그걸 그대로 쓰면 사용자가 존재하지 않는 기간을 본다.
 */
export function isoDay(value: string): string {
  const head = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return "";
  const parsed = new Date(`${head}T00:00:00.000Z`);
  // `2025-13-01`처럼 아예 파싱이 안 되는 값은 toISOString이 던진다.
  if (Number.isNaN(parsed.getTime())) return "";
  // 정규화로 값이 바뀌었다면 달력에 없는 날짜였다는 뜻이다.
  if (parsed.toISOString().slice(0, 10) !== head) return "";
  // 접두사만 보면 `2025-01-01T00:00:00+25:00` 같은 값이 통과한다.
  // 그런데 그 **전체** 문자열은 파싱되지 않아, 이걸 근거로 삼으면 `NaN년 세금`이 나온다.
  // 표시 검증과 계산 검증이 같은 문자열을 보게 한다.
  if (value.length > head.length && Number.isNaN(Date.parse(value))) return "";
  return head;
}

const day = isoDay;

/**
 * 이 기간을 **계산 근거로 삼아도 되는가**.
 * 표시용 검증과 계산 활성화용 검증이 갈리면,
 * 헤더는 `기간 미정`인데 판정 기준은 `2025년 세금`을 말하는 모순이 생긴다.
 */
export function isGroundedPeriod(period: SummaryDTO["period"] | undefined): boolean {
  if (!period) return false;
  const from = day(period.from);
  const to = day(period.to);
  if (!from || !to) return false;
  // 끝이 시작보다 앞서면 존재할 수 없는 기간이다. 그걸로 계산하면 없는 기간의 답을 만든다.
  // **원문 시각**으로 비교한다. 날짜만 잘라 자정끼리 비교하면
  // `2025-01-01T23:00+09:00`(=14:00Z) → `2025-01-01T00:00Z` 같은 실제 역순을 놓친다.
  return Date.parse(period.from) <= Date.parse(period.to);
}

/** 화면에 보일 기간. 양끝이 모두 유효할 때만 범위로 쓴다. */
export function periodLabel(period: SummaryDTO["period"]): string {
  if (!isGroundedPeriod(period)) return "기간 미정";
  return `${day(period.from)} ~ ${day(period.to)}`;
}

/**
 * 반열린 과세기간 `[from, to)`을 사람이 읽는 범위로.
 *
 * 엔진의 `to`는 **포함하지 않는 끝**이다(2025년 역년이면 `2026-01-01`).
 * 그대로 찍으면 화면이 실제보다 하루 넓은 기간을 말한다.
 */
export function halfOpenPeriodLabel(period: SummaryDTO["period"]): string {
  if (!isGroundedPeriod(period)) return "기간 미정";
  const end = new Date(Date.parse(period.to) - 86_400_000);
  const last = day(end.toISOString());
  if (!last) return "기간 미정";
  return `${day(period.from)} ~ ${last}`;
}

/** 파일명에 넣을 기간 조각. */
export function periodFilePart(period: SummaryDTO["period"]): string {
  if (!isGroundedPeriod(period)) return "기간미정";
  return `${day(period.from)}_${day(period.to)}`;
}
