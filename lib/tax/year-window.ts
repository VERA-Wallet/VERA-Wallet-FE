/**
 * 과세연도 선택 창. 고정 배열이면 해가 바뀌는 순간 "올해"를 못 고른다.
 * 마지막 거래가 이 창보다 오래됐다면 그 해도 함께 넣는다 —
 * 목록에 없으면 사용자는 자기 거래가 있는 해로 돌아갈 방법이 없다.
 *
 * 미래 연도는 **시계로는 절대 만들지 않는다**. 룰셋이 시행 예정 연도를 선언했을 때만
 * 그 해를 넣는다(한국 2027) — 그러지 않으면 시행 후 계산을 볼 방법이 없다.
 *
 * 세금 화면(tax-simulator)과 내보내기 화면(export-view)이 같은 창을 쓰도록 한 곳에 둔다 —
 * 두 화면이 서로 다른 연도 목록을 보이면 같은 전역 소스를 공유하는 의미가 없다.
 */
export function taxYearWindow(current: number, latestActivity?: number, effective?: number): number[] {
  const years = new Set([current - 3, current - 2, current - 1, current]);
  if (latestActivity !== undefined) years.add(latestActivity);
  if (effective !== undefined) years.add(effective);
  return [...years].sort((left, right) => left - right);
}
