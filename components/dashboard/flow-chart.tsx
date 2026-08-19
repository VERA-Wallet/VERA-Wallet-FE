"use client";

import { useState } from "react";
import { formatDate, formatFiat } from "@/lib/format";
import { FLOW_RANGES, buildFlowSeries, flowGeometry, windowOf } from "@/lib/portfolio/flow-series";
import type { RangeId } from "@/lib/portfolio/flow-series";
import type { FreshState } from "@/lib/queries/fresh";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { abs, isNegative, isZero } from "@/lib/tax/decimal";

/**
 * 지갑 이력의 누적 순유입 그래프.
 *
 * 세금 금액은 이 화면에 없다 — 부담·판정·한계는 세금 탭 한 곳에서만 말한다.
 * 여기서 그리는 것은 우리가 실제로 가진 사실(거래 시점의 법정통화 금액)뿐이고,
 * 그 사실이 무엇이 **아닌지**(현재 평가액이 아님)를 선 아래에서 계속 밝힌다.
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
}: {
  events: NormalizedEvent[];
  /** 목록 조회 상태. 재조회·실패 중이면 이 선도 "지금 것"이 아니다. */
  state: FreshState;
  /** 목록을 일부만 받아왔는가. 그러면 선도 일부다. */
  truncated?: boolean;
  /** 잔액 가리기 모드. 선의 형태는 유지하되 금액 텍스트만 가린다. */
  hideBalances?: boolean;
}) {
  const [rangeId, setRangeId] = useState<RangeId>("ALL");
  const series = buildFlowSeries(events);
  const range = FLOW_RANGES.find((item) => item.id === rangeId) ?? FLOW_RANGES[FLOW_RANGES.length - 1];
  const slice = windowOf(series.points, range);
  const last = series.points[series.points.length - 1];
  const currency = series.currency;
  const geometry = slice ? flowGeometry(slice.plot, WIDTH, HEIGHT) : null;
  const notice = omissionDetail(series.omitted);
  const omitted = omittedTotal(series.omitted);

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
                <span aria-hidden="true">{isNegative(slice.change) ? "▼" : "▲"}</span>{" "}
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
            <p className="mt-1 text-xs text-zinc-400">{range.label} 변화</p>
          </div>
        ) : null}
      </div>

      {geometry ? (
        <svg
          role="img"
          aria-label={`${formatDate(new Date(slice!.fromMs).toISOString())}부터 ${formatDate(new Date(slice!.toMs).toISOString())}까지 누적 순유입 선 그래프`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="mt-4 h-44 w-full"
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
        </svg>
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
            aria-pressed={item.id === rangeId}
            className={rangeClass(item.id === rangeId)}
            onClick={() => setRangeId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {slice && slice.points.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-400">
          {formatDate(new Date(slice.fromMs).toISOString())} ~ {formatDate(new Date(slice.toMs).toISOString())} · 마지막 거래 기준
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
