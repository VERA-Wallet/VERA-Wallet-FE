"use client";

import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { PLANS, usePlan } from "@/lib/plan/use-plan";
import { useTaxYear } from "@/lib/tax/tax-year-context";

/**
 * 플랜 화면 — 결제는 **데모**다.
 *
 * 버튼을 누르면 결제창이 아니라 브라우저 로컬 상태만 바뀐다(`lib/plan/use-plan.ts`).
 * 그래서 화면은 활성 배지 옆에 늘 "실제 결제 아님"을 함께 말한다 — 배지만 보이면
 * 사용자는 청구가 일어났다고 오해한다.
 */
export function PlanView({ taxYear: fallbackTaxYear }: { taxYear: number }) {
  const { plan, activate, deactivate } = usePlan();
  // 결제 단위는 과세연도다. 세금 화면에서 고른 연도가 있으면 결제도 그 연도에 귀속돼야 한다 —
  // 서버가 내려준 값은 사용자가 아직 고르지 않았을 때의 기본값(마지막 활동연도)으로만 쓴다.
  const [taxYear] = useTaxYear(fallbackTaxYear);

  return (
    <main className="min-h-dvh px-5 py-8">
      <div data-surface="plan" className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">내보낼 때만 결제하세요</h1>
        <MockProvenanceChip />
      </div>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        조회·판정·시뮬레이터는 계속 무료입니다. 명세 파일을 내려받을 때 과세연도당 한 번 결제합니다.
      </p>

      {/*
        3열로 벌리지 않는다. Tailwind의 `sm:`은 컨테이너가 아니라 뷰포트 폭을 보는데,
        앱 껍데기는 어느 화면에서든 `max-w-md`(448px)로 고정이다(`app/layout.tsx`).
        데스크톱 브라우저에서 `sm:grid-cols-3`를 켜면 448px 안에 카드 셋이 욱여넣어져
        가격과 버튼 글자가 줄줄이 터진다 — 넓어진 것은 창이지 이 컨테이너가 아니다.
      */}
      <ul aria-label="플랜" className="mt-8 grid gap-4">
        {PLANS.map((definition) => {
          const active = plan !== null && plan.tier === definition.id;
          // 결제 대상이 아닌 카드는 tier가 없다. 좁힌 값을 const로 들고 있어야
          // onClick 클로저 안에서도 "무료가 아니다"가 유지된다.
          const tier = definition.id === "free" ? null : definition.id;
          return (
            <li key={definition.id}>
              <Card className={`h-full ${active ? "ring-2 ring-primary-500" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-zinc-900">{definition.name}</p>
                  {active && (
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-600">
                      활성 · {plan.taxYear}년
                    </span>
                  )}
                </div>
                <p className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">
                  {definition.priceLabel}
                  {tier !== null && <span className="ml-1 text-sm font-medium text-zinc-500">/ 과세연도</span>}
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{definition.summary}</p>
                {tier === null ? (
                  // 무료는 고를 대상이 아니다 — 결제하지 않은 모든 사용자가 이미 여기 있다.
                  <p className="mt-5 text-sm font-medium text-zinc-500">결제 없이 사용 중</p>
                ) : active ? (
                  <button
                    className="mt-5 w-full rounded-xl border border-primary-500 py-3.5 font-semibold text-primary-600"
                    type="button"
                    onClick={deactivate}
                  >
                    데모 결제 해제
                  </button>
                ) : (
                  <button
                    className="mt-5 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
                    type="button"
                    onClick={() => activate(tier, taxYear)}
                  >
                    데모 결제로 {plan === null ? "시작" : "바꾸기"} (실제 결제 아님)
                  </button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-sm leading-6 text-zinc-600">
        플랜은 계산 결과를 바꾸지 않습니다 — 잠기는 것은 다운로드뿐입니다.
      </p>
      <p className="mt-1 text-sm leading-6 text-zinc-500">결제는 데모입니다. 실제 청구가 발생하지 않습니다.</p>
    </main>
  );
}
