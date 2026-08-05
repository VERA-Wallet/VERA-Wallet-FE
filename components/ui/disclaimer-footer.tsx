"use client";

import { useState } from "react";

export function DisclaimerFooter() {
  const [expanded, setExpanded] = useState(false);

  return (
    // 계획 §9: 전 route에서 스크롤과 무관하게 하단에 고정 노출한다.
    // 전문은 항상 DOM에 남기고, 기본 상태에서는 한 줄로 접어 모바일 뷰포트를 덜 잡아먹게 한다.
    <footer
      data-testid="disclaimer-footer"
      className="sticky bottom-0 z-10 border-t border-zinc-200 bg-zinc-50/95 px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-[11px] leading-4 text-zinc-400 ${expanded ? "" : "line-clamp-1"}`}>
          본 서비스는 온체인 거래 내역을 정리·분류하는 계산 보조 도구이며, 세무 대리 또는 세무 상담을
          제공하지 않습니다. 산출된 결과는 참고용이며, 실제 신고는 세무 전문가의 검토를 거치시기
          바랍니다.
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          className="shrink-0 text-[11px] font-semibold text-zinc-500 underline underline-offset-2"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "접기" : "전문"}
        </button>
      </div>
    </footer>
  );
}
