"use client";

import Link from "next/link";
import { useState } from "react";

import { LIMITATION_LABEL, LIMITATION_STYLE } from "@/components/report/labels";
import { summarizeEventIds } from "@/lib/tax/limitations";
import type { LimitationKind, TaxEstimate } from "@/lib/tax/types";

/** 한 종류에서 먼저 보이는 건수. 나머지는 접어 두고 버튼으로 편다. */
const VISIBLE_PER_GROUP = 5;

/** 이 답이 흔들리는 지점 — 영향이 큰 순서. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않는다. */
export function Limitations({ limitations }: { limitations: TaxEstimate["limitations"] }) {
  const [expanded, setExpanded] = useState<Partial<Record<LimitationKind, boolean>>>({});

  // 수십 건을 한 줄씩 세우면 이 화면만으로 8,700px이 된다. 종류로 묶어 건수를 먼저 말한다.
  // 묶음의 순서도, 묶음 안의 순서도 원래 배열 순서(=영향이 큰 순서)를 그대로 보존한다 —
  // 종류 이름으로 다시 정렬하면 엔진이 매긴 우선순위가 지워진다.
  const groups: { kind: LimitationKind; rows: TaxEstimate["limitations"] }[] = [];
  for (const limitation of limitations) {
    const group = groups.find((candidate) => candidate.kind === limitation.kind);
    if (group) group.rows.push(limitation);
    else groups.push({ kind: limitation.kind, rows: [limitation] });
  }

  return (
    <section className="mt-6" aria-label="흔들리는 것">
      <h3 className="font-bold text-zinc-900">이 답이 흔들리는 지점</h3>
      <p className="mt-1 text-sm text-zinc-500">
        답에 영향이 큰 순서입니다. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않습니다.
      </p>
      {groups.map((group) => {
        const open = expanded[group.kind] ?? false;
        const shown = open ? group.rows : group.rows.slice(0, VISIBLE_PER_GROUP);
        const hidden = group.rows.length - shown.length;
        return (
          <section key={group.kind} data-limitation-group={group.kind} className="mt-4">
            <h4 className="flex items-center gap-2">
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LIMITATION_STYLE[group.kind]}`}>
                {LIMITATION_LABEL[group.kind]}
              </span>
              <span className="text-sm font-semibold text-zinc-700">{group.rows.length}건</span>
            </h4>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {shown.map((limitation, index) => (
                <li
                  key={`${limitation.kind}-${index}`}
                  className="rounded-card border border-zinc-200 bg-white p-3 shadow-card"
                >
                  {limitation.eventIds.length > 0 ? (
                    <p className="min-w-0 break-all text-xs text-zinc-400">{summarizeEventIds(limitation.eventIds)}</p>
                  ) : null}
                  {/* 메시지에 이벤트 id(66자, 공백 없음)가 섞여 온다. 끊을 곳이 없으면 카드가 껍데기 밖으로 나간다(실측 663px). */}
                  <p className="mt-1 text-sm leading-6 text-zinc-700 [overflow-wrap:anywhere]">{limitation.message}</p>
                </li>
              ))}
            </ul>
            {group.rows.length > VISIBLE_PER_GROUP ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded((prev) => ({ ...prev, [group.kind]: !open }))}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-card border border-zinc-200 bg-white text-sm font-semibold text-primary-600 shadow-card"
              >
                {open ? "접기" : `나머지 ${hidden}건 더 보기`}
              </button>
            ) : null}
          </section>
        );
      })}
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
