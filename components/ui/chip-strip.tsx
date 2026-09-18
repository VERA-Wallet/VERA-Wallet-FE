"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 필터 칩 한 줄.
 *
 * 칩이 한 줄을 넘칠 때 기기에 따라 다르게 푼다.
 * - 터치 기기: 가로로 밀어 본다. 스크롤바는 숨기고(항상 떠 있는 회색 막대는 칩 줄을 셋 겹쳐 놓으면 줄무늬가 된다)
 *   넘친 쪽 가장자리를 배경색으로 흐리게 해 "더 있다"를 말한다.
 * - 마우스 기기(pointer: fine): 줄을 바꿔 다 보여준다. 스크롤바를 숨긴 가로 스트립은 마우스로는 밀 방법이 없어
 *   (shift+휠을 아는 사람만 닿는다) 넘친 칩이 사라진 것과 같기 때문이다.
 *
 * 스트립은 부모의 좌우 패딩 밑으로 밀려 들어가 칩이 컬럼 끝까지 흐른다. 그래서 어느 면 위에 놓이는지를 `surface`로 받는다.
 */
const SURFACE = {
  /** 페이지 컬럼(`main px-5`, zinc-50 바탕) 바로 아래 */
  page: { scroller: "-mx-5 px-5", start: "-left-5 from-zinc-50", end: "-right-5 from-zinc-50" },
  /** 흰 카드(`p-4`) 안 */
  card: { scroller: "-mx-4 px-4", start: "-left-4 from-white", end: "-right-4 from-white" },
} as const;

type Props = {
  /** 스트립의 접근성 이름. 칩 버튼들을 직접 감싸는 요소에 붙는다. */
  label: string;
  surface?: keyof typeof SURFACE;
  gap?: "gap-1" | "gap-2";
  className?: string;
  children: ReactNode;
};

export function ChipStrip({ label, surface = "page", gap = "gap-2", className = "", children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);

  // 칩의 개수·건수가 바뀌면 넘침도 바뀐다. 렌더마다 다시 재되, 값이 같으면 setState가 렌더를 만들지 않는다.
  useEffect(measure);

  const s = SURFACE[surface];
  const fade = "pointer-events-none absolute inset-y-0 w-10 to-transparent transition-opacity pointer-fine:hidden";
  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        aria-label={label}
        className={`flex ${gap} overflow-x-auto scrollbar-none ${s.scroller} pointer-fine:mx-0 pointer-fine:flex-wrap pointer-fine:overflow-visible pointer-fine:px-0`}
      >
        {children}
      </div>
      <div aria-hidden="true" data-edge="start" data-visible={edges.start} className={`${fade} bg-linear-to-r ${s.start} ${edges.start ? "opacity-100" : "opacity-0"}`} />
      <div aria-hidden="true" data-edge="end" data-visible={edges.end} className={`${fade} bg-linear-to-l ${s.end} ${edges.end ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
