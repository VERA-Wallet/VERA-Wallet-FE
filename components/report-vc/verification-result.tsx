"use client";

import { ValueText } from "@/components/ui/value-text";
import { CircleCheck, CircleHelp, CircleX, MinusCircle } from "lucide-react";

import { CopyValue } from "@/components/report-vc/primitives";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { formatDateTime, formatFiat } from "@/lib/format";
import type { Provenance } from "@/lib/http/envelope";
import type { CheckOutcome, RevocationOutcome, VerificationResult, VersionOutcome } from "@/lib/report-vc/types";

/**
 * 검증 결과. 항목마다 서버가 말한 것만 그대로 보인다.
 *
 * - `unknown`(확인 못 함)·`unsupported`(미지원)·`failed`(실패)는 어느 것도 성공 아이콘을 쓰지 않는다.
 * - "폐기되지 않음"과 "최신 버전"은 서로 다른 항목이다.
 * - 계정 연결은 서버가 `verified`라고 말할 때만 보인다.
 * - 이름·CI·VP 원문은 받지도, 보이지도 않는다. 공개가 허용된 클레임만 그린다.
 */
type Tone = "pass" | "fail" | "unknown" | "unsupported";

const ICON: Record<Tone, { Icon: typeof CircleCheck; className: string; label: string }> = {
  pass: { Icon: CircleCheck, className: "text-emerald-600", label: "확인됨" },
  fail: { Icon: CircleX, className: "text-red-600", label: "실패" },
  unknown: { Icon: CircleHelp, className: "text-zinc-400", label: "확인 못 함" },
  unsupported: { Icon: MinusCircle, className: "text-zinc-400", label: "미지원" },
};

function outcomeTone(outcome: CheckOutcome): Tone {
  return outcome === "passed" ? "pass" : outcome === "failed" ? "fail" : outcome;
}

const REVOCATION: Record<RevocationOutcome, { tone: Tone; text: string }> = {
  active: { tone: "pass", text: "폐기되지 않음" },
  revoked: { tone: "fail", text: "폐기됨" },
  unknown: { tone: "unknown", text: "폐기 여부를 확인하지 못함" },
  unsupported: { tone: "unsupported", text: "폐기 조회 미지원" },
};

const VERSION: Record<VersionOutcome, { tone: Tone; text: string }> = {
  latest: { tone: "pass", text: "최신 버전" },
  superseded: { tone: "fail", text: "이후 버전이 있음" },
  unknown: { tone: "unknown", text: "최신 여부를 확인하지 못함" },
  unsupported: { tone: "unsupported", text: "버전 조회 미지원" },
};

function Row({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  const { Icon, className, label } = ICON[tone];
  return (
    <li className="flex items-start gap-2.5 py-2" data-outcome={tone}>
      <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${className}`} strokeWidth={2.2} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900">
          {title} <span className="sr-only">: {label}</span>
        </p>
        <p className="text-sm text-zinc-500">{detail}</p>
      </div>
    </li>
  );
}

export function VerificationResultView({ result, provenance }: { result: VerificationResult; provenance: Provenance }) {
  const verified = result.status === "verified" && provenance === "live";
  const { checks, claims } = result;
  return (
    <div data-surface="report-vc-verify-result" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p role="status" className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            {result.status === "verified"
              ? <CircleCheck aria-hidden className={`size-5 shrink-0 ${verified ? "text-emerald-600" : "text-zinc-400"}`} />
              : <CircleX aria-hidden className="size-5 shrink-0 text-red-600" />}
            {result.status === "verified" ? "제출된 증명서를 검증했습니다" : "검증에 실패했습니다"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatDateTime(result.checkedAt)}
            {provenance === "mock" && " · 예제 데이터 · 실제 검증 아님"}
          </p>
        </div>
        {provenance === "mock" ? <ProvenanceChip provenance="mock" /> : null}
      </div>

      <ul className="divide-y divide-zinc-100 rounded-card border border-zinc-200 bg-white px-3" aria-label="검증 항목">
        <Row
          tone={outcomeTone(checks.issuerAndPresentation)}
          title="발급자·제출자 서명 확인"
          detail={checks.issuerAndPresentation === "passed" ? "등록된 발급자의 서명과 제출 서명이 맞습니다" : checks.issuerAndPresentation === "failed" ? "발급자 또는 제출 서명을 확인하지 못했습니다" : ICON[outcomeTone(checks.issuerAndPresentation)].label}
        />
        <Row tone={REVOCATION[checks.revocation].tone} title="폐기 상태" detail={REVOCATION[checks.revocation].text} />
        <Row tone={VERSION[checks.version].tone} title="최신 버전 여부" detail={VERSION[checks.version].text} />
        <Row
          tone={outcomeTone(checks.chainAnchor)}
          title="체인 기록과 근거 루트 일치"
          detail={checks.chainAnchor === "passed" ? "체인에 기록된 해시가 증명서의 근거 루트와 같습니다" : checks.chainAnchor === "failed" ? "체인 기록과 근거 루트가 다릅니다" : ICON[outcomeTone(checks.chainAnchor)].label}
        />
        {result.accountLink === "verified" && (
          <Row tone="pass" title="모바일 신분증으로 확인된 계정" detail="발급 시점에 모바일 신분증 본인 확인을 마친 계정에서 발급되었습니다" />
        )}
      </ul>

      {claims && (
        <div className="space-y-2 rounded-card border border-zinc-200 bg-white p-3" data-surface="report-vc-verify-claims">
          <p className="text-sm font-semibold text-zinc-900">공개된 항목</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">리포트</dt><dd className="truncate font-mono text-xs text-zinc-800">{claims.reportId}</dd></div>
            <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">버전</dt><dd className="ml-auto min-w-0 max-w-full text-right text-zinc-800">{claims.version}</dd></div>
            <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">귀속연도</dt><dd className="ml-auto min-w-0 max-w-full text-right text-zinc-800">{claims.taxYear}년 · {claims.countryCode}</dd></div>
            <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">발급 시각</dt><dd className="text-right text-zinc-800">{formatDateTime(claims.issuedAt)}</dd></div>
          </dl>
          <CopyValue label="근거 루트" value={claims.evidenceRoot} />
          {claims.anchor?.txHash && <CopyValue label="체인 거래" value={claims.anchor.txHash} />}
          {claims.totals ? (
            <dl className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2 text-sm" data-surface="report-vc-verify-amounts">
              <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">예상 세금</dt><dd className="ml-auto min-w-0 max-w-full text-right font-semibold text-zinc-900"><ValueText>{formatFiat(claims.totals.estimatedCharge, "KRW")}</ValueText></dd></div>
              <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">과세 대상</dt><dd className="ml-auto min-w-0 max-w-full text-right text-zinc-800"><ValueText>{formatFiat(claims.totals.taxableGains, "KRW")}</ValueText></dd></div>
              <div className="flex flex-wrap items-baseline justify-between gap-3"><dt className="text-zinc-500">수령 소득</dt><dd className="ml-auto min-w-0 max-w-full text-right text-zinc-800"><ValueText>{formatFiat(claims.totals.incomeTotal, "KRW")}</ValueText></dd></div>
            </dl>
          ) : (
            <p className="text-xs text-zinc-500">금액은 이 검증에서 공개되지 않았습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
