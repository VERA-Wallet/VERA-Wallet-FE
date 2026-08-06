/**
 * 데모 픽스처의 시계.
 *
 * 픽스처에 절대 연도를 박아두면 해가 바뀌는 순간 모든 화면이 조용히 "계산할 거래 없음"이 된다.
 * (2025년 거래만 있던 픽스처는 2026년이 되자 어느 룰셋의 2026년 과세기간에도 걸리지 않아
 *  12개 나라가 전부 0원을 말했고, 룰셋 비교 자체가 성립하지 않았다.)
 *
 * 게다가 과세기간은 나라마다 다르다 — 역년(1/1~) · 영국(4/6~) · 호주(7/1~).
 * 같은 연도를 골랐을 때 12개 룰셋이 **같은 거래 집합**을 보게 하려면
 * 세 기간의 교집합인 `[Y-07-01, Y+1-01-01)` 안에 과세 대상 거래를 넣어야 한다.
 * 이 창을 벗어나면 호주만 5건 · 영국만 8건을 보고도 화면은 같은 해라고 말한다.
 */

/** 과세연도 `Y`에서 12개 룰셋의 과세기간이 모두 겹치는 창. 반열린 구간 `[from, to)`. */
export function demoCommonWindow(taxYear: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(taxYear, 6, 1)).toISOString(),
    to: new Date(Date.UTC(taxYear + 1, 0, 1)).toISOString(),
  };
}

/**
 * 공통 창이 이미 끝난 가장 최근 과세연도.
 * 아직 끝나지 않은 해를 쓰면 픽스처가 미래 날짜를 만들어 "아직 일어나지 않은 거래"를 보인다.
 */
export function demoTaxYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return Date.UTC(year + 1, 0, 1) <= now.getTime() ? year : year - 1;
}

/**
 * 픽스처가 쓰는 시각 생성기. `month`는 1부터 센다.
 * 공통 창 밖(취득원가 추적용 과거 취득 등)도 만들 수 있어야 하므로 여기서 창을 강제하지 않는다.
 * 창 안에 있어야 하는 것은 **과세 대상 거래**뿐이고, 그 불변식은 테스트가 지킨다.
 */
export function demoInstant(year: number, month: number, day: number, hour = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString();
}
