"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { formatDate, formatFiat } from "@/lib/format";
import { FLOW_RANGES, buildFlowSeries, flowGeometry, windowBetween, windowOf } from "@/lib/portfolio/flow-series";
import type { RangeId } from "@/lib/portfolio/flow-series";
import { DEFAULT_PERIOD, periodWindowLabel } from "@/lib/portfolio/period-selection";
import type { PeriodSelection, PeriodWindow } from "@/lib/portfolio/period-selection";
import type { FreshState } from "@/lib/queries/fresh";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { abs, isNegative, isZero } from "@/lib/tax/decimal";

/**
 * 지갑 이력의 누적 순유입 그래프.
 *
 * 세금 금액은 이 화면에 없다 — 부담·판정·한계는 세금 탭 한 곳에서만 말한다.
 * 여기서 그리는 것은 우리가 실제로 가진 사실(거래 시점의 법정통화 금액)뿐이고,
 * 그 사실이 무엇이 **아닌지**(현재 평가액이 아님)를 선 아래에서 계속 밝힌다.
 *
 * 기간은 이 그래프의 소유가 아니다. 화면이 기간을 들고 있으면(`selection`) 버튼은 그 상태를
 * 바꾸기만 하고 헤더·목록이 같은 창을 따라 움직인다 — 그래프만 좁아지고 나머지가 그대로면
 * 한 화면이 두 기간을 동시에 말하게 된다.
 */

/** 좌표계. 실제 크기는 CSS가 정하고, 선은 이 격자 위에서 계산된다. */
const WIDTH = 600;
const HEIGHT = 180;

/** 사유별 세부 문장. 요약은 칩("선에 없는 N건")이 대신하므로, 이 문장은 접힘 안에서만 쓴다. */
function omissionDetail(omitted: Record<string, number>): string | null {
  const parts = [
    omitted.unconfirmed > 0 ? `가격·분류 미확정 ${omitted.unconfirmed}건` : null,
    omitted.notFlow > 0 ? `자기 지갑 간 이체 ${omitted.notFlow}건` : null,
    omitted.undated > 0 ? `날짜 미상 ${omitted.undated}건` : null,
    omitted.otherCurrency > 0 ? `다른 통화 ${omitted.otherCurrency}건` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${parts.join(" · ")}은 선에 없습니다.` : null;
}

function omittedTotal(omitted: Record<string, number>): number {
  return omitted.unconfirmed + omitted.notFlow + omitted.undated + omitted.otherCurrency;
}

export function FlowChart({
  events,
  state,
  truncated = false,
  hideBalances = false,
  selection,
  period,
  onSelect,
}: {
  events: NormalizedEvent[];
  /** 목록 조회 상태. 재조회·실패 중이면 이 선도 "지금 것"이 아니다. */
  state: FreshState;
  /** 목록을 일부만 받아왔는가. 그러면 선도 일부다. */
  truncated?: boolean;
  /** 잔액 가리기 모드. 선의 형태는 유지하되 금액 텍스트만 가린다. */
  hideBalances?: boolean;
  /**
   * 화면이 들고 있는 기간 선택. 주면 이 그래프는 자기 상태를 쓰지 않고 이 값만 따른다
   * (버튼은 `onSelect`로 바꿔 달라고 말할 뿐이다).
   */
  selection?: PeriodSelection;
  /**
   * 확정된 창. 프리셋을 여기서 다시 풀면 화면이 정한 기간과 선이 덮는 기간이 갈리므로,
   * 주어지면 이 창을 그대로 자른다.
   */
  period?: PeriodWindow | null;
  onSelect?: (next: PeriodSelection) => void;
}) {
  // 기간을 밖에서 주지 않으면(단독 사용) 예전처럼 자기 상태로 자른다.
  const [ownSelection, setOwnSelection] = useState<PeriodSelection>(DEFAULT_PERIOD);
  const controlled = selection !== undefined;
  const activeSelection = selection ?? ownSelection;
  const select = (next: PeriodSelection) => (controlled ? onSelect?.(next) : setOwnSelection(next));

  const series = buildFlowSeries(events);
  const presetId: RangeId | null = activeSelection.kind === "preset" ? activeSelection.id : null;
  const preset = FLOW_RANGES.find((item) => item.id === presetId) ?? FLOW_RANGES[FLOW_RANGES.length - 1];
  // 밖에서 준 창이 우선이다. 없을 때만 프리셋을 여기서 푼다.
  const slice = period
    ? windowBetween(series.points, period.fromMs, period.toMs)
    : windowOf(series.points, preset);
  const last = series.points[series.points.length - 1];
  const currency = series.currency;
  const geometry = slice ? flowGeometry(slice.plot, WIDTH, HEIGHT) : null;
  const notice = omissionDetail(series.omitted);
  const omitted = omittedTotal(series.omitted);
  // 창 안의 변화가 **어느 기간의** 변화인지. 직접 지정한 기간에는 프리셋 이름이 없다.
  const changeLabel = activeSelection.kind === "custom" ? "선택 기간" : preset.label;

  // 선 위에서 짚고 있는 지점. 기간이 바뀌면 짚던 자리는 더 이상 같은 지점이 아니므로 놓는다.
  const [marked, setMarked] = useState<number | null>(null);
  const windowKey = slice ? `${slice.fromMs}:${slice.toMs}:${slice.points.length}` : "none";
  const [markedWindow, setMarkedWindow] = useState(windowKey);
  if (windowKey !== markedWindow) {
    setMarkedWindow(windowKey);
    setMarked(null);
  }
  // 점 수가 줄어든 순간의 옛 인덱스로 배열 밖을 짚지 않는다.
  const markIndex = geometry === null || marked === null ? null : Math.min(marked, geometry.marks.length - 1);
  const mark = geometry !== null && markIndex !== null ? geometry.marks[markIndex] : null;

  const moveMark = (clientX: number, element: HTMLElement) => {
    if (geometry === null) return;
    const rect = element.getBoundingClientRect();
    // 아직 측정되지 않은 렌더에서는 폭이 0이다. NaN으로 짚느니 선의 시작점을 짚는다.
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const x = Math.min(Math.max(ratio, 0), 1) * WIDTH;
    let nearest = 0;
    geometry.marks.forEach((candidate, index) => {
      if (Math.abs(candidate.x - x) < Math.abs(geometry.marks[nearest].x - x)) nearest = index;
    });
    setMarked(nearest);
  };

  const stepMark = (delta: number) => {
    if (geometry === null) return;
    const from = markIndex ?? (delta > 0 ? -1 : geometry.marks.length);
    setMarked(Math.min(Math.max(from + delta, 0), geometry.marks.length - 1));
  };

  const rangeClass = (active: boolean) =>
    `shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? "bg-zinc-900 text-white" : "text-zinc-500"}`;

  return (
    <section aria-label="누적 순유입" data-surface="dashboard-flow" className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500">누적 순유입</p>
          {/* 그릴 것이 없으면 금액 자리를 비운다. `—`도 0도 모두 "값이 있다"는 인상을 준다. */}
          {last && currency ? (
            <p data-testid="flow-total" className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
              {hideBalances ? "•••••" : formatFiat(last.value, currency)}
            </p>
          ) : null}
          {last ? (
            <p className="mt-1 text-xs text-zinc-500">마지막 거래 {formatDate(last.at)} 기준</p>
          ) : null}
        </div>
        {slice && currency ? (
          <div className="shrink-0 text-right">
            {slice.points.length === 0 ? (
              <p className="text-xs text-zinc-500">이 기간에는 거래가 없습니다</p>
            ) : isZero(slice.change) ? (
              <p className="text-sm font-semibold text-zinc-500">변화 없음</p>
            ) : (
              <p
                data-testid="flow-change"
                className={`text-sm font-semibold ${isNegative(slice.change) ? "text-rose-700" : "text-emerald-700"}`}
              >
                {isNegative(slice.change) ? (
                  <TrendingDown aria-hidden="true" className="mr-1 inline-block size-4 align-[-0.1875rem]" strokeWidth={2.5} />
                ) : (
                  <TrendingUp aria-hidden="true" className="mr-1 inline-block size-4 align-[-0.1875rem]" strokeWidth={2.5} />
                )}
                {hideBalances ? (
                  "•••••"
                ) : (
                  <>
                    {isNegative(slice.change) ? "-" : "+"}
                    {formatFiat(abs(slice.change), currency)}
                    {slice.changePercent === null ? "" : ` · ${abs(slice.changePercent)}%`}
                  </>
                )}
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-400">{changeLabel} 변화</p>
          </div>
        ) : null}
      </div>

      {geometry ? (
        // 선을 짚어 읽는 층. 그림과 짚는 자리가 같은 좌표에서 나와야 값이 선 위에 붙는다.
        <div
          className="relative mt-4 cursor-crosshair"
          role="group"
          aria-label="선 위 지점 살펴보기 (좌우 방향키)"
          tabIndex={0}
          onPointerMove={(event) => moveMark(event.clientX, event.currentTarget)}
          onPointerDown={(event) => moveMark(event.clientX, event.currentTarget)}
          onPointerLeave={() => setMarked(null)}
          onBlur={() => setMarked(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              stepMark(1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              stepMark(-1);
            } else if (event.key === "Escape") {
              setMarked(null);
            }
          }}
        >
          <svg
            role="img"
            aria-label={`${formatDate(new Date(slice!.fromMs).toISOString())}부터 ${formatDate(new Date(slice!.toMs).toISOString())}까지 누적 순유입 선 그래프`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-44 w-full"
          >
            {/* 0선은 값 범위가 실제로 0을 지날 때만 그린다. 없는 기준선을 그리면 위/아래의 뜻이 달라진다. */}
            {geometry.zeroY === null ? null : (
              <line
                x1="0"
                x2={WIDTH}
                y1={geometry.zeroY}
                y2={geometry.zeroY}
                className="stroke-zinc-300"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path d={geometry.area} className="fill-primary-500/10" />
            <path
              data-testid="flow-line"
              d={geometry.line}
              fill="none"
              className="stroke-primary-500"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {mark ? (
              <>
                <line
                  x1={mark.x}
                  x2={mark.x}
                  y1="0"
                  y2={HEIGHT}
                  className="stroke-zinc-300"
                  vectorEffect="non-scaling-stroke"
                />
                {/* 좌표계가 가로로 늘어나 있어 원을 그리면 타원이 된다. 축별 반지름으로 되돌린다. */}
                <ellipse
                  cx={mark.x}
                  cy={mark.y}
                  rx={WIDTH / 120}
                  ry={HEIGHT / 36}
                  className="fill-white stroke-primary-500"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : null}
          </svg>
          {mark ? (
            <div
              data-testid="flow-point"
              className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-zinc-900 px-2 py-1 text-center text-xs font-semibold text-white shadow-card"
              // 양끝에서 잘리지 않도록 가장자리는 안쪽으로 붙인다.
              style={{ left: `clamp(3rem, ${(mark.x / WIDTH) * 100}%, calc(100% - 3rem))` }}
            >
              <span className="block tabular-nums">
                {hideBalances || currency === null ? "•••••" : formatFiat(mark.value, currency)}
              </span>
              <span className="block font-medium text-zinc-300">{formatDate(new Date(mark.atMs).toISOString())}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
          {state === "error" && series.points.length === 0
            ? "거래를 불러오지 못해 선을 그리지 못했습니다."
            : state === "pending" && series.points.length === 0
              ? "거래를 불러오는 중입니다."
              : series.points.length === 0
                ? "선을 그릴 거래가 없습니다."
                : slice && slice.points.length === 0
                  ? "이 기간에는 거래가 없어 선을 그릴 수 없습니다."
                  : "거래가 한 건뿐이라 선을 그릴 수 없습니다."}
        </p>
      )}

      <div className="mt-3 flex gap-1 overflow-x-auto" aria-label="기간 선택">
        {FLOW_RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === presetId}
            className={rangeClass(item.id === presetId)}
            onClick={() => select({ kind: "preset", id: item.id })}
          >
            {item.label}
          </button>
        ))}
        {/* 직접 지정한 기간은 프리셋 어느 것도 아니다. 눌린 버튼이 하나도 없으면 지금 기간이
            어디서 왔는지 알 수 없으므로, 그 상태를 같은 줄에서 말한다. */}
        {activeSelection.kind === "custom" ? (
          <span className={`${rangeClass(true)} whitespace-nowrap`}>직접 지정</span>
        ) : null}
      </div>

      {slice && slice.points.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-400">
          {formatDate(new Date(slice.fromMs).toISOString())} ~ {formatDate(new Date(slice.toMs).toISOString())} ·{" "}
          {period ? "선택한 기간" : "마지막 거래 기준"}
        </p>
      ) : null}

      <div className="mt-2 border-t border-zinc-100 pt-2">
        {/* 이 선이 무엇인지, 그리고 무엇이 아닌지는 여전히 같은 자리에서 말한다 — 다만 문장 그대로 깔면
            정작 읽어야 할 그래프보다 고지문이 부피를 더 차지하므로 칩으로 강등하고 전문은 접어 보존한다. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {omitted > 0 ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
              선에 없는 {omitted}건
            </span>
          ) : null}
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
            현재 평가액 아님
          </span>
        </div>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-medium text-zinc-400">무엇이 빠졌나</summary>
          <div className="mt-1 space-y-1 text-xs leading-5 text-zinc-500">
            {/* "평가액"으로 읽히는 순간, 우리가 갖고 있지 않은 현재 시세를 주장하는 화면이 된다. */}
            <p>받은 자산은 더하고 보낸 자산은 뺀 누적 금액입니다. 각 거래 시점의 가격이라 지금 시세로 평가한 금액이 아닙니다.</p>
            {notice ? <p>{notice}</p> : null}
            {period ? <p>지금 보는 선은 {periodWindowLabel(period)} 구간입니다.</p> : null}
          </div>
        </details>
        {truncated ? (
          <p className="mt-1 text-xs leading-5 text-amber-800">거래를 일부만 불러와 이 선도 일부입니다.</p>
        ) : null}
        {state !== "ready" && series.points.length > 0 ? (
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {state === "error"
              ? "목록을 갱신하지 못했습니다. 이 선은 마지막으로 받은 거래로 그렸습니다."
              : "목록을 갱신하는 중입니다. 이 선은 마지막으로 받은 거래로 그렸습니다."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
