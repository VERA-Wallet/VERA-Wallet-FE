"use client";

import { useEffect, useRef, type ReactNode } from "react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
};

const FOCUSABLE = 'a[href],button:not([disabled]),select,input,textarea,[tabindex]:not([tabindex="-1"])';

export function BottomSheet({
  open,
  onClose,
  children,
  title = "상세 내용",
}: BottomSheetProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const restoreFocus = document.activeElement as HTMLElement | null;
    // 열릴 때 시트 안으로 포커스를 옮기지 않으면 스크린리더·키보드 사용자는 뒤 배경에 갇힌다.
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(nativeEvent: KeyboardEvent) {
      if (nativeEvent.key === "Escape") {
        nativeEvent.stopPropagation();
        onClose();
        return;
      }
      if (nativeEvent.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (nativeEvent.shiftKey && (active === first || !panel.contains(active))) {
        nativeEvent.preventDefault();
        last.focus();
      } else if (!nativeEvent.shiftKey && active === last) {
        nativeEvent.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      restoreFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button
        aria-label="바텀시트 닫기"
        className="absolute inset-0 cursor-default bg-zinc-900/40"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-sheet bg-white px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3 shadow-sheet"
        ref={panelRef}
        role="dialog"
      >
        <div className="sticky top-0 -mx-5 -mt-3 bg-white px-5 pb-2 pt-3">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-zinc-300" />
        </div>
        <div className="mt-3">{children}</div>
      </section>
    </div>
  );
}
