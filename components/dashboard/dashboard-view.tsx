"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EventDetails } from "@/components/transactions/event-details";
import { EventRow } from "@/components/transactions/event-row";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ExchangeLinkSummary } from "@/components/dashboard/exchange-link-summary";
import { FlowChart } from "@/components/dashboard/flow-chart";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { DEFAULT_PERIOD, periodWindowLabel } from "@/lib/portfolio/period-selection";
import type { PeriodSelection } from "@/lib/portfolio/period-selection";
import { periodLabel } from "@/lib/period";
import { freshNotice } from "@/lib/queries/fresh";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { SummaryCard } from "@/components/ui/summary-card";
import { useHideBalances } from "@/lib/privacy/use-hide-balances";
import { formatFiat } from "@/lib/format";
import { hasConfidenceSignal } from "@/lib/tax/estimate-summary";
import { useTransactionList } from "@/lib/transactions/use-transaction-list";

/** 요약에 얹는 "최근 거래" 줄 수. 원장을 옮겨 심는 자리가 아니라 **문**이라 세 줄이면 족하다. */
const RECENT_COUNT = 3;

/**
 * 요약 화면.
 *
 * 전체 거래 목록은 거래 탭(`/transactions`)이 맡는다. 이 화면이 답하는 것은 셋뿐이다:
 * 지갑이 어떻게 움직였나(그래프), 이번 과세연도는 얼마인가(카드), 지금 손댈 것이 있나(확인 필요).
 * 목록까지 여기 있던 때에는 첫 거래 행이 1,200px 아래에서 시작했고, 그 위의 요약은 아무도 읽지 않았다.
 */
export function DashboardView({ countryCode }: { countryCode?: string }) {
  // 잔액 가리기. 서버는 저장소를 모르므로 첫 렌더는 항상 꺼짐이고, 마운트 후 저장값으로 복원한다.
  const [hideBalances, setHideBalances] = useHideBalances();
  // 이 화면이 보고 있는 기간. 헤더 문구와 그래프 창이 **이 하나**에서 나온다 —
  // 그래프만 따로 자르던 때는 "1개월"을 그려도 헤더는 전체 기간을 말했다.
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(DEFAULT_PERIOD);
  const {
    events,
    eventsFresh,
    eventsStale,
    summaryFresh,
    period,
    referencePeriod,
    taxYear,
    judgments,
    judgmentsPending,
    estimate,
    headline,
    headlineCurrency,
    confidence,
    importTracker,
    items,
    annotated,
    periodWindow,
    periodNarrowed,
    listItems,
    reviewItems,
    swapInLegOf,
    selectedKey,
    setSelectedKey,
    selected,
  } = useTransactionList({ countryCode, periodSelection });

  const recentItems = listItems.slice(0, RECENT_COUNT);

  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="dashboard-summary" className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">요약</h1>
          {/* 빈 기간을 ` ~ `로 보이면 기간이 있는 것처럼 말하는 셈이다.
              고르기 전에는 요약이 말하는 기간을 그대로 보이고, 고른 뒤에는 **고른 기간**을 말한다. */}
          {period ? (
            <PeriodPicker
              label={periodNarrowed ? periodWindowLabel(periodWindow!) : periodLabel(period)}
              selection={periodSelection}
              onSelect={setPeriodSelection}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex h-9 items-center gap-2">
            <MockProvenanceChip />
            {/* 설정은 탭 자리를 차지할 만큼 자주 가는 곳이 아니지만, 들어갈 문이 없으면 없는 화면이 된다. */}
            <Link href="/settings" aria-label="설정" className="rounded-lg p-1 text-zinc-400">
              <Settings aria-hidden="true" className="size-5" />
            </Link>
          </div>
          {/* 잔액만 가린다 — 배지·건수는 확인에 필요한 사실이지 금액이 아니므로 그대로 둔다. */}
          <button
            type="button"
            aria-pressed={hideBalances}
            className="text-xs font-medium text-zinc-500"
            onClick={() => setHideBalances(!hideBalances)}
          >
            {hideBalances ? "금액 표시" : "금액 가리기"}
          </button>
        </div>
      </header>
      {/* 이 화면은 지갑 이력이 그린 선까지만 말한다. 세금 금액·판정 기준·계산의 한계는
          세금 탭 한 곳에서만 답한다 — 두 화면이 각자 금액을 말하면 어느 쪽이 최신인지 알 수 없다. */}
      {/* 그래프의 기간 버튼은 자기 창만 바꾸지 않는다 — 헤더 문구가 함께 따라온다. */}
      <FlowChart
        events={items.map((item) => item.event)}
        state={eventsFresh.state}
        truncated={events.data?.truncated === true}
        hideBalances={hideBalances}
        selection={periodSelection}
        period={periodWindow}
        onSelect={setPeriodSelection}
      />

      <ExchangeLinkSummary />

      <section className="mt-6 grid grid-cols-1 gap-3">
        {/* 계산에 들어간 이벤트가 없으면 "0"은 손익이 아니라 계산할 것이 없었다는 뜻이다.
            손익은 세금 화면과 같은 estimate에서 파생한다 — 판정을 못 냈으면(headline 미정) 요약 상태를 그대로 말한다. */}
        <SummaryCard
          label="예상 손익"
          value={
            headline === undefined
              ? "—"
              : headline.computableEventCount === 0
                ? "계산할 거래 없음"
                : hideBalances
                  ? "•••••"
                  : formatFiat(headline.periodPnl, headlineCurrency)
          }
          supportingText={
            headline !== undefined && headline.computableEventCount === 0
              ? "가격·분류를 확정한 거래가 아직 없습니다."
              : undefined
          }
        />
        {/* 이 건수는 세금 계산에 실제로 들어간 기간 내 이벤트 수다(estimate 판정에서 파생). */}
        <SummaryCard
          // 실제 과세 여부는 판정 그룹(취득·비과세·상계 소멸…)이 정하므로 "과세 대상"이라 부르면 과장이다.
          label="계산 대상 이벤트"
          value={headline !== undefined ? `${headline.computableEventCount}건` : "—"}
          // 확인 필요 건수는 여기서 말하지 않는다. 요약의 pendingReviewCount는 다리(leg) 단위이고 아래 확인 필요
          // 카드·거래 탭은 스왑·브릿지를 묶은 행 단위라, 둘을 같이 두면 한 화면이 두 값을 말한다(실측 5,549 대 3,433).
          supportingText={
            summaryFresh.data
              ? estimate !== undefined && estimate.status !== "UNDETERMINED"
                ? "과세 여부는 거래 탭의 판정에서 갈립니다"
                : "과세 여부는 아직 판단하지 않았습니다"
              : (freshNotice(summaryFresh.state, "요약") ?? undefined)
          }
          // 불러오는 중이면 이 숫자는 아직 새 지갑을 모른다. 말하지 않으면 사용자는 건수가 틀렸다고 읽는다.
          note={importTracker.state.status === "running" ? "새 지갑 거래는 불러온 뒤 반영돼요" : undefined}
        />
        {/* 신뢰도 칩(P1-9) — 세금 화면 "흔들리는 지점"과 같은 estimate에서 파생한 건수를 헤드라인 옆에 압축한다.
            문구·건수는 하드코딩하지 않는다. 흔들릴 게 없으면(정상) 칩을 달지 않는다 — 없는 문제를 만들지 않기 위해서다.
            색만으로 구분하지 않도록 각 칩은 뜻과 건수를 글자로 함께 말한다. */}
        {confidence !== undefined && hasConfidenceSignal(confidence) ? (
          <div data-surface="dashboard-confidence" className="flex flex-wrap items-center gap-2" aria-label="계산 신뢰도">
            <span className="text-xs font-medium text-zinc-500">신뢰도</span>
            {confidence.notReflected > 0 ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                미반영 {confidence.notReflected}
              </span>
            ) : null}
            {confidence.zeroBasis > 0 ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900">
                원가0원 {confidence.zeroBasis}
              </span>
            ) : null}
            {confidence.partial ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                부분집계
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 손댈 것이 있을 때만 뜬다. 0건에도 카드를 남기면 "할 일 없음"을 매번 확인시키는 줄이 되고,
          진짜 확인할 것이 생겼을 때 그 줄이 눈에 띄지 않는다. */}
      {reviewItems.length > 0 ? (
        <Link
          href="/transactions?tab=review"
          data-surface="review-nudge"
          className="mt-6 flex items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3.5"
        >
          <span className="min-w-0">
            <span className="block font-semibold text-amber-900">확인 필요 {reviewItems.length}건</span>
            <span className="mt-0.5 block text-sm text-amber-800">가격·분류를 확정하면 계산에 들어갑니다.</span>
          </span>
          <span aria-hidden="true" className="shrink-0 font-semibold text-amber-800">›</span>
        </Link>
      ) : null}

      {/* 목록은 거래 탭이 맡는다. 여기 세 줄은 원장을 옮겨 심은 것이 아니라 **문**이다 —
          방금 무슨 일이 있었는지만 보이고, 나머지는 링크가 데려간다. */}
      <section className="mt-6" data-surface="recent-transactions">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-zinc-900">최근 거래</h2>
          <Link href="/transactions" className="shrink-0 text-sm font-semibold text-primary-600">
            전체 {listItems.length}건 보기
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {events.isLoading ? <p className="text-sm text-zinc-500">거래를 불러오는 중입니다</p> : null}
          {events.isError ? (
            <p role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              거래를 불러오지 못했습니다.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void events.refetch()}>다시 시도</button>
            </p>
          ) : null}
          {!events.isLoading && !events.isError && recentItems.length === 0 ? (
            <p className="text-sm text-zinc-500">표시할 거래가 없습니다.</p>
          ) : null}
          {recentItems.map((item) => (
            <EventRow
              key={`${item.record.event.id}#${item.occurrence}`}
              record={item.record}
              onSelect={() => setSelectedKey({ eventId: item.record.event.id, occurrence: item.occurrence })}
              rows={item.isDuplicate || judgmentsPending ? [] : judgments.rowsOf(item.record.event.id)}
              currency={estimate?.currency ?? "KRW"}
              isExcluded={!judgmentsPending && judgments.excluded.has(item.record.event.id)}
              inPeriod={judgmentsPending ? null : judgments.inPeriod(item.record.event.block_timestamp)}
              isDuplicate={item.isDuplicate}
              hideBalances={hideBalances}
              swapInLeg={swapInLegOf(item)}
            />
          ))}
        </div>
      </section>

      {selectedKey && !selected && !events.isLoading && !annotated.some((item) => item.record.event.id === selectedKey.eventId) ? (
        <BottomSheet open onClose={() => setSelectedKey(null)} title="거래 상세">
          <h2 className="text-lg font-bold text-zinc-900">거래 상세</h2>
          <p className="mt-3 text-sm text-zinc-600">이 거래가 목록에서 사라졌습니다. 목록이 갱신됐을 수 있습니다.</p>
          <button type="button" className="mt-4 w-full rounded-xl bg-primary-500 py-3 font-semibold text-white" onClick={() => setSelectedKey(null)}>닫기</button>
        </BottomSheet>
      ) : null}
      {selectedKey && !selected && !events.isLoading && annotated.some((item) => item.record.event.id === selectedKey.eventId) ? (
        <BottomSheet open onClose={() => setSelectedKey(null)} title="거래 상세">
          <h2 className="text-lg font-bold text-zinc-900">거래 상세</h2>
          <p className="mt-3 text-sm text-zinc-600">목록이 갱신되어 이 거래의 중복 순서를 다시 확인해야 합니다. 목록에서 다시 선택해 주세요.</p>
          <button type="button" className="mt-4 w-full rounded-xl bg-primary-500 py-3 font-semibold text-white" onClick={() => setSelectedKey(null)}>닫기</button>
        </BottomSheet>
      ) : null}
      {selected ? (
        <EventDetails
          // key에 version을 넣으면 충돌·재분류로 version이 오르는 순간 시트가 리마운트되어
          // "다른 곳에서 변경됨, 다시 확인" 경고와 재동기화 상태가 날아간다.
          key={`${selected.record.event.id}#${selected.occurrence}`}
          record={selected.record}
          onClose={() => setSelectedKey(null)}
          judgmentRows={selected.isDuplicate || judgmentsPending ? [] : judgments.rowsOf(selected.record.event.id)}
          isExcluded={!judgmentsPending && judgments.excluded.has(selected.record.event.id)}
          isDuplicate={selected.isDuplicate}
          inPeriod={judgmentsPending ? null : judgments.inPeriod(selected.record.event.block_timestamp)}
          judgmentError={judgments.isError}
          period={estimate?.period}
          estimate={estimate}
          countryCode={countryCode ?? "KR"}
          taxYear={taxYear}
          taxYearGrounded={referencePeriod !== null && !eventsStale}
          swapInLeg={swapInLegOf(selected)}
        />
      ) : null}
    </main>
  );
}
