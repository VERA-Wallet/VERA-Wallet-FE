"use client";

import { ChevronDown, Search } from "lucide-react";
import { Fragment, useState } from "react";
import { EventDetails } from "@/components/transactions/event-details";
import { EventRow } from "@/components/transactions/event-row";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ChainIcon } from "@/components/ui/chain-icon";
import { GROUP_SHORT_LABEL } from "@/components/ui/judgment-badge";
import { chainLabel, formatDate, shortHash, UTC_NOTICE } from "@/lib/format";
import { isoDay } from "@/lib/period";
import { useHideBalances } from "@/lib/privacy/use-hide-balances";
import { useTransactionList } from "@/lib/transactions/use-transaction-list";
import type { TransactionTab } from "@/lib/transactions/types";

/** 칩 하나가 여는 필터. 넷 다 같은 모양(칩 → 바텀시트)이라 분기 대신 이 키로만 갈린다. */
type FilterKey = "wallet" | "year" | "chain" | "group";

const FILTER_LABEL: Record<FilterKey, string> = {
  wallet: "지갑",
  year: "연도",
  chain: "체인",
  group: "판정",
};

/**
 * 거래 목록 화면.
 *
 * 요약에서 떼어 낸 이유는 자리 때문이다 — 한 화면에 요약과 목록이 함께 있을 때 첫 거래 행은
 * 약 1,200px 아래에서 시작했고, 필터 네 줄은 고정되지 않아 스크롤과 함께 사라졌다.
 * 여기서는 제목·검색·필터·탭이 위에 붙어 있고 **목록만** 흐른다.
 *
 * 금액 가리기 토글은 요약에 하나만 둔다. 저장소에 남는 전역 설정이라 이 화면은 읽기만 해도
 * 같은 상태를 따른다 — 같은 스위치를 두 화면에 두면 어느 쪽이 켠 것인지 알 수 없게 된다.
 */
export function TransactionsView({
  countryCode,
  initialTab = "all",
  initialSpam = false,
}: {
  countryCode?: string;
  /** 서버가 `?tab=review`를 읽어 내려준 첫 탭. 이후 전환은 이 화면이 쥔다. */
  initialTab?: TransactionTab;
  /** 서버가 `?spam=1`을 읽어 내려준 첫 화면. 설정의 "스팸 거래 보기"가 약속한 곳에 바로 도착하게 한다. */
  initialSpam?: boolean;
}) {
  const [hideBalances] = useHideBalances();
  // 어떤 필터 시트가 떠 있는가. null이면 닫혀 있다.
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  // 스팸 보기. 원장을 스팸 목록으로 **갈아 끼우는** 전환이라 필터·탭과 겹쳐 걸리지 않는다.
  const [spamRequested, setShowSpam] = useState(initialSpam);
  const {
    events,
    eventsFresh,
    eventsStale,
    referencePeriod,
    taxYear,
    judgments,
    judgmentsPending,
    estimate,
    annotated,
    spamItems,
    listItems,
    reviewItems,
    displayedItems,
    undatedInTab,
    swapInLegOf,
    newEventCountByDay,
    firstNewEventId,
    tab,
    setTab,
    group,
    setGroup,
    activeGroup,
    groups,
    groupTotal,
    chain,
    setChain,
    activeChain,
    chainFilters,
    chainTotal,
    setWallet,
    activeWallet,
    walletFilters,
    walletTotal,
    year,
    setYear,
    activeYear,
    yearFilters,
    yearTotal,
    search,
    setSearch,
    setMaxPages,
    selectedKey,
    setSelectedKey,
    selected,
  } = useTransactionList({ countryCode, initialTab });

  const tabClass = (active: boolean) =>
    `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-semibold transition-colors ${
      active ? "border-primary-500 text-primary-600" : "border-transparent text-zinc-400"
    }`;

  // 선택지가 하나뿐인 필터는 칩을 그리지 않는다 — 눌러도 고를 것이 없는 칩은 자리만 차지한다.
  // 판정만 규칙이 다른 이유: 판정은 조회가 끝나야 무엇이 있는지 알 수 있어, 불러오는 중에는 아예 없다.
  const chips: { key: FilterKey; value: string | null }[] = [];
  if (walletFilters.length > 0) chips.push({ key: "wallet", value: activeWallet === null ? null : shortHash(activeWallet) });
  if (yearFilters.length > 0) chips.push({ key: "year", value: activeYear === null ? null : `${activeYear}년` });
  if (chainFilters.length > 0) chips.push({ key: "chain", value: activeChain === null ? null : chainLabel(activeChain) });
  if (!judgments.isLoading && groups.length > 0) chips.push({ key: "group", value: activeGroup === null ? null : GROUP_SHORT_LABEL[activeGroup] });

  const optionClass = (isSelected: boolean) =>
    `flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${
      isSelected ? "bg-primary-50 text-primary-700" : "text-zinc-800 active:bg-zinc-50"
    }`;

  /** 시트 안의 한 줄. 건수는 **지금 고르면 남을 행 수**라 칩 건수와 같은 규칙으로 센다. */
  const option = (key: string, label: React.ReactNode, count: number | null, isSelected: boolean, choose: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={isSelected}
      className={optionClass(isSelected)}
      onClick={() => {
        choose();
        setOpenFilter(null);
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">{label}</span>
      {count === null ? null : <span className="shrink-0 font-medium text-zinc-500">{count}건</span>}
    </button>
  );

  const spamCount = spamItems.length;
  // 스팸이 없으면 스팸 보기도 없다. `?spam=1`로 들어왔는데 스팸이 0건이면 빈 목록에 갇힌다 —
  // 돌아갈 버튼이 스팸 고지 안에 있고, 그 고지는 스팸이 있을 때만 뜨기 때문이다.
  const showSpam = spamRequested && spamCount > 0;
  // 스팸 보기로 들어가면 목록 자체가 바뀐다. 필터·탭은 원장에만 걸리므로 여기서는 쓰지 않는다.
  const rows = showSpam ? spamItems : displayedItems;

  return (
    <main className="min-h-dvh pb-8">
      {/* 제목·검색·필터·탭은 붙어 있고 목록만 흐른다. 필터가 스크롤과 함께 사라지면
          사용자는 지금 무엇으로 좁혀 놓았는지 모른 채 빈 목록을 보게 된다. */}
      <div data-surface="transactions-header" className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 px-5 pt-8 backdrop-blur">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">거래</h1>
          <p className="shrink-0 text-sm font-medium text-zinc-500">{listItems.length}건</p>
        </div>
        <div className="relative mt-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            aria-label="거래 검색"
            placeholder="자산·주소·거래 해시"
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {chips.length > 0 ? (
          <div data-surface="transaction-filters" className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="필터">
            {chips.map(({ key, value }) => (
              <button
                key={key}
                type="button"
                data-filter={key}
                aria-haspopup="dialog"
                aria-expanded={openFilter === key}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold ${
                  value === null ? "bg-zinc-100 text-zinc-600" : "bg-primary-500 text-white"
                }`}
                onClick={() => setOpenFilter(key)}
              >
                {FILTER_LABEL[key]}
                {value === null ? null : <span className="max-w-24 truncate"> · {value}</span>}
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex gap-1" role="tablist" aria-label="거래 필터">
          <button role="tab" aria-selected={tab === "all"} type="button" className={tabClass(tab === "all")} onClick={() => setTab("all")}>
            전체 거래
            <span aria-hidden="true" className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-500">{listItems.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "review"} type="button" className={tabClass(tab === "review")} onClick={() => setTab("review")}>
            확인 필요
            <span aria-hidden="true" className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${reviewItems.length > 0 ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{reviewItems.length}</span>
          </button>
        </div>
      </div>

      <section className="px-5">
        {tab === "review" && !showSpam ? (
          <div className="mt-3 text-sm text-zinc-500">
            <p>계산에서 빠졌거나 확인이 필요한 거래만 모았습니다.</p>
            {/* 정직성 문장은 삭제가 아니라 강등이다 — 왜 가격·신뢰도가 다르게 취급되는지는 접어서 보존한다. */}
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-zinc-600 marker:text-zinc-400">어떤 기준인가</summary>
              <p className="mt-1">가격·분류·수량을 확정하지 못한 건은 계산에서 빠집니다. 신뢰도만 낮은 건은 계산 대상 분류라면 그대로 들어갑니다(자기 지갑 간 이체는 애초에 처분이 아닙니다).</p>
            </details>
          </div>
        ) : null}
        {/* 연도를 걸면 날짜를 모르는 건이 조용히 빠진다. 실제로 그런 건이 있을 때만 말한다 —
            없는 문제를 경고하면 화면이 늘 무언가 잘못된 것처럼 읽힌다. */}
        {!showSpam && activeYear !== null && undatedInTab > 0 ? (
          <p className="mt-3 text-xs text-zinc-400">날짜를 모르는 {undatedInTab}건은 연도로 좁히면 빠집니다.</p>
        ) : null}
        {/* 두 배지 체계의 구분은 앱 안에서 한 곳이 말해야 한다 — 여기가 그 한 곳이다. */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-400">배지 뜻</summary>
          <div className="mt-2 space-y-1 text-sm text-zinc-600">
            <p>분류 — 온체인에서 일어난 일(수신·송금·교환·내부 이동·미분류). 상세에서 직접 바꿀 수 있습니다.</p>
            <p>판정 — 이 거래가 세금 계산에서 어떻게 쓰였는지(과세·취득·비과세·이연 등). 거주국 룰셋이 정하며 나라마다 다릅니다.</p>
            <p>앰버 배지 — 확인이 필요한 문제. 정상 상태는 배지를 달지 않습니다.</p>
          </div>
        </details>
        {/* 원장에서 빠진 것들을 반드시 말한다. 조용히 빼면 목록이 완전한 것처럼 보이면서 거래가 사라진다.
            스팸은 숨긴 것이고, 형식 오류는 서버 응답이 계약을 벗어나 읽지 못한 것이다 —
            원인이 다르므로 한 문장으로 뭉개지 않는다. 스팸은 무엇이 걸렸는지 **볼 수 있어야** 한다:
            건수만 말하면 자기 거래가 잘못 걸렸는지 확인할 길이 없다. 되돌리기는 아직 두지 않는다 —
            SPAM에서 다른 분류로 바꾸는 경로를 서버가 받는지 확인하지 못했고, 눌러도 안 되는 버튼은 거짓말이다. */}
        {spamCount > 0 || (events.data?.dropped ?? 0) > 0 ? (
          <p data-surface="ledger-omissions" className="mt-3 text-xs text-zinc-500">
            {spamCount > 0 ? (
              <>
                스팸으로 분류된 {spamCount}건은 목록·계산에서 빼고 있습니다.{" "}
                <button type="button" className="font-semibold underline" onClick={() => setShowSpam(!showSpam)}>
                  {showSpam ? "원장으로 돌아가기" : "보기"}
                </button>
              </>
            ) : null}
            {(events.data?.dropped ?? 0) > 0
              ? `${spamCount > 0 ? " " : ""}형식이 맞지 않아 읽지 못한 ${events.data!.dropped}건이 있습니다.`
              : null}
          </p>
        ) : null}
        {showSpam ? (
          <p className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            스팸으로 분류된 거래입니다. 보기 전용이라 계산에도, 확인 필요에도 들어가지 않습니다.
          </p>
        ) : null}
        {/* 잘림·갱신 배너는 둘 다 앰버·회색으로 목록 위를 겹겹이 덮었다. 실패 문구와 "더 불러오기"는
            내용이지 부피가 아니므로 지우지 않고, 저채도 한 줄 노트로 부피만 강등한다. */}
        {events.data?.truncated || (eventsStale && events.data) ? (
          <p role="status" className="mt-3 border-l-2 border-zinc-200 pl-2 text-xs text-zinc-400">
            {eventsStale && events.data
              ? (eventsFresh.state === "error"
                  ? "갱신하지 못했습니다 — 마지막으로 받은 상태 표시"
                  : "갱신 중 — 마지막으로 받은 상태 표시")
              : null}
            {eventsStale && events.data && events.data?.truncated ? " · " : null}
            {events.data?.truncated ? (
              <>
                일부만 불러옴{" "}
                <button type="button" className="underline" onClick={() => setMaxPages((pages) => pages + 50)}>더 불러오기</button>
              </>
            ) : null}
          </p>
        ) : null}
        {/* 판정 상태는 목록 옆에서 말한다. 우선순위는 모든 표면에서 같다: disabled → error.
            기준 기간이 없으면 애초에 요청하지 않았으므로 옛 오류를 현재 상태로 말하면 안 된다. */}
        {referencePeriod === null ? (
          <p role="status" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.
          </p>
        ) : judgments.isError ? (
          <p role="status" className="mt-3 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            세금 판정을 불러오지 못해 각 거래의 도장을 확정하지 못했습니다. 아래 목록의 확인 필요 항목은 거래 자체의 문제만 반영합니다.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void judgments.refetch()}>다시 시도</button>
          </p>
        ) : null}
        {/* `grid-cols-1`은 장식이 아니다. 열을 지정하지 않으면 암묵 열이 `auto`라 **가장 넓은 행의 min-content**로
            늘어나고, 긴 손익 한 줄이 목록 전체를 껍데기(448px) 밖으로 민다(실측 510px). `minmax(0,1fr)`로 못 박는다. */}
        <div className="mt-3 grid grid-cols-1 gap-3">
          {events.isLoading ? <p className="text-sm text-zinc-500">거래를 불러오는 중입니다</p> : null}
          {events.isError ? (
            <p role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              거래를 불러오지 못했습니다.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void events.refetch()}>다시 시도</button>
            </p>
          ) : null}
          {/* 빈 목록의 이유는 하나가 아니다. 검색어 때문인지, 탭 때문인지, 애초에 거래가 없는지를
              가르지 않으면 사용자는 자기가 무엇을 되돌려야 하는지 알 수 없다. */}
          {!events.isLoading && !events.isError && rows.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {search.trim() !== ""
                ? `'${search.trim()}'로 찾은 거래가 없습니다.`
                : tab === "review"
                  ? "확인이 필요한 거래가 없습니다."
                  : "표시할 거래가 없습니다."}
            </p>
          ) : null}
          {rows.map((item, index) => {
            const { record, occurrence, isDuplicate } = item;
            // 날짜는 UTC 하루 단위로 한 번만 찍는다. 모든 줄에 같은 날짜를 반복하면
            // 정작 읽어야 할 "그날 무슨 일이 있었나"가 안 보인다.
            const day = isoDay(record.event.block_timestamp);
            const previousDay = index > 0 ? isoDay(rows[index - 1].record.event.block_timestamp) : null;
            return (
              <Fragment key={`${record.event.id}#${occurrence}`}>
                {day === previousDay ? null : (
                  <h3 className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-500 first:mt-0">
                    <span>{day ? formatDate(record.event.block_timestamp) : "날짜 미상"}</span>
                    {/* 방금 들어온 거래가 어느 날짜에 꽂혔는지 말한다. 없으면 배지도 없다 — 없는 사실을 만들지 않는다. */}
                    {!showSpam && (newEventCountByDay.get(day ?? "") ?? 0) > 0 ? (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold text-primary-600">
                        새로 들어온 거래 {newEventCountByDay.get(day ?? "")}
                      </span>
                    ) : null}
                  </h3>
                )}
                <EventRow
                  isFirstNew={!showSpam && record.event.id === firstNewEventId}
                  record={record}
                  // 스팸은 보기 전용이다 — 여는 상세에는 재분류가 있고, 그 경로를 서버가 받는지 아직 모른다.
                  onSelect={showSpam ? undefined : () => setSelectedKey({ eventId: record.event.id, occurrence })}
                  rows={showSpam || isDuplicate || judgmentsPending ? [] : judgments.rowsOf(record.event.id)}
                  currency={estimate?.currency ?? "KRW"}
                  isExcluded={!showSpam && !judgmentsPending && judgments.excluded.has(record.event.id)}
                  inPeriod={showSpam || judgmentsPending ? null : judgments.inPeriod(record.event.block_timestamp)}
                  isDuplicate={isDuplicate}
                  hideBalances={hideBalances}
                  swapInLeg={showSpam ? null : swapInLegOf(item)}
                />
              </Fragment>
            );
          })}
        </div>
        {/* 시간대는 화면 전체가 한 번만 약속한다. 줄마다 "UTC"를 붙이면 읽히지 않고,
            아예 안 밝히면 사용자가 자기 시간대로 읽어 과세연도 경계에서 다른 날로 이해한다. */}
        <p className="mt-3 text-xs text-zinc-400">{UTC_NOTICE}</p>
      </section>

      {openFilter !== null ? (
        <BottomSheet open onClose={() => setOpenFilter(null)} title={`${FILTER_LABEL[openFilter]} 고르기`}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-zinc-900">{FILTER_LABEL[openFilter]}</h2>
            <button type="button" className="-mr-2 px-2 py-1 text-sm font-medium text-zinc-500" onClick={() => setOpenFilter(null)}>닫기</button>
          </div>
          {openFilter === "wallet" ? (
            <div className="mt-2 grid" aria-label="지갑 필터">
              {option("all", "전체 지갑", walletTotal, activeWallet === null, () => setWallet(null))}
              {walletFilters.map(([address, count]) =>
                option(address, shortHash(address), count, activeWallet === address, () => setWallet(address)),
              )}
            </div>
          ) : null}
          {openFilter === "year" ? (
            <div className="mt-2 grid" aria-label="연도 필터">
              {option("all", "전체 연도", yearTotal, activeYear === null, () => setYear(null))}
              {yearFilters.map(([value, count]) =>
                // 누른 줄을 다시 누르면 풀린다. 필터가 겹쳐 걸리는 이상 되돌릴 문이 그 자리에 있어야 한다.
                option(String(value), `${value}년`, count, activeYear === value, () => setYear(year === value ? null : value)),
              )}
            </div>
          ) : null}
          {openFilter === "chain" ? (
            <div className="mt-2 grid" aria-label="체인 필터">
              {option("all", "전체 체인", chainTotal, activeChain === null, () => setChain(null))}
              {chainFilters.map(([chainId, count]) =>
                option(
                  String(chainId),
                  <>
                    <ChainIcon chainId={chainId} />
                    {chainLabel(chainId)}
                  </>,
                  count,
                  activeChain === chainId,
                  () => setChain(chain === chainId ? null : chainId),
                ),
              )}
            </div>
          ) : null}
          {openFilter === "group" ? (
            <div className="mt-2 grid" aria-label="판정 필터">
              {option("all", "전체", groupTotal, activeGroup === null, () => setGroup(null))}
              {groups.map(([item, count]) =>
                option(item, GROUP_SHORT_LABEL[item], count, activeGroup === item, () => setGroup(group === item ? null : item)),
              )}
            </div>
          ) : null}
        </BottomSheet>
      ) : null}

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
