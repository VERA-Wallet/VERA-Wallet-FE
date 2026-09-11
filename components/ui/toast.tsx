"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * 화면 위에 잠깐 떠서 방금 끝난 일을 알리는 한 줄.
 *
 * 사용자가 어느 탭에 있든 보여야 하므로 본문 흐름이 아니라 화면에 고정한다.
 * 하단 내비게이션 **위**에 앉히는 이유: 탭을 가리면 알림이 길을 막는 셈이 된다.
 *
 * 스스로 사라지되 **읽는 중에는 사라지지 않는다** — 마우스를 얹거나 포커스가 들어오면 시계를 멈춘다.
 * 라이브러리를 쓰지 않는 이유: 지금 필요한 것은 한 줄과 버튼 하나이고, 그건 이 파일보다 크지 않다.
 */

/** 한 줄을 읽고 버튼을 누를지 정하기에 충분한 시간. 더 짧으면 읽기 전에 사라지고, 더 길면 화면을 점유한다. */
export const TOAST_AUTO_DISMISS_MS = 3_000;

type ToastProps = {
  open: boolean;
  message: string;
  /** 없으면 알림만 남는다 — 할 일이 없는 알림에 버튼을 달지 않는다. */
  actionLabel?: string;
  onAction?: () => void;
  /** 스스로 물러날 때 호출된다. 상태의 주인은 호출부라 여기서 감추지 않는다. */
  onDismiss: () => void;
  autoDismissMs?: number;
};

export function Toast({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
  autoDismissMs = TOAST_AUTO_DISMISS_MS,
}: ToastProps) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!open || paused) return;
    const timer = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [open, paused, autoDismissMs, onDismiss]);

  if (!open) return null;

  return (
    // 바깥 층은 클릭을 통과시킨다 — 알림이 떠 있는 동안에도 그 아래 화면은 그대로 쓸 수 있어야 한다.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-40 mx-auto flex max-w-md justify-center px-4"
      data-surface="toast"
    >
      <div
        className="pointer-events-auto flex w-full items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-white shadow-sheet"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-500" aria-hidden="true">
          <Check className="size-4" strokeWidth={3} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">{message}</p>
        {actionLabel !== undefined && onAction !== undefined ? (
          <button type="button" className="shrink-0 px-1 py-2 text-sm font-bold text-primary-300" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
