import Link from "next/link";

import { LIMITATION_LABEL, LIMITATION_STYLE } from "@/components/report/labels";
import { summarizeEventIds } from "@/lib/tax/limitations";
import type { TaxEstimate } from "@/lib/tax/types";

/** 이 답이 흔들리는 지점 — 영향이 큰 순서. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않는다. */
export function Limitations({ limitations }: { limitations: TaxEstimate["limitations"] }) {
  return (
    <section className="mt-6" aria-label="흔들리는 것">
      <h3 className="font-bold text-zinc-900">이 답이 흔들리는 지점</h3>
      <p className="mt-1 text-sm text-zinc-500">
        답에 영향이 큰 순서입니다. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않습니다.
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-2">
        {limitations.map((limitation, index) => (
          <li
            key={`${limitation.kind}-${index}`}
            className="rounded-card border border-zinc-200 bg-white p-3 shadow-card"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LIMITATION_STYLE[limitation.kind]}`}>
                {LIMITATION_LABEL[limitation.kind]}
              </span>
              {limitation.eventIds.length > 0 ? (
                <span className="min-w-0 break-all text-xs text-zinc-400">{summarizeEventIds(limitation.eventIds)}</span>
              ) : null}

            </div>
            {/* 메시지에 이벤트 id(66자, 공백 없음)가 섞여 온다. 끊을 곳이 없으면 카드가 껍데기 밖으로 나간다(실측 663px). */}
            <p className="mt-1 text-sm leading-6 text-zinc-700 [overflow-wrap:anywhere]">{limitation.message}</p>
          </li>
        ))}
      </ul>
      <Link
        href="/transactions?tab=review"
        className="mt-2 flex items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 text-sm text-zinc-700 shadow-card"
      >
        <span>확인 필요 거래에서 바로잡기</span>
        <span className="shrink-0 font-semibold text-primary-600 underline">확인 필요로</span>
      </Link>
    </section>
  );
}
