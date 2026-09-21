import { Lock } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { createReportLedgerCsv } from "@/lib/export/report";
import { createReportXlsx } from "@/lib/export/report-workbook";
import type { SummaryDTO } from "@/lib/http/dto";
import { periodFilePart, periodLabel } from "@/lib/period";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 용도별 내려받기.
 *
 * 잠금 규칙(`downloadLocked`)은 호출부가 정한 그대로 받는다 — 여기서 다시 판단하지 않는다.
 * `blockedReason`은 잠금과 다른 사실이다: 거주국이 아닌 나라를 비교 중이거나 데모 시나리오로
 * 보는 중이면 그 값으로 신고 근거자료를 만들 수 없다. 플랜과 무관하므로 자물쇠가 아니라 이유를 말한다.
 */
export function Downloads({
  events,
  estimate,
  summary,
  activePeriod,
  ready,
  downloadLocked,
  blockedReason,
  subscribed,
  planName,
  allowance,
  billableCount,
}: {
  events: NormalizedEvent[];
  estimate: TaxEstimate | null;
  summary: SummaryDTO | null;
  activePeriod: SummaryDTO["period"] | null;
  ready: boolean;
  downloadLocked: boolean;
  blockedReason: string | null;
  subscribed: boolean;
  planName: string;
  allowance: number;
  billableCount: number;
}) {
  // 파일명·기간 라벨은 선택 연도를 따른다 — estimate.period가 선택 연도의 과세기간을 싣는다.
  // estimate가 아직 없으면(로딩·미연동) 예전처럼 요약 기간으로 물러난다.
  const filenamePeriod = activePeriod ? periodFilePart(activePeriod) : "기간";
  const disabled = !ready || downloadLocked || blockedReason !== null;

  return (
    <Card className="mt-5">
      <p className="font-semibold text-zinc-900">내려받기</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        {summary ? `${periodLabel(activePeriod ?? summary.period)} · ${events.length}건` : "거래 내역을 불러오는 중입니다."}
      </p>
      {/* 위 줄의 건수는 파일에 들어갈 행 수다. 과금 건수는 그것과 다를 수 있으므로 기준과 수를 함께 적는다. */}
      <p className="mt-1 text-sm leading-6 text-zinc-500">
        건수는 계산 대상 이벤트 기준입니다{summary ? ` · 현재 ${billableCount.toLocaleString("ko-KR")}건` : ""}.
      </p>
      {/* 계산은 무료다 — 결제는 파일을 만들 때만 필요하다. 예전 배너처럼 "금액은 구독 후 공개"라고
          말하면 화면이 하지 않는 잠금을 광고하는 셈이 된다(금액 블러는 이제 없다). */}
      {!subscribed && (
        <p className="mt-1 text-sm leading-6 text-zinc-500">계산은 무료예요. 파일로 내려받을 때만 결제해요.</p>
      )}
      {blockedReason !== null && (
        <p data-surface="download-blocked" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
          {blockedReason}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {/* 직접 신고용(추천) — 홈택스 본인 신고. PDF 요약서 생성기가 없어 CSV 원장으로 구성한다. */}
        <div className="rounded-card border border-primary-200 bg-primary-50/40 p-4">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-zinc-900">직접 신고용</p>
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">추천</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">홈택스 본인 신고용 · CSV 원장(거래 부속명세)</p>
          <button
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-500 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            data-locked={downloadLocked ? "download" : undefined}
            disabled={disabled}
            type="button"
            onClick={() => download(createReportLedgerCsv(events, estimate), "text/csv;charset=utf-8", `verawallet-신고근거-${filenamePeriod}.csv`)}
          >
            {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
            직접 신고용 내려받기
          </button>
        </div>

        {/* 세무사 전달용 — XLSX 4시트(요약·자산별·원장·예외). 미리보기 목록을 여기에 흡수한다. */}
        <div className="rounded-card border border-zinc-200 p-4">
          <p className="font-semibold text-zinc-900">세무사 전달용</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            XLSX 4시트 · 요약(신고 기입란) · 자산별(취득가액 명세) · 원장(거래 부속명세) · 예외(판단보류·미반영)
          </p>
          <button
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            data-locked={downloadLocked ? "download" : undefined}
            disabled={disabled || !summary}
            type="button"
            onClick={() => download(createReportXlsx(events, estimate), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `verawallet-신고근거-${filenamePeriod}.xlsx`)}
          >
            {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
            세무사 전달용 내려받기
          </button>
        </div>

        {/* 보고서: 값만 늘어놓은 격자가 아니라 계산 흐름을 보이는 문서. 앱 화면(/export/report)에서 그대로 읽고,
            PDF는 거기서 브라우저 인쇄로 저장한다(한글 PDF를 직접 쓰려면 글꼴을 통째로 내장해야 해서).
            귀속연도·시행 가정은 리포트 한 벌이 공유하는 프로바이더에 살아 있어 링크에 실어 나르지 않는다. */}
        <div className="rounded-card border border-zinc-200 p-4">
          <p className="font-semibold text-zinc-900">보고서</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            표지 · 신고 요약(기입란) · 자산별 명세 · 예외와 한계를 한 문서로. 앱 안에서 읽고, 인쇄에서
            &lsquo;PDF로 저장&rsquo;을 고르면 파일이 됩니다.
          </p>
          {!disabled ? (
            <Link
              href="/export/report"
              data-surface="report-open"
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600"
            >
              보고서 보기
            </Link>
          ) : (
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary-500 py-3 font-semibold text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
              data-locked={downloadLocked ? "download" : undefined}
              data-surface="report-open"
              disabled
              type="button"
            >
              {downloadLocked && <Lock aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />}
              보고서 보기
            </button>
          )}
        </div>
      </div>

      {summary !== null && (
        // 잠기는 것은 다운로드뿐이다 — 위의 기간·건수와 아래 앵커링 증명은 그대로 보인다.
        // 잠기지 않았을 때도 남겨 둔다: 플랜은 탭에 없어서 이 줄이 앱 안의 유일한 진입로다.
        <Link
          href="/plan"
          className={`mt-3 flex items-center justify-between gap-3 rounded-card border p-3 text-sm ${
            downloadLocked ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-600"
          }`}
        >
          <span>
            {`${planName} 플랜 ${allowance.toLocaleString("ko-KR")}건까지 · 현재 ${billableCount.toLocaleString("ko-KR")}건`}
            {downloadLocked && (!subscribed ? " — 플랜이 필요합니다" : " — 상위 플랜이 필요합니다")}
          </span>
          <span className={`shrink-0 font-semibold underline ${downloadLocked ? "" : "text-primary-600"}`}>플랜 보기</span>
        </Link>
      )}
    </Card>
  );
}
