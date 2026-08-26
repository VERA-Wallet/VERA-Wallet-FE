import { isoDay } from "@/lib/period";
import { FLOW_RANGES } from "@/lib/portfolio/flow-series";
import type { RangeId } from "@/lib/portfolio/flow-series";

/**
 * 화면이 보고 있는 **기간**의 단일 소스.
 *
 * 지금까지 기간은 두 군데서 따로 정해졌다 — 헤더는 요약이 준 기간을 읽기만 했고,
 * 그래프는 자기 안의 버튼으로 창을 잘랐다. 그래서 그래프가 "1개월"을 그려도
 * 헤더는 여전히 전체 기간을 말했고, 목록은 그와 무관한 전부를 보였다.
 * 셋이 각자 자르면 한 화면이 세 기간을 동시에 말한다.
 *
 * 여기서 선택(프리셋 또는 직접 지정한 날짜)을 **확정된 창**으로 한 번만 바꾸고,
 * 헤더·그래프·목록이 그 창 하나를 함께 쓴다.
 */

const DAY_MS = 86_400_000;

export type PeriodSelection =
  /** 마지막 거래를 기준으로 뒤로 세는 프리셋(그래프 버튼과 같은 것). */
  | { kind: "preset"; id: RangeId }
  /** 사용자가 직접 고른 날짜. 양끝 모두 **포함**이다. */
  | { kind: "custom"; from: string; to: string };

/** 아무것도 고르지 않은 상태. 화면은 이때 요약이 말하는 기간을 그대로 보인다. */
export const DEFAULT_PERIOD: PeriodSelection = { kind: "preset", id: "ALL" };

export function isDefaultPeriod(selection: PeriodSelection): boolean {
  return selection.kind === "preset" && selection.id === "ALL";
}

/** 확정된 기간. `from`·`to`는 표시용 날짜이고, `fromMs`·`toMs`는 자르기용 시각이다(양끝 포함). */
export type PeriodWindow = { fromMs: number; toMs: number; from: string; to: string };

/** 데이터가 실제로 걸쳐 있는 범위. 프리셋은 벽시계가 아니라 이 끝을 기준으로 센다. */
export type DataBounds = { firstMs: number; lastMs: number };

/**
 * 이벤트 시각들에서 데이터 범위를 뽑는다.
 *
 * 파싱되지 않는 시각은 x축에 놓을 자리가 없으므로 범위를 정하는 데도 쓰지 않는다 —
 * 그런 값 하나가 기준이 되면 프리셋 전체가 존재하지 않는 시점에서 뒤로 세게 된다.
 */
export function dataBounds(timestamps: string[]): DataBounds | null {
  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;
  for (const timestamp of timestamps) {
    const ms = Date.parse(timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;
  }
  return Number.isFinite(firstMs) ? { firstMs, lastMs } : null;
}

/** 시각 하나를 표시용 날짜로. 달력에 없는 값은 여기까지 오지 않는다(`dataBounds`가 걸러낸다). */
function dayOf(ms: number): string {
  return isoDay(new Date(ms).toISOString());
}

/**
 * 직접 지정한 날짜가 기간이 될 수 있는가. 될 수 없으면 **왜** 안 되는지를 돌려준다 —
 * 입력을 조용히 무시하면 사용자는 자기가 무엇을 잘못 골랐는지 알 수 없다.
 */
export function customPeriodError(from: string, to: string): string | null {
  if (from.trim() === "" || to.trim() === "") return "시작일과 종료일을 모두 골라 주세요.";
  if (isoDay(from) === "") return "시작일이 달력에 없는 날짜입니다.";
  if (isoDay(to) === "") return "종료일이 달력에 없는 날짜입니다.";
  if (isoDay(from) > isoDay(to)) return "종료일이 시작일보다 앞섭니다.";
  return null;
}

/**
 * 선택을 확정된 창으로 바꾼다.
 *
 * 프리셋은 데이터가 없으면 잴 기준이 없으므로 `null`이다 — 벽시계로 대신 세면
 * 오래된 지갑·데모에서 모든 버튼이 빈 기간을 가리킨다.
 * 직접 지정한 날짜는 데이터와 무관하게 그 자체로 창이 된다(거래가 없는 기간도 고를 수 있다).
 */
export function resolvePeriod(selection: PeriodSelection, bounds: DataBounds | null): PeriodWindow | null {
  if (selection.kind === "custom") {
    if (customPeriodError(selection.from, selection.to) !== null) return null;
    const from = isoDay(selection.from);
    const to = isoDay(selection.to);
    // 끝날은 **그날 전체**를 포함한다. 자정으로 자르면 사용자가 고른 마지막 날이 통째로 빠진다.
    return { fromMs: Date.parse(`${from}T00:00:00.000Z`), toMs: Date.parse(`${to}T23:59:59.999Z`), from, to };
  }
  if (bounds === null) return null;
  const range = FLOW_RANGES.find((item) => item.id === selection.id) ?? FLOW_RANGES[FLOW_RANGES.length - 1];
  const fromMs = range.days === null ? bounds.firstMs : bounds.lastMs - range.days * DAY_MS;
  return { fromMs, toMs: bounds.lastMs, from: dayOf(fromMs), to: dayOf(bounds.lastMs) };
}

/** 화면에 보일 기간. 표기는 요약 기간과 같은 모양이어야 두 줄이 같은 것을 말한다고 읽힌다. */
export function periodWindowLabel(period: PeriodWindow): string {
  return `${period.from} ~ ${period.to}`;
}

/** 이 거래가 창 안에 있는가. 시각을 모르는 건은 어느 기간에도 놓을 수 없다. */
export function inPeriodWindow(timestamp: string, period: PeriodWindow): boolean {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return false;
  return ms >= period.fromMs && ms <= period.toMs;
}
