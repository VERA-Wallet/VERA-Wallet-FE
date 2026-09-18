"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * 칩 스트립의 가로 스크롤 컨테이너.
 *
 * `overflow-x-auto`만 두면 브라우저가 트랙 폭을 차지하는 가로 스크롤바를 그린다(macOS "스크롤 막대 항상 표시",
 * 데스크톱 브라우저 기본). 대시보드 필터 영역은 칩 줄이 네 개 쌓이므로 회색 막대가 네 줄로 겹쳐 보이고,
 * 정작 필터보다 스크롤바가 먼저 눈에 띈다.
 *
 * 그렇다고 스크롤바만 숨기면 "오른쪽에 더 있다"는 **유일한 신호**가 사라져 칩이 잘린 채 끝나 버린다.
 * 그래서 신호를 지우는 게 아니라 옮긴다 — 넘치는 쪽 가장자리 페이드(모든 기기)와
 * 화살표 버튼(포인터가 있는 기기만). 터치 기기는 밀면 그만이라 화살표를 띄우지 않는다.
 *
 * 페이드는 **넘치는 쪽에만** 건다. 넘치지도 않는데 양끝을 흐리면 첫/마지막 칩이 이유 없이 반쯤 지워진다.
 *
 * 화살표는 `aria-hidden` + `tabIndex={-1}`이다. 키보드 사용자는 칩을 Tab으로 지나갈 때 브라우저가
 * 컨테이너를 알아서 스크롤해 주므로, 화살표를 탭 순서에 넣으면 아무 것도 더 주지 못하면서 순서만 길어진다.
 */

/** 페이드 폭. 칩 하나를 다 덮지 않으면서 잘린 글자를 뭉갤 만큼. */
const FADE_PX = 20;
/** 화살표 한 번에 넘기는 양. 한 화면을 통째로 넘기면 방금 본 칩이 사라져 맥락이 끊긴다. */
const NUDGE_RATIO = 0.8;

type Edges = { start: boolean; end: boolean };

function maskFor({ start, end }: Edges): string | undefined {
  if (start && end) return `linear-gradient(to right, transparent 0, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), transparent 100%)`;
  if (start) return `linear-gradient(to right, transparent 0, #000 ${FADE_PX}px)`;
  if (end) return `linear-gradient(to right, #000 calc(100% - ${FADE_PX}px), transparent 100%)`;
  return undefined;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

/** `className`은 바깥 래퍼에 붙는다 — 호출부가 주는 건 늘 바깥 여백이고, 스크롤 줄 자체의 클래스는 이 컴포넌트가 소유한다. */
type ChipScrollerProps = { children: ReactNode; className?: string } & Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "ref">;

export function ChipScroller({ children, className = "", ...rest }: ChipScrollerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 소수 픽셀 폭 때문에 끝까지 밀어도 scrollLeft가 1px 모자란 값에서 멈춘다 — 여유를 두지 않으면 페이드가 안 꺼진다.
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  // 칩 개수와 라벨(건수)은 다른 필터를 누를 때마다 바뀌고, 그때마다 넘침 여부가 뒤집힌다.
  // ResizeObserver는 컨테이너 **자기** 폭만 보므로 그 변화를 못 잡는다 — 매 렌더 후 다시 잰다.
  // measure()는 값이 같으면 setState를 건너뛰므로 렌더 루프가 되지 않는다.
  useEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  function nudge(direction: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    // 전역 CSS가 애니메이션만 줄이고 스크롤 동작은 건드리지 않으므로 여기서 따로 존중한다.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * NUDGE_RATIO), behavior: reduced ? "auto" : "smooth" });
  }

  const arrowClass =
    "absolute top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm backdrop-blur-sm [@media(hover:hover)]:flex hover:bg-white";

  return (
    <div className={`relative ${className}`}>
      <div
        {...rest}
        ref={ref}
        className="flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={measure}
        style={{ maskImage: maskFor(edges), WebkitMaskImage: maskFor(edges) }}
      >
        {children}
      </div>
      {edges.start ? (
        <button type="button" aria-hidden="true" tabIndex={-1} className={`${arrowClass} left-0`} onClick={() => nudge(-1)}>
          <Chevron direction="left" />
        </button>
      ) : null}
      {edges.end ? (
        <button type="button" aria-hidden="true" tabIndex={-1} className={`${arrowClass} right-0`} onClick={() => nudge(1)}>
          <Chevron direction="right" />
        </button>
      ) : null}
    </div>
  );
}
