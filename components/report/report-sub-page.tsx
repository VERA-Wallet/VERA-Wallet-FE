"use client";

import Link from "next/link";

import { useReportContext } from "@/components/report/report-context";

/**
 * 리포트 하위 화면의 공통 껍데기.
 *
 * 하위 화면에는 귀속연도 칩(선택기)을 두지 않는다 — 연도를 바꾸는 자리는 메인 하나여야
 * 어느 화면에서 바꿨는지 헷갈리지 않는다. 대신 "2026년 귀속 · 한국"처럼 읽기 전용 한 줄로
 * 지금 무엇을 보고 있는지만 말한다. 나라·연도는 estimate에서 파생하고, 계산 전이면
 * 이름을 지어내지 않고 선택 중인 값으로 물러난다.
 */
export function ReportSubPage({
  surface,
  title,
  lede,
  children,
}: {
  /** `report-basis` | `report-issues` | `report-settings` | `report-compare` */
  surface: string;
  title: string;
  /** 제목 아래 한 줄. 이 화면이 무엇을 하는 곳인지 또는 여기서 바꾸면 무엇이 바뀌는지. */
  lede?: string;
  children: React.ReactNode;
}) {
  const { result, taxYear, country } = useReportContext();

  return (
    <main data-surface={surface} className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
      <Link href="/export" className="inline-flex min-h-11 items-center text-sm font-semibold text-zinc-500">
        ← 리포트
      </Link>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {result ? `${result.taxYear}년 귀속 · ${result.countryLabel}` : `${taxYear}년 귀속 · ${country}`}
      </p>
      {lede ? <p className="mt-1 text-sm leading-6 text-zinc-500">{lede}</p> : null}
      {children}
    </main>
  );
}
