"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Limitations } from "@/components/report/limitations";
import { OpenQuestions } from "@/components/report/open-questions";
import { useReportContext } from "@/components/report/report-context";
import { ReportSubPage } from "@/components/report/report-sub-page";

/**
 * 확인할 것 — 이 답이 흔들리는 지점과 판단이 필요한 항목.
 *
 * 메인에서 이 한 덩어리가 8,716px이었다(2026-09-18 실측). 페이지를 나눠도 건수가 그대로면
 * 길이도 그대로이므로, `Limitations`가 종류별로 묶어 처음 5건만 보이고 나머지는 접는다.
 */
export function ReportIssues() {
  const { result, hasNothingToCompute, nudgeCount } = useReportContext();

  const shaky = result !== undefined && !hasNothingToCompute && result.limitations.length > 0;
  const open = result !== undefined && result.openQuestions.length > 0;

  return (
    <ReportSubPage surface="report-issues" title="확인할 것">
      {/* 셀 것이 없는 기간에는 흔들 답 자체가 없다. */}
      {shaky && result ? <Limitations limitations={result.limitations} /> : null}

      {open && result ? <OpenQuestions openQuestions={result.openQuestions} /> : null}

      {/* 확인 필요 넛지 — 신호가 있을 때만. 강제 게이트가 아니다. */}
      {result && nudgeCount > 0 ? (
        <Link
          href="/transactions?tab=review"
          data-surface="review-nudge"
          className="mt-5 flex items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            <span className="font-semibold">확인 필요 {nudgeCount}건</span> · 계산에서 빠진 이벤트를 정리하면 더 정확해져요
          </span>
          <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
        </Link>
      ) : null}

      {/* 빈 화면에 아무 말도 없으면 사용자는 아직 계산이 안 끝난 것인지, 정말 볼 것이 없는 것인지 모른다. */}
      {result !== undefined && !shaky && !open && nudgeCount === 0 ? (
        <p className="mt-6 text-sm leading-6 text-zinc-500">
          지금 계산에서 흔들리는 지점도, 판단이 필요한 항목도 없습니다.
        </p>
      ) : null}
      {result === undefined ? (
        <p className="mt-6 text-sm leading-6 text-zinc-500">아직 계산하지 않아 확인할 것을 셀 수 없습니다.</p>
      ) : null}
    </ReportSubPage>
  );
}
