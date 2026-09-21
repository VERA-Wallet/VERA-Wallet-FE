import { Card } from "@/components/ui/card";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { buildFilingSummary } from "@/lib/export/report";
import { formatFiat } from "@/lib/format";
import { estimateConfidence } from "@/lib/tax/estimate-summary";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 그룹형 리포트 라인. 값은 `buildFilingSummary(estimate)`에서만 파생한다 — 화면이 룰셋 조건을
 * 다시 쓰면 계산·리포트·화면이 서로 다른 답을 말한다. 여기서는 소계·차감 위계만 정한다.
 */
type ReportLineSpec = { label: string; source: string; role: "item" | "subtract" | "subtotal" | "total" };
const REPORT_LINES: readonly ReportLineSpec[] = [
  { label: "총수입금액", source: "총수입금액", role: "item" },
  { label: "필요경비", source: "필요경비", role: "subtract" },
  { label: "기타소득금액", source: "기타소득금액", role: "subtotal" },
  { label: "기본공제", source: "기본공제", role: "subtract" },
  { label: "과세표준", source: "과세표준", role: "subtotal" },
  { label: "소득세", source: "산출 소득세", role: "item" },
  { label: "개인지방소득세", source: "개인지방소득세", role: "item" },
  { label: "예상 부담", source: "예상 합계 부담", role: "total" },
];

/**
 * 신고 기입란 8줄 + 신뢰도 칩.
 *
 * 계산은 무료로 전부 보인다 — 잠기는 것은 파일 내려받기뿐이다(2026-09-17 사용자 결정).
 * 예전에는 미구독자에게 금액을 블러로 가렸고, 그래서 `/plan`의 "잠기는 것은 다운로드뿐"이 거짓이었다.
 */
export function ReportCard({ estimate }: { estimate: TaxEstimate }) {
  // 리포트 라인은 estimate 하나(buildFilingSummary)에서만 파생한다 — 하드코딩하지 않는다.
  const filing = buildFilingSummary(estimate);
  const filingAmount = (label: string): string => {
    const value = filing.find((row) => row.기입란 === label)?.금액;
    return typeof value === "number" ? String(value) : "0";
  };

  // 신뢰도 칩은 문구를 지어내지 않고 estimate 구조에서만 파생한다.
  const confidence = estimateConfidence(estimate);
  const confidenceParts: string[] = [];
  if (confidence.notReflected > 0) confidenceParts.push(`미반영 ${confidence.notReflected}`);
  if (confidence.zeroBasis > 0) confidenceParts.push(`원가 0원 ${confidence.zeroBasis}`);
  if (confidence.partial) confidenceParts.push("부분집계");

  return (
    <Card className="mt-5">
      <div data-surface="report-preview" className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-zinc-900">기타소득 계산</p>
          {estimate.status === "PARTIAL" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">잠정</span>
          )}
        </div>
        <ProvenanceChip provenance={estimate.provenance} />
      </div>
      <dl className="mt-4">
        {REPORT_LINES.map((line) => {
          const emphasize = line.role === "subtotal" || line.role === "total";
          return (
            <div
              key={line.source}
              className={`flex items-center justify-between gap-3 py-2 ${
                line.role === "subtotal" ? "border-t border-zinc-200" : line.role === "total" ? "mt-1 border-t-2 border-zinc-300" : ""
              }`}
            >
              <dt className={`text-sm ${emphasize ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>{line.label}</dt>
              <dd
                className={`tabular-nums ${
                  line.role === "total"
                    ? "text-base font-bold text-primary-600"
                    : emphasize
                      ? "text-sm font-semibold text-zinc-900"
                      : "text-sm text-zinc-700"
                }`}
              >
                {line.role === "subtract" ? "− " : ""}
                {formatFiat(filingAmount(line.source), estimate.currency)}
              </dd>
            </div>
          );
        })}
      </dl>
      {confidenceParts.length > 0 && (
        <p className="mt-4 inline-flex rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 tabular-nums">
          {confidenceParts.join(" · ")}
        </p>
      )}
    </Card>
  );
}
