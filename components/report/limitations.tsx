"use client";

import Link from "next/link";
import { useState } from "react";

import { LIMITATION_LABEL, LIMITATION_STYLE } from "@/components/report/labels";
import { plainLimitations, type LimitationRow } from "@/lib/tax/limitations";
import type { LimitationKind, TaxEstimate } from "@/lib/tax/types";

/** 한 종류에서 먼저 보이는 줄 수. 나머지는 접어 두고 버튼으로 편다. */
const VISIBLE_PER_GROUP = 5;

function eventCountOf(rows: readonly LimitationRow[]): number {
  return new Set(rows.flatMap((row) => row.eventIds)).size;
}

/**
 * 이 답이 흔들리는 지점. 영향이 큰 순서. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않는다.
 *
 * 엔진은 제외 이벤트마다 한 줄씩(id 포함) 보낸다. 그대로 그리면 같은 문장이 수십 장 쌓이고 카드마다
 * 72자 id가 두 번 찍힌다(실지갑 50장 관측, 이 화면 하나가 8,716px). `plainLimitations`가 종류·문구로 묶어
 * 건수를 앞세우고, id는 떼고, 상태값(UNKNOWN, ESTIMATED) 대신 사람 말로 바꾸고, "그래서 무엇을 하면 되는지"를
 * 한 줄 더한다. 매핑이 없는 문구는 지어내지 않고 그대로 보인다.
 */
export function Limitations({ limitations }: { limitations: TaxEstimate["limitations"] }) {
  const [expanded, setExpanded] = useState<Partial<Record<LimitationKind, boolean>>>({});

  const rows = plainLimitations(limitations);
  // 묶음의 순서도, 묶음 안의 순서도 원래 배열 순서(=영향이 큰 순서)를 그대로 보존한다.
  // 종류 이름으로 다시 정렬하면 엔진이 매긴 우선순위가 지워진다.
  const groups: { kind: LimitationKind; rows: LimitationRow[] }[] = [];
  for (const row of rows) {
    const group = groups.find((candidate) => candidate.kind === row.kind);
    if (group) group.rows.push(row);
    else groups.push({ kind: row.kind, rows: [row] });
  }
  const eventCount = eventCountOf(rows);

  return (
    <section className="mt-6" aria-label="계산 결과 확인 사항">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-bold text-zinc-900">계산 결과 확인 사항</h3>
        {eventCount > 0 ? <span className="shrink-0 text-sm font-semibold text-zinc-700 tabular-nums">{eventCount}건</span> : null}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        계산에서 제외되었거나 추가 확인이 필요한 항목입니다. 항목별 세금 변동 금액은 산출하지 않았습니다.
      </p>
      {groups.map((group) => {
        const open = expanded[group.kind] ?? false;
        const shown = open ? group.rows : group.rows.slice(0, VISIBLE_PER_GROUP);
        const hidden = group.rows.length - shown.length;
        const groupEvents = eventCountOf(group.rows);
        return (
          <section key={group.kind} data-limitation-group={group.kind} className="mt-4">
            <h4 className="flex items-center gap-2">
              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LIMITATION_STYLE[group.kind]}`}>
                {LIMITATION_LABEL[group.kind]}
              </span>
              {/* 거래에 닿는 한계는 거래 건수로 말한다. 거래 없이 계산 전체에 걸리는 한계(가스비 등)는 건수를 달지 않는다. */}
              {groupEvents > 0 ? <span className="text-sm font-semibold text-zinc-700 tabular-nums">{groupEvents}건</span> : null}
            </h4>
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {shown.map((row, index) => (
                // 그리드 아이템은 min-width:auto라 띄어쓰기 없는 긴 토큰이 있으면 카드가 껍데기 밖으로 나간다. min-w-0로 바닥을 없앤다.
                <li key={`${row.kind}-${index}`} className="min-w-0 rounded-card border border-zinc-200 bg-white p-3 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm leading-6 wrap-anywhere text-zinc-700">{row.title}</p>
                    {group.rows.length > 1 && row.eventIds.length > 0 ? (
                      <span className="shrink-0 text-sm font-semibold text-zinc-900 tabular-nums">{row.eventIds.length}건</span>
                    ) : null}
                  </div>
                  {row.detail ? <p className="text-sm leading-6 wrap-anywhere text-zinc-900">{row.detail}</p> : null}
                  {row.action ? <p className="mt-1 text-xs leading-5 wrap-anywhere text-zinc-500">{row.action}</p> : null}
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
        <span>확인 필요 거래 검토</span>
        <span className="shrink-0 font-semibold text-primary-600 underline">거래 확인</span>
      </Link>
    </section>
  );
}
