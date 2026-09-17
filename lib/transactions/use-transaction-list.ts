"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useImportTracker } from "@/components/wallet/import-tracker-provider";
import { isGroundedPeriod, isoDay } from "@/lib/period";
import { DEFAULT_PERIOD, dataBounds, isDefaultPeriod, resolvePeriod } from "@/lib/portfolio/period-selection";
import type { PeriodSelection } from "@/lib/portfolio/period-selection";
import { fresh } from "@/lib/queries/fresh";
import { eventSummaryQueryKey, useEventList, useEventSummary } from "@/lib/queries/events";
import { useJudgments } from "@/lib/queries/judgments";
import { effectiveClassification, needsReview } from "@/lib/review";
import { pairBridgeLegs, pairSwapLegs } from "@/lib/swap-pair";
import { taxYearFor } from "@/lib/tax/engine";
import { estimateConfidence, estimateHeadline } from "@/lib/tax/estimate-summary";
import { useTaxYear } from "@/lib/tax/tax-year-context";
import type { AnnotatedRecord, TransactionTab } from "@/lib/transactions/types";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentGroup } from "@/lib/tax/types";

/**
 * 거래 목록이 서는 바닥 — 조회·중복 표시·페어링·확인 필요 큐·필터·칩 건수를 한 곳에서 낸다.
 *
 * 요약 화면과 거래 화면이 **같은 사실**을 말해야 하므로 이 계산은 둘 중 어느 화면에도 살지 않는다.
 * 각자 세면 요약은 "확인 필요 3건"이라 적어 놓고 거래 탭에는 5줄이 뜨는 일이 생긴다.
 *
 * 기간(periodSelection)은 요약 화면만 좁힌다 — 거래 화면은 전부를 보이고 연도 필터로 좁히므로
 * 기본값(DEFAULT_PERIOD)으로 두면 아무것도 걸리지 않는다.
 */
export function useTransactionList({
  countryCode,
  periodSelection = DEFAULT_PERIOD,
  initialTab = "all",
}: { countryCode?: string; periodSelection?: PeriodSelection; initialTab?: TransactionTab } = {}) {
  const queryClient = useQueryClient();
  // 불러오기 상태를 구독한다. 프로바이더가 없으면 "진행 중인 불러오기 없음"으로 읽히므로
  // 이 화면만 따로 렌더해도 그대로 돈다 — 원장은 불러오기와 독립적으로 존재하는 화면이다.
  // 마커를 언제 걷을지는 이 훅이 정하지 않는다. 원장을 **떠나는 순간**이 그 경계이고,
  // 그 사실은 컴포넌트 수명이 아니라 경로 변화에만 있어 트래커가 쥔다 —
  // effect 정리에 두면 StrictMode의 마운트 → 정리 → 마운트가 도착하자마자 마커를 지운다.
  const importTracker = useImportTracker();
  // 첫 탭은 서버가 정한다(`/transactions?tab=review`). 클라이언트가 URL을 읽으면 Suspense 경계가
  // 따라오므로, 대시보드의 `importing` 처리와 같은 이유로 prop으로 받아 초기값만 쓴다.
  const [tab, setTab] = useState<TransactionTab>(initialTab);
  const [group, setGroup] = useState<JudgmentGroup | "excluded" | null>(null);
  // 체인 필터. null = 전체. 목록에 없는 체인이 걸리면 아래에서 무시한다.
  const [chain, setChain] = useState<number | null>(null);
  // 지갑 필터. null = 전체. 지갑을 여럿 등록하면 한 목록에 섞여 "이 지갑에서 무슨 일이 있었나"를
  // 볼 방법이 없다. 체인·연도와 같은 성격의 **표시 필터**라 판정·요약 금액은 이 선택에 흔들리지 않는다.
  const [wallet, setWallet] = useState<string | null>(null);
  // 연도 필터. null = 전체. 체인 필터와 같은 성격의 **표시 필터**라 판정·요약은 건드리지 않는다
  // (연도가 계산 경계인 곳은 세금 탭이고, 여기서 고른 해는 목록만 좁힌다).
  const [year, setYear] = useState<number | null>(null);
  // 검색어. 자산 심볼·상대 주소·tx 해시를 부분 일치로 좁힌다. 목록은 이미 전량 받아 뒀으므로
  // 서버에 다시 묻지 않는다 — 한 글자마다 왕복하면 타이핑이 목록보다 느려진다.
  const [search, setSearch] = useState("");
  // 선택은 **식별자만** 들고 있는다. 클릭 시점 스냅샷을 들고 있으면
  // 목록을 다시 불러온 뒤 시트가 사라진 거래나 옛 버전을 계속 보여준다.
  const [selectedKey, setSelectedKey] = useState<{ eventId: string; occurrence: number } | null>(null);
  // 잘렸으면 사용자가 계속 볼 수 있어야 한다. 경고만 띄우고 막으면 "전체 거래"가 거짓이다.
  const [maxPages, setMaxPages] = useState(50);
  const events = useEventList(maxPages);
  const summary = useEventSummary();
  const summaryFresh = fresh(summary);
  const period = summaryFresh.data?.period;
  // 요약 기간이 신뢰할 수 없으면 과세연도를 정할 수 없다.
  // 현재 날짜는 쿼리 키를 만들기 위한 **자리표시자**일 뿐이다. `referencePeriod === null`이면
  // 판정 조회 자체가 비활성이고(useJudgments의 enabled), 화면·상세 어디에도 이 값으로 만든 결과가 흘러가지 않는다.
  // 근거 판정은 표시 판정과 **같은 규칙**을 써야 한다.
  // 갈리면 헤더는 "기간 미정"인데 판정 기준은 "2025년 세금"을 말하게 된다.
  // 기준 시각은 기간의 **끝**(마지막 거래)이다 — 세금 화면(app/tax/page.tsx)과 같은 규칙. 시작일로 잡으면
  // 여러 해에 걸친 지갑(2021년부터 이력이 있는 지갑을 추가한 순간)에서 가장 오래된 해를 계산해
  // 가격도 없는 첫 해를 두고 "계산할 거래 없음"을 말한다.
  const referencePeriod = isGroundedPeriod(summaryFresh.data?.period)
    ? summaryFresh.data!.period.to
    : null;
  // 기본 귀속연도는 마지막 활동연도(요약 기간)에서 파생한다. 하지만 사용자가 세금 화면 셀렉터로
  // 다른 연도를 고르면 그 선택이 전역 소스에 있고, 이 화면도 같은 연도를 봐야 desync가 없다.
  // 선택이 없으면(초기) 파생값을 그대로 쓴다 — 초기값 규칙은 한 곳(마지막 활동연도)이다.
  const derivedTaxYear = taxYearFor(countryCode ?? "KR", referencePeriod ?? new Date().toISOString());
  const [taxYear] = useTaxYear(derivedTaxYear);
  const judgments = useJudgments(countryCode ?? "KR", taxYear, referencePeriod !== null);
  const items = events.data?.items ?? [];
  // 프리셋("최근 1개월")은 벽시계가 아니라 **받아온 거래의 끝**을 기준으로 센다 —
  // 벽시계로 세면 오래된 지갑·데모에서 모든 버튼이 빈 기간을 가리킨다.
  const periodWindow = resolvePeriod(periodSelection, dataBounds(items.map((item) => item.event.block_timestamp)));
  // 고르지 않았거나 기준이 없으면 좁힐 근거가 없다. 그때 화면은 예전처럼 전부를 보인다.
  const periodNarrowed = !isDefaultPeriod(periodSelection) && periodWindow !== null;
  // 레퍼런스 관례대로 최신이 위. 원본 배열은 건드리지 않는다 — 누적 그래프는 시간순으로 받아야 한다.
  // 페이지를 끝까지 이어 받은 뒤 정렬하므로 "최신"이 페이지 경계에 좌우되지는 않지만,
  // 목록이 잘렸을 때 이 순서가 전부는 아니라는 사실은 잘림 고지가 말한다.
  const orderedItems = [...items].sort(
    (left, right) => Date.parse(right.event.block_timestamp) - Date.parse(left.event.block_timestamp),
  );
  // 같은 id가 두 번 이상 나오면 두 번째부터는 판정을 붙일 수 없다 — 확인 필요로 올린다.
  // 중복 판정은 **표시 순서**로 한 번만 계산하고 마커를 레코드에 붙인다.
  // 객체 동일성(Set<EventRecord>)으로 들고 있으면 목록을 다시 불러온 순간 마커가 사라져
  // 두 번째 중복이 첫 건의 판정을 물려받는다.
  const seenCounts = new Map<string, number>();
  const annotated: AnnotatedRecord[] = orderedItems.map((record) => {
    const occurrence = seenCounts.get(record.event.id) ?? 0;
    seenCounts.set(record.event.id, occurrence + 1);
    return { record, occurrence, isDuplicate: occurrence > 0 };
  });
  // 스팸으로 걸러 둔 항목. 원장에는 넣지 않지만(계산·확인 필요 큐가 스팸에 덮인다) 무엇이 걸렸는지는
  // 보여줄 수 있어야 한다 — 목록과 같은 최신순으로 세워 두고, 화면이 요청할 때만 그린다.
  const spamItems: AnnotatedRecord[] = [...(events.data?.spamItems ?? [])]
    .sort((left, right) => Date.parse(right.event.block_timestamp) - Date.parse(left.event.block_timestamp))
    .map((record) => ({ record, occurrence: 0, isDuplicate: false }));
  // 확인 필요는 **이벤트 자체**의 문제(가격·분류·수량·낮은 신뢰도·중복)만 센다.
  // 판정 조회 실패는 시스템 장애이므로 전 거래를 확인 필요로 만들지 않고 배너로 알린다.
  // 목록의 버전이 바뀌면 세무 판정도 다시 계산돼야 한다.
  // 외부 변경이 목록에만 반영되면 최신 분류 옆에 옛 도장이 남는다.
  // 수동 memo는 React Compiler 최적화를 막는다(lint error). 컴파일러 자동 메모이제이션에 맡긴다.
  const versionSignature = items.map((item) => `${item.event.id}:${item.version}`).join(",");
  const [judgedSignature, setJudgedSignature] = useState(versionSignature);
  if (events.data !== undefined && versionSignature !== judgedSignature) {
    // 판정만 갱신하면 요약 카드와 상세 이력이 옛 사실을 단정한다. 파생 뷰를 한 번에 갱신한다.
    // 단, 상세는 **버전이 실제로 바뀐 id만** 무효화한다(열지 않은 캐시까지 버리지 않는다).
    const previous = new Map(
      judgedSignature.split(",").filter(Boolean).map((entry) => {
        const at = entry.lastIndexOf(":");
        return [entry.slice(0, at), entry.slice(at + 1)] as const;
      }),
    );
    setJudgedSignature(versionSignature);
    void queryClient.invalidateQueries({ queryKey: ["tax", "estimate"] });
    void queryClient.invalidateQueries({ queryKey: eventSummaryQueryKey });
    for (const item of items) {
      if (previous.get(item.event.id) !== String(item.version)) {
        void queryClient.invalidateQueries({ queryKey: ["events", "detail", item.event.id] });
      }
    }
  }
  // 재조회 중이면 이전 판정을 최신인 척 보이지 않는다.
  const eventsFresh = fresh(events);
  // 목록이 재조회 중이면 이전 레코드에서 파생한 판정·분류 사실도 최신이 아니다.
  // 과세연도를 정할 수 없을 때도 마찬가지다.
  // 목록이 재조회 중이든 실패했든, 지금 보이는 행은 "마지막으로 받은 상태"다.
  // 실패를 빼두면 옛 레코드가 다시 현재 사실처럼 단정된다.
  const eventsStale = eventsFresh.state !== "ready";
  const judgmentsPending =
    judgments.isFetching ||
    eventsStale ||
    referencePeriod === null ||
    versionSignature !== judgedSignature;

  // 스왑 두 다리(같은 tx_hash의 처분 OUT + 취득 IN)는 **한 행**으로 묶는다 — OUT 행이 대표가 되고
  // IN 다리는 받은 자산·수량을 공급하며 별도 행으로 렌더하지 않는다. 중복 레코드는 페어링에서 뺀다
  // (중복은 그 자체가 확인 필요 신호라 숨기면 안 된다). 계산은 그대로 두 건이다(엔진 무변경).
  const swapPairing = pairSwapLegs(annotated.filter((item) => !item.isDuplicate).map((item) => item.record.event));
  // 브릿지 두 다리(출발 OUT + 도착 IN, bridge_group_id로 연결)도 같은 이유로 한 행으로 묶는다 —
  // 도착 leg를 별도 행으로 두면 크로스체인 이동 1건이 거래 2건("브릿지" + "이동")처럼 보인다.
  // 같은 자산 이동은 대표(OUT) 행이 이미 bridge_dest_chain_id로 도착 체인을 그리므로 도착 leg는
  // 숨기기만 한다. 자산이 바뀌는 브릿지(출발 EXCHANGE)는 스왑과 같은 모양이라 아래 swapInLeg
  // 스타일 렌더(받은 자산·수량)를 그대로 재사용한다.
  const bridgePairing = pairBridgeLegs(annotated.filter((item) => !item.isDuplicate).map((item) => item.record.event));
  // 페어링된 도착 leg 중 "자산이 바뀌는 브릿지"만 골라낸다 — 같은 자산 이동은 이미 도착 체인을
  // 텍스트로 보여주고 있어 swapInLeg 스타일(받은 자산 로고·수량)을 더하면 정보가 겹친다.
  const bridgeSwapInLegFor = (out: NormalizedEvent): NormalizedEvent | null => {
    if (effectiveClassification(out) !== "EXCHANGE") return null;
    return bridgePairing.inLegByOutId.get(out.id) ?? null;
  };
  /** 이 행이 대표로 말하는 "받은 자산" 다리. 중복 레코드는 자기 판정이 없으므로 페어도 붙이지 않는다. */
  const swapInLegOf = (item: AnnotatedRecord): NormalizedEvent | null =>
    item.isDuplicate
      ? null
      : swapPairing.inLegByOutId.get(item.record.event.id) ?? bridgeSwapInLegFor(item.record.event);
  // 기간(periodSelection)은 요약의 **그래프**만 좁힌다. 목록까지 함께 좁히던 때에는 요약이 세는
  // "확인 필요 n건"과 거래 탭이 보여 주는 줄 수가 갈렸다 — 두 화면이 한 원장을 두고 다른 수를 말한 것이다.
  // 이제 목록을 좁히는 문은 거래 탭의 연도 필터 하나뿐이다.
  const listItems = annotated.filter(
    (item) =>
      item.isDuplicate ||
      (!swapPairing.pairedInIds.has(item.record.event.id) && !bridgePairing.pairedInIds.has(item.record.event.id)),
  );
  // 스왑은 대표(OUT) 한 줄로 합쳐 그리고 IN 다리는 목록에서 빠지므로, IN만 확인이 필요하면
  // (예: 받은 자산 가격 미확정) 대표 행을 리뷰 탭에 올려야 사용자가 열어 취득원가를 고칠 수 있다.
  // IN 다리를 함께 검사하지 않으면 그 확인 필요가 목록에서도 큐에서도 사라진다.
  const reviewItems = listItems.filter((item) => {
    const inLeg = swapPairing.inLegByOutId.get(item.record.event.id);
    const bridgeInLeg = bridgePairing.inLegByOutId.get(item.record.event.id);
    return (
      needsReview(item.record.event) ||
      (inLeg != null && needsReview(inLeg)) ||
      (bridgeInLeg != null && needsReview(bridgeInLeg)) ||
      item.isDuplicate
    );
  });
  const tabItems = tab === "review" ? reviewItems : listItems;
  // 판정을 못 불러오면 그룹 필터를 유지할 근거가 없다. 조용히 빈 목록을 보이면 사용자가 원인을 모른다.
  // 탭을 바꿨는데 그 그룹이 이 탭에 없으면 필터를 유지할 근거가 없다.
  // 유지하면 "확인이 필요한 거래가 없습니다"만 보이고 왜 비었는지 알 수 없다.
  // 그룹 소속 판정은 한 곳에서만 한다. 존재 확인·필터·칩 건수가 갈리면 칩과 카드가 다른 말을 한다.
  const groupsOf = (item: AnnotatedRecord): Set<JudgmentGroup | "excluded"> => {
    if (item.isDuplicate) return new Set(["excluded"]);
    const groups = new Set<JudgmentGroup | "excluded">(
      judgments.rowsOf(item.record.event.id).map((row) => row.group),
    );
    if (judgments.excluded.has(item.record.event.id)) groups.add("excluded");
    return groups;
  };
  const matchesChain = (item: AnnotatedRecord, chain: number | null) =>
    chain === null || item.record.event.chain_id === chain;
  // 주소 비교는 대소문자를 무시한다 — 체크섬 표기와 소문자 표기가 같은 지갑을 두 개로 갈라 놓으면
  // 드롭다운에 같은 주소가 두 번 뜨고 어느 쪽을 골라도 절반만 보인다.
  const walletOf = (item: AnnotatedRecord) => item.record.event.wallet_address.toLowerCase();
  const matchesWallet = (item: AnnotatedRecord, target: string | null) =>
    target === null || walletOf(item) === target;
  // 연도는 날짜 머리글과 같은 판정을 쓴다(`isoDay`) — 달력에 없는 날짜·깨진 오프셋은 연도도 없다.
  // 그런 건은 "날짜 미상"으로 남고 특정 연도 칩에는 잡히지 않는다.
  const yearOf = (item: AnnotatedRecord): number | null => {
    const day = isoDay(item.record.event.block_timestamp);
    return day === "" ? null : Number(day.slice(0, 4));
  };
  const matchesYear = (item: AnnotatedRecord, target: number | null) =>
    target === null || yearOf(item) === target;
  const matchesGroup = (item: AnnotatedRecord, target: JudgmentGroup | "excluded" | null) =>
    target === null || groupsOf(item).has(target);
  // 검색은 필터 칩과 성격이 다르다 — 선택지가 아니라 사용자가 친 글자라, 맞는 게 없어도 조용히
  // 풀지 않는다. 빈 목록이 곧 "그 글자로는 없다"는 답이고, 사용자는 자기 오타를 고칠 수 있어야 한다.
  const searchQuery = search.trim().toLowerCase();
  const matchesSearch = (item: AnnotatedRecord) => {
    if (searchQuery === "") return true;
    const { event } = item.record;
    // 스왑·브릿지는 대표 행이 두 다리를 말하므로 받은 자산의 심볼로도 찾혀야 한다 —
    // 그러지 않으면 "USDC로 바꾼 거래"를 USDC로 검색해도 나오지 않는다.
    const inLeg = swapInLegOf(item);
    const haystack = [
      event.asset_symbol,
      event.swap_to_symbol,
      inLeg?.asset_symbol ?? null,
      event.counterparty,
      event.counterparty_label ?? null,
      event.tx_hash,
    ];
    return haystack.some((value) => value != null && value.toLowerCase().includes(searchQuery));
  };
  const groupExistsInTab = group === null || tabItems.some((item) => groupsOf(item).has(group));
  const activeGroup = judgments.isError || judgmentsPending || !groupExistsInTab ? null : group;
  // 고른 체인이 이 탭에 없으면 필터를 유지할 근거가 없다.
  // 유지하면 빈 목록만 남고 사용자는 자기가 건 필터 때문인지 거래가 없는 건지 알 수 없다.
  const activeChain = chain !== null && tabItems.some((item) => matchesChain(item, chain)) ? chain : null;
  // 연도도 같은 규칙이다 — 고른 해가 이 탭에 없으면 놓는다.
  const activeYear = year !== null && tabItems.some((item) => matchesYear(item, year)) ? year : null;
  // 지갑도 같은 규칙이다. 확인 필요 탭에 그 지갑의 거래가 없으면 선택을 유지할 근거가 없다 —
  // 유지하면 빈 목록만 남고 사용자는 자기가 고른 지갑 때문인지 문제가 없는 건지 알 수 없다.
  const activeWallet = wallet !== null && tabItems.some((item) => matchesWallet(item, wallet)) ? wallet : null;
  const displayedItems = tabItems.filter(
    (item) =>
      matchesWallet(item, activeWallet) &&
      matchesChain(item, activeChain) &&
      matchesGroup(item, activeGroup) &&
      matchesYear(item, activeYear) &&
      matchesSearch(item),
  );
  // 이번 불러오기로 들어온 거래. 트래커가 시작 시점 원장과 끝난 뒤 원장을 비교해 낸 id들이며,
  // 날짜 묶음마다 몇 건인지 세어 머리글 옆에 붙인다 — 목록은 최신순이라 새 거래가 어느 날짜에
  // 꽂혔는지 말해 주지 않으면 사용자가 찾을 수 없다.
  // 배열째 매 행 훑지 않는 이유: 첫 지갑은 새 거래가 수백·수천 건이라 행마다 선형 탐색이면 렌더가 제곱으로 는다.
  const newEventIdSet = new Set(importTracker.state.newEventIds ?? []);
  const newEventCountByDay = new Map<string, number>();
  let firstNewEventId: string | null = null;
  for (const { record } of displayedItems) {
    if (!newEventIdSet.has(record.event.id)) continue;
    if (firstNewEventId === null) firstNewEventId = record.event.id;
    const day = isoDay(record.event.block_timestamp) ?? "";
    newEventCountByDay.set(day, (newEventCountByDay.get(day) ?? 0) + 1);
  }
  // 칩 건수는 **지금 눌렀을 때 남을 카드 수**다. 그래서 자기 자신을 뺀 나머지 필터를 적용한 뒤 센다.
  // 전체 목록 기준으로 세면 다른 필터가 걸린 상태에서 칩 건수와 카드 수가 어긋난다.
  const groupCounts = new Map<JudgmentGroup | "excluded", number>();
  // 판정을 다시 계산하는 중이면 칩도 보류한다.
  // 카드가 "판정 확인 중"인데 칩이 "취득 10"이라 하면 화면이 두 이야기를 한다.
  const groupScope = judgmentsPending || judgments.isError
    ? []
    : tabItems.filter((row) => matchesWallet(row, activeWallet) && matchesChain(row, activeChain) && matchesYear(row, activeYear) && matchesSearch(row));
  for (const item of groupScope) {
    for (const key of groupsOf(item)) groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groups = [...groupCounts.entries()];
  // "전체" 줄의 건수. 한 거래가 판정 여러 개에 걸릴 수 있어 칩 건수를 더하면 실제 행 수를 넘는다 —
  // 그래서 합이 아니라 **남을 행 수**를 그대로 센다(칩 건수 규칙과 같은 범위).
  const groupTotal = groupScope.length;
  // 체인·연도 칩은 판정과 무관하게 온체인 사실이라 판정 조회 상태와 관계없이 셀 수 있다.
  const chainCounts = new Map<number, number>();
  const chainScope = tabItems.filter((row) => matchesWallet(row, activeWallet) && matchesGroup(row, activeGroup) && matchesYear(row, activeYear) && matchesSearch(row));
  for (const item of chainScope) {
    const id = item.record.event.chain_id;
    chainCounts.set(id, (chainCounts.get(id) ?? 0) + 1);
  }
  const chainTotal = chainScope.length;
  // 체인이 하나뿐이면 고를 것이 없다 — 누를 수 없는 칩 한 줄은 자리만 차지한다.
  const chainFilters = chainCounts.size > 1 ? [...chainCounts.entries()].sort((left, right) => left[0] - right[0]) : [];
  const yearCounts = new Map<number, number>();
  const yearScope = tabItems.filter((row) => matchesWallet(row, activeWallet) && matchesChain(row, activeChain) && matchesGroup(row, activeGroup) && matchesSearch(row));
  for (const item of yearScope) {
    const value = yearOf(item);
    if (value !== null) yearCounts.set(value, (yearCounts.get(value) ?? 0) + 1);
  }
  // "전체 연도"에는 날짜를 모르는 건도 남는다 — 연도 칩 건수의 합보다 큰 이유가 그것이다.
  const yearTotal = yearScope.length;
  // 연도가 하나뿐이면 고를 것이 없다(체인 필터와 같은 규칙). 목록은 최신순이라 칩도 최신 연도가 먼저다.
  const yearFilters = yearCounts.size > 1 ? [...yearCounts.entries()].sort((left, right) => right[0] - left[0]) : [];
  // 연도를 걸면 날짜를 모르는 건이 조용히 빠진다. 기간 선택기가 요약으로 옮겨 가면서 그 사실을
  // 말할 자리가 연도 필터뿐이라, 실제로 그런 건이 있을 때만 건수를 남긴다.
  const undatedInTab = tabItems.filter((item) => yearOf(item) === null).length;
  // 지갑 건수는 다른 필터를 적용한 뒤 센다(칩과 같은 규칙) — 드롭다운이 말하는 건수와 실제 목록이 어긋나면
  // 사용자는 어느 쪽을 믿어야 할지 모른다. 거래가 있는 지갑만 나온다: 등록만 하고 거래가 없는 지갑은
  // 이벤트에 흔적이 없어 여기서 알 수 없다(세션 계약이 지갑 목록을 내려주면 그때 합칠 자리다).
  const walletCounts = new Map<string, number>();
  for (const item of tabItems.filter((row) => matchesChain(row, activeChain) && matchesGroup(row, activeGroup) && matchesYear(row, activeYear) && matchesSearch(row))) {
    const address = walletOf(item);
    walletCounts.set(address, (walletCounts.get(address) ?? 0) + 1);
  }
  // 지갑이 하나뿐이면 고를 것이 없다 — 선택지 하나짜리 드롭다운은 자리만 차지한다(체인 칩과 같은 규칙).
  const walletFilters = walletCounts.size > 1 ? [...walletCounts.entries()].sort((left, right) => right[1] - left[1]) : [];
  const walletTotal = [...walletCounts.values()].reduce((sum, count) => sum + count, 0);
  const estimate = judgments.estimate;
  // 헤드라인 손익·건수는 요약(이벤트 직접 집계)이 아니라 **세금 화면과 같은 estimate**에서 파생한다.
  // 그래야 같은 귀속연도에서 요약·세금·내보내기가 한 숫자를 말한다(P1-5).
  // 판정을 다시 계산하는 중이면 옛 estimate로 손익을 단정하지 않는다 — 카드가 두 이야기를 하지 않도록 보류한다.
  const headline = judgmentsPending || estimate === undefined ? undefined : estimateHeadline(estimate);
  const headlineCurrency = estimate?.currency ?? summaryFresh.data?.currency ?? "KRW";
  // 신뢰도 칩(P1-9)도 같은 estimate에서 파생한다 — 세금 화면 "흔들리는 지점"과 같은 소스를 압축해 보인다.
  const confidence = headline === undefined || estimate === undefined ? undefined : estimateConfidence(estimate);
  const selected = selectedKey
    ? annotated.find((item) => item.record.event.id === selectedKey.eventId && item.occurrence === selectedKey.occurrence) ?? null
    : null;

  return {
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
    spamItems,
    periodWindow,
    periodNarrowed,
    listItems,
    reviewItems,
    tabItems,
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
    wallet,
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
    maxPages,
    setMaxPages,
    selectedKey,
    setSelectedKey,
    selected,
  };
}
