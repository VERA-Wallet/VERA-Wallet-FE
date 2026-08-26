"use client";

import { CalendarRange, ChevronDown } from "lucide-react";
import { useState } from "react";
import { FLOW_RANGES } from "@/lib/portfolio/flow-series";
import { DEFAULT_PERIOD, customPeriodError, isDefaultPeriod } from "@/lib/portfolio/period-selection";
import type { PeriodSelection } from "@/lib/portfolio/period-selection";

/**
 * 거래 요약이 보고 있는 **기간을 고르는 문**.
 *
 * 지금까지 이 자리는 요약이 준 기간을 읽어 주기만 했다. 그런데 사용자가 실제로 하려는 일은
 * "작년 1월부터 3월까지만 보기"이고, 그건 화면 어디에도 문이 없었다.
 *
 * 프리셋(그래프 버튼과 **같은 것**)과 직접 지정을 한 패널에 둔다 — 둘이 서로 다른 곳에 있으면
 * 사용자는 지금 기간이 어느 쪽에서 왔는지 추적할 수 없다.
 *
 * 이 선택이 무엇을 바꾸고 무엇을 **바꾸지 않는지**는 패널 안에서 밝힌다. 목록·그래프는 좁아지지만
 * 손익·계산 대상 건수는 과세연도 기준이라 흔들리지 않는다. 그 사실을 숨기면 사용자는
 * 기간을 좁혔는데 손익이 그대로인 화면을 보고 계산이 틀렸다고 읽게 된다.
 */
export function PeriodPicker({
  label,
  selection,
  onSelect,
}: {
  /** 지금 기간을 사람이 읽는 문장으로. 고르지 않았으면 요약이 말하는 기간이 그대로 온다. */
  label: string;
  selection: PeriodSelection;
  onSelect: (next: PeriodSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  // 직접 지정 입력은 **적용하기 전까지** 화면 기간이 아니다. 타이핑 도중의 반쪽 날짜로
  // 목록과 선을 계속 다시 자르면 사용자는 자기가 무엇을 보고 있는지 알 수 없다.
  const [from, setFrom] = useState(selection.kind === "custom" ? selection.from : "");
  const [to, setTo] = useState(selection.kind === "custom" ? selection.to : "");
  const [error, setError] = useState<string | null>(null);

  const presetId = selection.kind === "preset" ? selection.id : null;

  const apply = () => {
    const message = customPeriodError(from, to);
    setError(message);
    if (message !== null) return;
    onSelect({ kind: "custom", from, to });
    setOpen(false);
  };

  const reset = () => {
    setFrom("");
    setTo("");
    setError(null);
    onSelect(DEFAULT_PERIOD);
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg text-sm text-zinc-500 underline decoration-zinc-300 underline-offset-4"
        onClick={() => setOpen(!open)}
      >
        <CalendarRange aria-hidden="true" className="size-4" />
        {label}
        <span className="sr-only">기간 바꾸기</span>
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          data-surface="dashboard-period-picker"
          className="mt-2 w-full max-w-md rounded-card border border-zinc-200 bg-white p-3 shadow-card"
        >
          <div className="flex flex-wrap gap-1.5" aria-label="기간 프리셋">
            {FLOW_RANGES.map((range) => (
              <button
                key={range.id}
                type="button"
                aria-pressed={range.id === presetId}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  range.id === presetId ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"
                }`}
                onClick={() => {
                  setError(null);
                  onSelect({ kind: "preset", id: range.id });
                }}
              >
                {range.label}
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-zinc-100 pt-3">
            <p className="text-xs font-semibold text-zinc-500">직접 지정</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="시작일"
                value={from}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900"
                onChange={(event) => setFrom(event.target.value)}
              />
              <span aria-hidden="true" className="text-sm text-zinc-400">
                ~
              </span>
              <input
                type="date"
                aria-label="종료일"
                value={to}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900"
                onChange={(event) => setTo(event.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white"
                onClick={apply}
              >
                적용
              </button>
            </div>
            {/* 왜 적용되지 않았는지 말하지 않으면, 사용자는 버튼이 고장 났다고 읽는다. */}
            {error ? (
              <p role="alert" className="mt-2 text-sm text-orange-700">
                {error}
              </p>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3">
            {/* 이 선택이 무엇을 바꾸지 **않는지**를 고르는 자리에서 함께 말한다. */}
            <p className="text-xs leading-5 text-zinc-500">
              목록과 그래프만 이 기간으로 좁힙니다. 손익·계산 대상 건수는 과세연도 기준이라 바뀌지 않습니다.
            </p>
            {isDefaultPeriod(selection) ? null : (
              <button type="button" className="shrink-0 text-xs font-semibold text-zinc-500 underline" onClick={reset}>
                전체 기간
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
