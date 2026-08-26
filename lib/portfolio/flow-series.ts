import { add, div, isPositive, mul, neg, round, sub, ZERO } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { assetFlow, taxExclusionReason } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 지갑 이력으로 그릴 수 있는 **유일한 선**: 누적 순유입.
 *
 * 우리가 가진 사실은 "거래 시점의 법정통화 금액"뿐이다. 보유 자산의 현재 시세는 어디에도 없다.
 * 그래서 이 선은 평가액이 아니라 **받은 금액 − 보낸 금액의 누적**이며, 화면은 그 사실을 그대로 말한다.
 * (평가액이라 부르는 순간, 우리는 갖고 있지 않은 가격 데이터를 있는 것처럼 주장하게 된다.)
 *
 * 들어옴/나감의 기준은 `direction`이 아니라 **유효 분류**다(`assetFlow`) — 목록·세무 파생과 같은 판단을 쓴다.
 * 갈리면 카드는 "얻음"인데 선은 "처분"이라고 말하는 화면이 된다.
 */

export type FlowPoint = {
  eventId: string;
  at: string;
  atMs: number;
  /** 이 거래까지의 누적 순유입. */
  value: Decimal;
  /** 이 거래 한 건이 선을 움직인 크기(받음 +, 보냄 −). */
  delta: Decimal;
};

/** 선에 넣지 못한 이유. 건수를 이유별로 나눠 화면이 "무엇이 빠졌는지"를 말할 수 있게 한다. */
export type FlowOmission = "unconfirmed" | "notFlow" | "undated" | "otherCurrency";

export type FlowSeries = {
  points: FlowPoint[];
  /** 선의 통화. 그릴 수 있는 거래가 하나도 없으면 null — 통화를 지어내지 않는다. */
  currency: string | null;
  omitted: Record<FlowOmission, number>;
  omittedTotal: number;
};

/**
 * 이벤트 목록에서 누적 순유입 점들을 만든다.
 *
 * 제외 규칙은 화면 전체가 쓰는 것과 같다:
 * - 가격·분류·수량을 확정하지 못한 건(`taxExclusionReason`)은 금액을 모르므로 더할 수 없다.
 * - 자기 지갑 간 이체는 들어온 것도 나간 것도 아니다(`assetFlow`가 neutral).
 * - 시각을 파싱할 수 없는 건은 x축에 놓을 자리가 없다.
 * - 통화가 섞이면 더한 수가 아무 뜻도 없으므로 첫 통화만 남기고 나머지는 뺀다.
 */
export function buildFlowSeries(events: NormalizedEvent[]): FlowSeries {
  const omitted: Record<FlowOmission, number> = { unconfirmed: 0, notFlow: 0, undated: 0, otherCurrency: 0 };
  const usable: { event: NormalizedEvent; atMs: number; delta: Decimal }[] = [];
  let currency: string | null = null;

  for (const event of events) {
    const atMs = Date.parse(event.block_timestamp);
    if (Number.isNaN(atMs)) {
      omitted.undated += 1;
      continue;
    }
    // 금액을 모르는 건은 0으로 놓을 수 없다. 0으로 놓으면 "움직임이 없었다"는 거짓이 된다.
    if (taxExclusionReason(event) !== null || event.fiat_value === null) {
      omitted.unconfirmed += 1;
      continue;
    }
    const flow = assetFlow(event);
    if (flow === "neutral") {
      omitted.notFlow += 1;
      continue;
    }
    if (currency === null) currency = event.fiat_currency;
    if (event.fiat_currency !== currency) {
      omitted.otherCurrency += 1;
      continue;
    }
    usable.push({ event, atMs, delta: flow === "in" ? event.fiat_value : neg(event.fiat_value) });
  }

  // 목록 순서를 믿지 않는다. 시각이 같으면 id로 갈라 같은 입력이 늘 같은 선을 만들게 한다.
  usable.sort((left, right) => left.atMs - right.atMs || (left.event.id < right.event.id ? -1 : 1));

  let running: Decimal = ZERO;
  const points = usable.map(({ event, atMs, delta }) => {
    running = add(running, delta);
    return { eventId: event.id, at: event.block_timestamp, atMs, value: running, delta };
  });

  const omittedTotal = omitted.unconfirmed + omitted.notFlow + omitted.undated + omitted.otherCurrency;
  return { points, currency, omitted, omittedTotal };
}

export type RangeId = "1M" | "3M" | "6M" | "1Y" | "ALL";
export type FlowRange = { id: RangeId; label: string; days: number | null };

const DAY_MS = 86_400_000;

/**
 * 기간 버튼.
 *
 * 기준점은 **마지막 거래**다. 벽시계로 자르면 데모·오래된 지갑에서 모든 버튼이 빈 화면을 준다.
 * 화면은 실제로 잘린 날짜 범위를 함께 찍어 "최근"이라는 말이 무엇을 가리키는지 숨기지 않는다.
 */
export const FLOW_RANGES: readonly FlowRange[] = [
  { id: "1M", label: "1개월", days: 30 },
  { id: "3M", label: "3개월", days: 90 },
  { id: "6M", label: "6개월", days: 180 },
  { id: "1Y", label: "1년", days: 365 },
  { id: "ALL", label: "전체", days: null },
];

export type FlowPlotPoint = { atMs: number; value: Decimal };

export type FlowWindow = {
  /** 창 안의 실제 거래 점. */
  points: FlowPoint[];
  /** 선을 그릴 좌표 열. 창 앞에 이력이 있으면 창 시작점(직전 누적값)이 맨 앞에 붙는다. */
  plot: FlowPlotPoint[];
  /** 창이 시작되기 직전의 누적값. 창 안의 변화는 이 값에서 잰다. */
  baseline: Decimal;
  change: Decimal;
  /** 변화율(%). 기준이 0 이하면 비율을 말할 수 없다 — 그때는 null이고 화면은 %를 찍지 않는다. */
  changePercent: Decimal | null;
  fromMs: number;
  toMs: number;
};

/** 마지막 거래를 기준으로 기간을 잘라낸다. 점이 하나도 없으면 자를 것이 없으므로 null. */
export function windowOf(points: FlowPoint[], range: FlowRange): FlowWindow | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const fromMs = range.days === null ? points[0].atMs : last.atMs - range.days * DAY_MS;
  return windowBetween(points, fromMs, last.atMs);
}

/**
 * 명시한 두 시각 사이로 잘라낸다(양끝 포함).
 *
 * 기간을 화면 한 곳에서 정하면(`period-selection`) 그래프가 자기 기준으로 또 자를 수 없다 —
 * 각자 자르는 순간 헤더가 말하는 기간과 선이 덮는 기간이 갈린다.
 */
export function windowBetween(points: FlowPoint[], fromMs: number, toMs: number): FlowWindow | null {
  if (points.length === 0) return null;
  const inside = points.filter((point) => point.atMs >= fromMs && point.atMs <= toMs);
  const before = points.filter((point) => point.atMs < fromMs);
  const baseline = before.length > 0 ? before[before.length - 1].value : ZERO;
  if (inside.length === 0) {
    return { points: [], plot: [], baseline, change: ZERO, changePercent: null, fromMs, toMs };
  }
  const change = sub(inside[inside.length - 1].value, baseline);
  // 기준이 0이거나 음수면 "몇 % 변했다"가 뜻을 잃는다 — −2만에서 −7만은 240% 감소인가, 증가인가.
  // 비율을 지어내느니 금액만 말한다.
  const changePercent = isPositive(baseline) ? round(mul(div(change, baseline), "100"), 1) : null;
  const plot: FlowPlotPoint[] = [
    ...(before.length > 0 ? [{ atMs: fromMs, value: baseline }] : []),
    ...inside.map((point) => ({ atMs: point.atMs, value: point.value })),
  ];
  return { points: inside, plot, baseline, change, changePercent, fromMs, toMs };
}

/** 선 위의 한 점. 호버·키보드로 짚었을 때 화면이 "언제 얼마"를 말할 수 있게 값까지 함께 든다. */
export type FlowMark = { x: number; y: number; atMs: number; value: Decimal };

export type FlowGeometry = {
  line: string;
  area: string;
  /** 0선의 y좌표. 창의 값 범위가 0을 지나지 않으면 null(없는 기준선을 그리지 않는다). */
  zeroY: number | null;
  end: { x: number; y: number };
  /** 선을 이루는 점들의 좌표+값. 그림과 읽는 값이 같은 계산에서 나와야 둘이 어긋나지 않는다. */
  marks: FlowMark[];
};

/** 좌표 계산은 픽셀이라 부동소수로 해도 된다 — 금액 자체는 여기서 만들지 않는다. */
const px = (value: number) => Math.round(value * 100) / 100;

/**
 * 점 열을 SVG 경로로 바꾼다. 점이 둘 미만이면 선이 성립하지 않으므로 null이고,
 * 화면은 그때 선을 그리는 대신 "점이 하나뿐"이라고 말한다.
 */
export function flowGeometry(plot: FlowPlotPoint[], width: number, height: number, inset = 8): FlowGeometry | null {
  if (plot.length < 2) return null;
  const values = plot.map((point) => Number(point.value));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const top = inset;
  const bottom = height - inset;
  const y = (value: number) => (span === 0 ? (top + bottom) / 2 : bottom - ((value - minValue) / span) * (bottom - top));
  const firstMs = plot[0].atMs;
  const duration = plot[plot.length - 1].atMs - firstMs;
  const x = (atMs: number) => (duration === 0 ? width / 2 : ((atMs - firstMs) / duration) * width);
  const coordinates = plot.map((point) => ({ x: px(x(point.atMs)), y: px(y(Number(point.value))) }));
  const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const end = coordinates[coordinates.length - 1];
  const area = `${line} L${end.x} ${height} L${coordinates[0].x} ${height} Z`;
  const zeroY = span > 0 && minValue <= 0 && maxValue >= 0 ? px(y(0)) : null;
  const marks = coordinates.map((point, index) => ({ ...point, atMs: plot[index].atMs, value: plot[index].value }));
  return { line, area, zeroY, end, marks };
}
