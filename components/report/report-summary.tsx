import { ValueText } from "@/components/ui/value-text";
import { StatusBadge } from "@/components/report/labels";
import { formatFiat } from "@/lib/format";
import { halfOpenPeriodLabel } from "@/lib/period";
import { noChargeHeadline, omitsCharge } from "@/lib/tax/status";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 계산 요약 — 답(L1)과 그 답이 선 문맥(국가·기간·확정 상태)을 한 덩어리로 둔다.
 * 아래 리포트 카드(신고 기입란)와 같은 estimate 하나에서 나온다.
 */
export function ReportSummary({
  result,
  hasNothingToCompute,
  comparingLabel,
  onReturnHome,
}: {
  result: TaxEstimate;
  hasNothingToCompute: boolean;
  /** 거주국이 아닌 나라를 보고 있으면 그 나라 이름. 거주국이면 `null`. */
  comparingLabel: string | null;
  onReturnHome: () => void;
}) {
  return (
    <section className="mt-6" aria-label="계산 요약">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold text-zinc-900">{result.countryLabel} · {result.taxYear}</h2>
        <StatusBadge status={result.status} />
        {/* 계산 전제(예: 한국의 "거주자별 총평균법")를 답 바로 위에 상시 둔다.
            엔진의 method가 진실원천이라 나라·연도가 바뀌면 이 배지도 따라 바뀐다 — 하드코딩하지 않는다. */}
        <span
          data-testid="method-premise"
          className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700"
        >
          {result.method}
        </span>
        {/* 부분확정(PARTIAL)은 단가·부담이 아직 잠정이라는 뜻이다(엔진 note: "예상 부담은 잠정치…").
            큰 금액 옆에 그 사실이 계속 있어야 근거처럼 읽히지 않는다. */}
        {result.status === "PARTIAL" ? (
          <span
            data-testid="provisional-charge"
            className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
          >
            단가·예상 세금 잠정
          </span>
        ) : null}
      </div>
      {/* 과세기간은 화면이 다시 계산하면 안 된다. 영국 4/6~·호주 7/1~ 때문에 역년과 다르다. */}
      <p className="mt-1 text-sm text-zinc-500">과세기간 {halfOpenPeriodLabel(result.period)}</p>
      {/* 다른 나라를 고른 것은 비교다. 그 사실이 금액 옆에 계속 있어야 내려받기 잠금도 이해된다. */}
      {comparingLabel !== null ? (
        <div
          data-surface="comparing-country"
          className="mt-3 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-3"
        >
          <p className="text-sm leading-6 text-zinc-600">
            <span className="font-semibold">비교 중: {comparingLabel}</span> · 아래 금액은 거주국 기준이 아닙니다.
            신고 근거자료를 만들려면 거주국 기준으로 변경해 주세요.
          </p>
          <button
            type="button"
            onClick={onReturnHome}
            className="shrink-0 rounded-lg border border-primary-500 px-2.5 py-1 text-xs font-semibold text-primary-600"
          >
            거주국으로
          </button>
        </div>
      ) : null}
      {omitsCharge(result.status) ? (
        // 부담을 산출하지 않은 국가는 totals가 전부 0이다. 그대로 카드로 깔면 "낼 게 없다"로 읽힌다 — 이유 자체를 답으로 내보인다.
        <div className="mt-3 rounded-card border border-zinc-300 bg-white p-4 shadow-card">
          <p className="text-sm text-zinc-500">예상 세금</p>
          <p data-testid="estimated-charge" className="mt-1 text-2xl font-bold text-zinc-500">
            {noChargeHeadline(result.status)}
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {result.status === "SCHEDULED"
              ? `${result.taxYear}년 발생분은 시행일 전이라 과세 대상이 아닙니다. `
              : "과세 규칙이 확정되지 않아 금액을 산출하지 않습니다. "}
            {hasNothingToCompute
              ? "이 기간에는 집계할 원장 거래도 없습니다."
              : result.status === "SCHEDULED"
                ? "아래 계산 내역은 시행 전 원장 집계이며, 시행 후에는 같은 원장에 그대로 규칙이 적용됩니다."
                : "아래 계산 내역은 판정 전 원장 집계이며, 규칙이 확정되면 같은 원장에 그대로 적용됩니다."}
          </p>
        </div>
      ) : hasNothingToCompute ? (
        // 답이 0원인 것과 셀 것이 없는 것은 다른 사실이다.
        // "₩0"만 크게 띄우면 사용자는 "올해는 낼 게 없구나"로 읽는다.
        <div className="mt-3 rounded-card border border-zinc-300 bg-white p-4 shadow-card">
          <p className="text-sm text-zinc-500">예상 세금</p>
          <p data-testid="estimated-charge" className="mt-1 text-2xl font-bold text-zinc-500">계산할 거래 없음</p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            이 과세기간({halfOpenPeriodLabel(result.period)})에 계산 대상 거래가 없습니다.
            거래가 있는데도 비어 있다면 아래 과세연도를 확인해 주세요.
          </p>
        </div>
      ) : (
        <>
          {/* L1 — 답. 사용자가 이 화면에서 가장 먼저 알고 싶은 한 가지다. */}
          <div className="mt-3 rounded-card border border-primary-200 bg-white p-5 shadow-card">
            <p className="text-sm text-zinc-500">예상 세금</p>
            <p data-testid="estimated-charge" className="mt-1 text-4xl font-bold tracking-tight text-primary-600">
              <ValueText>{formatFiat(result.totals.estimatedCharge, result.currency)}</ValueText>
            </p>
            <p className="mt-1 text-sm text-zinc-500">실효세율 {result.totals.effectiveRatePercent}%</p>
          </div>
          {/* 답을 이루는 세 덩어리. 답보다 작게 둔다. */}
          <dl className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "과세 대상", value: result.totals.taxableGains, note: null, showNoteWhenZero: false },
              // exemptGains는 독일 보유기간 면세뿐 아니라 호주 50% 할인·캐나다 inclusion 비포함분·
              // 영국/이탈리아 연간 공제도 담는다. 전부 "면세"라 부르면 법적 처리를 잘못 단정한다.
              // 대신 상위 범주임을 밝히고, 법적 사유는 아래 계산 내역이 국가별로 말한다.
              // `showNoteWhenZero: false` — 0원이면 그 구성 요소가 없다는 뜻이라 붙이지 않는다.
              // 없는 제도를 있는 것처럼 암시하게 되기 때문이다.
              { label: "과세표준 제외", value: result.totals.exemptGains, note: "면세·할인·공제 합계", showNoteWhenZero: false },
              { label: "수령 소득", value: result.totals.incomeTotal, note: null, showNoteWhenZero: false },
            ].map((item) => (
              <div key={item.label} className="min-w-0 max-w-full flex-[1_1_max-content] rounded-card border border-zinc-200 bg-white p-3 shadow-card">
                <dt className="text-xs text-zinc-500">{item.label}</dt>
                <dd className="mt-1 text-sm font-bold text-zinc-900"><ValueText>{formatFiat(item.value, result.currency)}</ValueText></dd>
                {item.note !== null && (item.showNoteWhenZero || item.value !== "0") ? (
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">{item.note}</p>
                ) : null}
              </div>
            ))}
          </dl>
        </>
      )}
      {result.lossCarryforward !== "0" ? (
        // 룰셋의 lossCarryforward는 이번 기간에서 다 쓰지 못해 **다음 기간으로 넘길** 손실이다.
        <p className="mt-2 text-sm text-zinc-600">
          이월 손실: <ValueText>{formatFiat(result.lossCarryforward, result.currency)}</ValueText>
          {hasNothingToCompute ? " (이 기간에는 상계할 손익이 없었습니다)" : ""}
        </p>
      ) : null}
      {/* 제외 집합은 거래 탭 "확인 필요"와 같은 집합이다(lib/tax/derive.ts).
          고치러 갈 동선은 아래 확인 필요 넛지 한 곳에서만 연다 — 원가 0원 신호까지 합친 수를 말하므로
          여기서 제외 건수만 따로 또 말하면 같은 화면이 두 개의 "확인 필요"를 갖게 된다. */}
    </section>
  );
}
