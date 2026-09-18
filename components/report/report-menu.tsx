"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { useReportContext } from "@/components/report/report-context";

/**
 * 메인에서 나머지 네 화면으로 가는 줄.
 *
 * 줄마다 제목 옆에 **상태 한마디**를 붙인다. 제목만 있으면 사용자는 네 곳을 전부 열어봐야
 * 볼 것이 있는지 알 수 있다. 문구의 숫자는 전부 같은 estimate에서 파생한다 — 하드코딩하면
 * 메뉴가 말하는 상태와 그 화면이 실제로 보여주는 것이 갈린다.
 */
export function ReportMenu() {
  const {
    result,
    rulesets,
    source,
    yearEndFmv,
    requiresYearEndFmv,
    otherIncomeInput,
    carriedLossesInput,
    comparingLabel,
    walletConnected,
    nudgeCount,
  } = useReportContext();

  // 계산 근거 — 무엇을 세었는지. 양도는 손익 판정 행, 취득은 원가 추적용 취득 행이다(기간 밖도 남는다).
  const uniqueEvents = (predicate: (row: NonNullable<typeof result>["judgments"][number]) => boolean): number =>
    result ? new Set(result.judgments.filter(predicate).map((row) => row.eventId)).size : 0;
  const basisStatus = result
    ? `양도 ${uniqueEvents((row) => row.amountKind === "gain")}건 · 취득 ${uniqueEvents((row) => row.group === "acquire")}건`
    : "아직 계산하지 않았어요";

  // 확인할 것 — 흔들리는 지점과 판단이 필요한 항목. 둘 다 0이면 없다고 분명히 말한다.
  // 한계도 판단 항목도 없는데 계산에서 빠진 이벤트만 있는 경우가 있다(제외·원가 0원). 그때
  // "확인할 것이 없어요"라고 하면 그 화면의 넛지와 메뉴가 서로 다른 말을 한다.
  // 문구는 넛지("확인 필요 N건")와 겹치지 않게 다르게 쓴다 — 같은 수를 두 이름으로 부르지 않기 위해서다.
  const shakyCount = result?.limitations.length ?? 0;
  const openCount = result?.openQuestions.length ?? 0;
  const hasIssues = shakyCount > 0 || openCount > 0 || nudgeCount > 0;
  const issuesStatus = result
    ? shakyCount > 0 || openCount > 0
      ? `흔들리는 지점 ${shakyCount} · 판단 필요 ${openCount}`
      : nudgeCount > 0
        ? `정리할 이벤트 ${nudgeCount}건`
        : "확인할 것이 없어요"
    : "아직 계산하지 않았어요";

  // 계산 설정 — 지금 이 답이 어떤 입력 위에 서 있는지. 사용자가 바꾼 것이 있으면 그것부터 말한다.
  // 유효한 십진만 계산에 흘러가므로(use-report-inputs.ts) 세는 기준도 같다.
  const filledFmv = Object.values(yearEndFmv).filter((value) => /^\d+(?:\.\d+)?$/.test(value.trim())).length;
  const filledProfile = [otherIncomeInput, carriedLossesInput].filter((value) => value !== "").length;
  const filledInputs = filledFmv + filledProfile;
  const settingsStatus =
    source === "scenario"
      ? "데모 시나리오로 보는 중"
      : filledInputs > 0
        ? `직접 입력한 값 ${filledInputs}개`
        : requiresYearEndFmv
          ? "연말 시가 미입력"
          : walletConnected
            ? "내 지갑 이벤트로 계산 중"
            : "데모 시나리오로 보는 중";

  // 다른 나라였다면 — 비교 중이면 그 사실이 먼저다. 목록을 아직 못 받았으면 개수를 지어내지 않는다.
  const compareStatus =
    comparingLabel !== null
      ? `${comparingLabel} 기준으로 비교 중`
      : rulesets.data
        ? `${rulesets.data.length}개 나라 규칙과 비교`
        : "나라 목록을 불러오는 중";

  const items = [
    { menu: "basis", href: "/export/basis", title: "계산 근거", status: basisStatus, alert: false },
    { menu: "issues", href: "/export/issues", title: "확인할 것", status: issuesStatus, alert: hasIssues },
    { menu: "settings", href: "/export/settings", title: "계산 설정", status: settingsStatus, alert: false },
    { menu: "compare", href: "/export/compare", title: "다른 나라였다면", status: compareStatus, alert: false },
  ] as const;

  return (
    <section data-surface="report-menu" aria-label="리포트 메뉴" className="mt-6">
      <ul className="grid grid-cols-1 gap-2">
        {items.map((item) => (
          <li key={item.menu}>
            <Link
              href={item.href}
              data-menu={item.menu}
              className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white p-4 shadow-card"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold text-zinc-900">
                  {/* 점은 색만으로 말하지 않는다 — 무엇이 몇 건인지는 바로 아래 상태 문구가 글자로 말한다. */}
                  {item.alert ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-amber-500" /> : null}
                  {item.title}
                </span>
                <span className="mt-0.5 block text-sm text-zinc-500">{item.status}</span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-400" strokeWidth={2.5} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
