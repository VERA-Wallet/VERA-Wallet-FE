import Link from "next/link";

import { StatusBadge, TOPIC_LABEL } from "@/components/report/labels";
import type { TaxEstimate } from "@/lib/tax/types";

/** 판단이 필요한 항목 — 확정되면 어떻게 되는지(benchmark)를 접어두지 않고 본문에 둔다. */
export function OpenQuestions({ openQuestions }: { openQuestions: TaxEstimate["openQuestions"] }) {
  return (
    <section className="mt-6" aria-label="판단 필요 항목">
      <h3 className="font-bold text-zinc-900">판단이 필요한 항목</h3>
      <ul className="mt-2 grid grid-cols-1 gap-2">
        {openQuestions.map((question, index) => (
          <li key={`${question.topic}-${index}`} className="rounded-card border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-amber-900">{TOPIC_LABEL[question.topic]}</span>
              <StatusBadge status={question.status} />
            </div>
            <p className="mt-1 text-sm text-amber-900">{question.reason}</p>
            {question.benchmark ? (
              // 확정되면 어떻게 되는지를 접어두면 아무도 보지 않는다. 본문에 둔다.
              <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs leading-5 text-amber-900">
                확정되면 → {question.benchmark}
              </p>
            ) : null}
            {question.affectedEventIds.length > 0 ? (
              <Link
                href="/transactions"
                className="mt-2 inline-flex text-xs font-semibold text-amber-900 underline"
              >
                해당 이벤트 {question.affectedEventIds.length}건 보기
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
