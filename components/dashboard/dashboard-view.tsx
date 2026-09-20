"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useImportTracker } from "@/components/wallet/import-tracker-provider";
import { ExchangeLinkSummary } from "@/components/dashboard/exchange-link-summary";
import { FlowChart } from "@/components/dashboard/flow-chart";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import {
  DEFAULT_PERIOD,
  dataBounds,
  inPeriodWindow,
  isDefaultPeriod,
  periodWindowLabel,
  resolvePeriod,
} from "@/lib/portfolio/period-selection";
import type { PeriodSelection } from "@/lib/portfolio/period-selection";
import { ChainIcon } from "@/components/ui/chain-icon";
import { ChipScroller } from "@/components/ui/chip-scroller";
import { AssetLogo, SplitAssetLogo } from "@/components/ui/asset-logo";
import { CLASSIFICATION_LABEL, ClassificationBadge } from "@/components/ui/classification-badge";
import { INCOME_KIND_LABEL } from "@/components/ui/income-kind-badge";
import { halfOpenPeriodLabel, isGroundedPeriod, isoDay, periodLabel } from "@/lib/period";
import { fresh, freshNotice, type FreshState } from "@/lib/queries/fresh";
import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { Provenance } from "@/lib/http/envelope";
import { SummaryCard } from "@/components/ui/summary-card";
import { useHideBalances } from "@/lib/privacy/use-hide-balances";
import { assetLabel, assetTicker, chainLabel, explorerTxUrl, formatDate, formatDateTime, formatFiat, formatFiatExact, formatSignedTokenAmount, formatTokenAmount, nativeSymbol, shortHash, UTC_NOTICE } from "@/lib/format";
import { eventSummaryQueryKey, useEventDetail, useEventList, useEventSummary, useReclassify, useSetValueOverride } from "@/lib/queries/events";
import { useTaxEstimate } from "@/lib/queries/tax";
import { useJudgments } from "@/lib/queries/judgments";
import { assetFlow, effectiveClassification, needsReview, reviewReason } from "@/lib/review";
import type { AssetFlow } from "@/lib/review";
import { counterpartyLabel, knownContractName } from "@/lib/contracts";
import { pairBridgeLegs, pairSwapLegs } from "@/lib/swap-pair";
import { div, isNegative, isPositive, isZero, mul, round, sum } from "@/lib/tax/decimal";
import { taxYearFor } from "@/lib/tax/engine";
import { estimateConfidence, estimateHeadline, hasConfidenceSignal } from "@/lib/tax/estimate-summary";
import { omitsCharge } from "@/lib/tax/status";
import { useTaxYear } from "@/lib/tax/tax-year-context";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentGroup, JudgmentRow, TaxEstimate } from "@/lib/tax/types";

type EventRecord = { event: NormalizedEvent; version: number };
/** 목록 순서로 계산한 중복 마커. 객체 동일성 대신 이 값을 화면 전체가 공유한다. */
type AnnotatedRecord = { record: EventRecord; occurrence: number; isDuplicate: boolean };
type Tab = "all" | "review";

const classifications: Classification[] = ["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"];

const DIRECTION_LABEL: Record<NormalizedEvent["direction"], string> = { IN: "받음", OUT: "보냄" };

/**
 * 쓴 것과 얻은 것의 색. 색만으로는 구분하지 못하는 사용자가 있으므로 부호(`+`/`-`)와 늘 함께 쓴다.
 * 어느 쪽도 아닌 건(자기 지갑 간 이체·미확정)은 기본색이다 — 색을 붙이면 처분이라고 단정하는 셈이다.
 */
const FLOW_TEXT_CLASS: Record<AssetFlow, string> = {
  in: "text-emerald-700",
  out: "text-rose-700",
  neutral: "text-zinc-900",
};

/**
 * 손익 판정 행에서 합산한 **실현 손익 금액**. 상세의 "손익은 이렇게 나왔습니다" 근거표가 쓰는 것과
 * **같은 소스**(amountKind==="gain")라 목록과 상세가 갈리지 않는다. 손익 판정이 없는 건
 * (NFT·수령분·자기 지갑 간 이체·보류·중복·제외로 rows가 빔)은 null → 목록은 "-"로 둔다.
 * 세무 엔진을 다시 돌리지 않고 이미 계산된 값을 합칠 뿐이다.
 */
function gainAmount(rows: JudgmentRow[]): string | null {
  const gainRows = rows.filter((row) => row.amountKind === "gain");
  if (gainRows.length === 0) return null;
  return sum(gainRows.map((row) => row.amount));
}

/**
 * 손익 판정 행에서 뽑은 수익률(%). 손익 금액과 **같은 소스**(judgment gain 행)를 쓰므로 목록·상세가 갈리지 않는다.
 * 이미 계산된 값(손익/취득가액)을 표시 산술로 나눌 뿐이다. 원가를 알 수 없으면(취득가 0·근거 없음) null.
 */
function gainReturnPercent(rows: JudgmentRow[]): string | null {
  const gainRows = rows.filter((row) => row.amountKind === "gain" && row.breakdown !== undefined);
  if (gainRows.length === 0) return null;
  const gainSum = sum(gainRows.map((row) => row.amount));
  const costSum = sum(gainRows.map((row) => row.breakdown!.cost));
  if (isZero(costSum)) return null;
  return round(div(mul(gainSum, "100"), costSum), 2);
}

const COMPARISON_COUNTRIES = ["DE", "IN", "PT"] as const;

function OtherCountryJudgments({
  eventId,
  countryCode,
  taxYear,
  grounded,
}: {
  eventId: string;
  countryCode: string;
  taxYear: number;
  /** 과세연도가 신뢰할 수 있는 기간에서 나왔는가. 아니면 계산 자체를 하지 않는다. */
  grounded: boolean;
}) {
  const [de, india, portugal] = COMPARISON_COUNTRIES;
  const firstCountry = countryCode === de ? india : de;
  const secondCountry = countryCode === de ? portugal : countryCode === india ? portugal : india;
  const firstEstimate = useTaxEstimate({ country: firstCountry, taxYear, source: "wallet" }, grounded);
  const secondEstimate = useTaxEstimate({ country: secondCountry, taxYear, source: "wallet" }, grounded);
  const firstFresh = fresh(firstEstimate, !grounded);
  const secondFresh = fresh(secondEstimate, !grounded);
  const firstRows = firstFresh.data?.judgments.filter((row) => row.eventId === eventId) ?? [];
  const secondRows = secondFresh.data?.judgments.filter((row) => row.eventId === eventId) ?? [];

  const renderRows = (
    estimate: TaxEstimate | undefined,
    rows: JudgmentRow[],
    country: string,
    state: FreshState,
  ) => {
    if (!estimate) {
      return <p className={state === "error" ? "text-sm text-amber-800" : "text-sm text-zinc-500"}>{freshNotice(state, `${country} 판정 정보`)}</p>;
    }
    // 로딩이 끝났는데 행이 없으면 그 나라 계산에도 들어가지 않은 것이다. 계속 "불러오는 중"이라 하면 거짓이다.
    if (rows.length === 0) {
      return (
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
          <span className="font-medium">{estimate.countryLabel}</span>
          <span className="text-zinc-500">계산에 들어가지 않음</span>
        </p>
      );
    }

    return rows.map((row, index) => (
      <p key={`${row.eventId}-${row.leg}-${index}`} className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
        <span className="font-medium">{estimate.countryLabel}</span>
        {row.leg === "dispose" ? <span className="text-zinc-500">내보냄</span> : null}
        {row.leg === "receive" ? <span className="text-zinc-500">받음</span> : null}
        <JudgmentBadge group={row.group} label={row.label} />
        <span>{AMOUNT_KIND_LABEL[row.amountKind]} · {isZero(row.amount) ? "없음" : formatFiat(row.amount, estimate.currency)}</span>
      </p>
    ));
  };

  return (
    <details className="mt-4 rounded-lg bg-zinc-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-700 marker:text-zinc-400">다른 나라였다면</summary>
      <div className="mt-2 space-y-2">
        {renderRows(firstFresh.data, firstRows, firstCountry, firstFresh.state)}
        {renderRows(secondFresh.data, secondRows, secondCountry, secondFresh.state)}
      </div>
    </details>
  );
}

function EventDetails({
  record,
  onClose,
  judgmentRows,
  isExcluded,
  isDuplicate,
  judgmentError,
  estimate,
  countryCode,
  taxYear,
  taxYearGrounded,
  inPeriod,
  period,
  swapInLeg,
}: {
  record: EventRecord;
  onClose: () => void;
  judgmentRows?: JudgmentRow[];
  isExcluded?: boolean;
  /** 스왑의 받은(IN) 다리. 같은 tx_hash 페어가 있으면 상세가 두 다리(처분+취득)를 함께 말한다. */
  swapInLeg?: NormalizedEvent | null;
  /** 과세연도가 신뢰할 수 있는 기간에서 나왔는가. 아니면 파생 계산을 돌리지 않는다. */
  taxYearGrounded?: boolean;
  estimate?: TaxEstimate;
  countryCode?: string;
  taxYear?: number;
  inPeriod?: boolean | null;
  judgmentError?: boolean;
  isDuplicate?: boolean;
  period?: { from: string; to: string };
}) {
  const [current, setCurrent] = useState(record);
  const [classification, setClassification] = useState<Classification>(effectiveClassification(record.event));
  const [reason, setReason] = useState(record.event.user_override?.reason ?? "");
  const [conflictMessage, setConflictMessage] = useState(false);
  const [saved, setSaved] = useState(false);
  const reclassify = useReclassify();
  const detail = useEventDetail(record.event.id);
  // 목록이 갱신돼 더 최신 버전이 들어오면 시트도 따라가야 한다.
  // 리마운트(key에 version 포함)로 처리하면 충돌 경고와 입력이 날아가므로 렌더 중 동기화한다.
  // React 권장 패턴: effect가 아니라 "이전 prop을 state로 들고 렌더 중 비교".
  const [syncedVersion, setSyncedVersion] = useState(record.version);
  // 사용자가 손대지 않은 입력만 최신값으로 맞춘다. 편집 중이면 덮어쓰지 않고 경고만 띄운다.
  const isDirty =
    classification !== effectiveClassification(current.event) ||
    reason !== (current.event.user_override?.reason ?? "");
  if (record.version > syncedVersion) {
    setSyncedVersion(record.version);
    setCurrent(record);
    if (!isDirty) {
      setClassification(effectiveClassification(record.event));
      setReason(record.event.user_override?.reason ?? "");
    }
    setConflictMessage(true);
    setSaved(false);
  }

  const detailFresh = fresh(detail);
  const history = detailFresh.data?.override_history ?? [];
  const event = current.event;
  const resolvedCountryCode = countryCode ?? "KR";
  const resolvedTaxYear = taxYear ?? new Date().getFullYear();
  const marginalEstimate = useTaxEstimate(
    {
      country: resolvedCountryCode,
      taxYear: resolvedTaxYear,
      source: "wallet",
      includeMarginal: true,
    },
    // 부담을 산출하지 않는 룰셋(규칙 미확정·시행 전)은 그 0을 차분해 "영향 없음"이라 하면 거짓이다.
    // 중복 레코드도 id로 키가 잡히는 결과를 물려받으면 안 된다.
    (taxYearGrounded ?? true) && estimate !== undefined && !omitsCharge(estimate.status) && !isDuplicate,
  );
  const gainRows = (judgmentRows ?? []).filter((row) => row.amountKind === "gain");
  const marginalFresh = fresh(
    marginalEstimate,
    taxYearGrounded === false || estimate === undefined || omitsCharge(estimate.status) || isDuplicate === true,
  );
  const marginalContribution = marginalFresh.data?.marginalContributions?.[event.id];
  const currency = estimate?.currency ?? marginalFresh.data?.currency ?? "KRW";

  const apply = () => {
    setSaved(false);
    reclassify.mutate(
      { id: event.id, input: { classification, reason: reason || undefined, expectedVersion: current.version } },
      {
        onSuccess: (result) => {
          if (result.status === "not_found") return;
          setCurrent({ event: result.event, version: result.version });
          // 내가 만든 변경이다. 이후 목록 갱신으로 같은 version이 들어와도 외부 변경으로 오인하지 않는다.
          setSyncedVersion(result.version);
          setClassification(effectiveClassification(result.event));
          setReason(result.event.user_override?.reason ?? "");
          setConflictMessage(result.status === "conflict");
          setSaved(result.status === "ok");
        },
      },
    );
  };

  return (
    <BottomSheet open onClose={onClose} title="거래 상세">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-900">거래 상세</h2>
        <button type="button" className="-mr-2 px-2 py-1 text-sm font-medium text-zinc-500" onClick={onClose}>닫기</button>
      </div>
      {conflictMessage ? <p role="alert" className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">다른 곳에서 변경됨, 다시 확인</p> : null}
      {saved && !conflictMessage ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">분류를 저장했습니다.</p> : null}

      <div className="mt-4 flex items-baseline justify-between gap-3">
        {swapInLeg ? (
          // 스왑은 두 다리를 함께 부른다 — 내보낸 자산과 받은 자산이 한 거래다.
          <div className="flex min-w-0 items-center gap-2">
            <SplitAssetLogo left={event} right={swapInLeg} size={36} />
            <p className="min-w-0 truncate text-xl font-bold tracking-tight">
              <span className="text-rose-700">{formatSignedTokenAmount(event)} {assetTicker(event)}</span>
              <span className="text-zinc-400"> → </span>
              <span className="text-emerald-700">{formatSignedTokenAmount(swapInLeg)} {assetTicker(swapInLeg)}</span>
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <AssetLogo event={event} size={36} />
            <p className={`min-w-0 truncate text-2xl font-bold tracking-tight ${FLOW_TEXT_CLASS[assetFlow(event)]}`}>
              {formatSignedTokenAmount(event)} <span className="text-base font-semibold text-zinc-500">{assetLabel(event)}</span>
            </p>
          </div>
        )}
        <ClassificationBadge classification={effectiveClassification(event)} />
      </div>
      {/* 거래 상세는 정확한 "언제"가 중요한 자리라 시각을 UTC·KST로 병기한다(한국 신고용). 목록 머리글은 UTC 날짜 그대로다. */}
      <p className="mt-1 text-sm text-zinc-500">
        {formatDateTime(event.block_timestamp)} · {event.price_status === "UNKNOWN" ? "가격 미확인" : formatFiat(event.fiat_value, event.fiat_currency)}
        {event.price_status === "ESTIMATED" ? " (추정)" : ""}
      </p>

      {/* 확인 필요 사유. 목록에서 배지를 뺀 대신, 무엇을 확인해야 하는지는 여기서 그대로 밝힌다
          (review.ts 하나가 판정 — 가격 확인·방향/분류 불일치·신뢰도 등). 중복·계산 제외·이체 섹션은
          아래 전용 안내가 사유까지 말하므로 그 경우는 빼고, 그 밖의 확인 필요만 여기서 띄운다 —
          이체는 판정이 도착한(inPeriod≠null) 뒤 아래 섹션이 사유를 말하므로, 보류 중일 때만 여기서 띄운다. */}
      {needsReview(event) && !isDuplicate && !isExcluded
        && !(effectiveClassification(event) === "INTERNAL_TRANSFER" && inPeriod !== null) ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          확인 필요 · {reviewReason(event)}
        </p>
      ) : null}

      {/* 스왑 구성 — 한 거래의 두 다리. 내보낸 자산의 손익은 아래 "손익은 이렇게 나왔습니다" 근거표가
          말하고, 받은 자산은 여기서 취득가액(원가)을 밝힌다 — 지금 세금이 아니라 **이연**임을 함께 말해야
          사용자가 받은 다리를 "무관"이 아니라 "나중 처분의 원가"로 읽는다. */}
      {swapInLeg ? (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-700">스왑 구성: 한 거래, 두 다리</h3>
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-zinc-700">
              <span className="font-semibold text-rose-700">내보낸 자산</span> {formatSignedTokenAmount(event)} {assetTicker(event)}
              <span className="text-zinc-500"> · 손익은 아래 근거표가 말합니다.</span>
            </p>
            <div className="rounded-lg bg-white p-3">
              <p className="font-semibold text-emerald-700">받은 자산 {formatSignedTokenAmount(swapInLeg)} {assetTicker(swapInLeg)}</p>
              <p className="mt-1 text-zinc-700">취득가액 · {formatFiat(swapInLeg.fiat_value, swapInLeg.fiat_currency)}</p>
              {/* 받은 다리가 목록·대표 배지에서 빠지므로, 이 다리의 확인 필요(가격 미확정 등)는
                  취득원가를 고치는 바로 이 자리에서 밝힌다 — 안 그러면 취득원가를 바로잡을 길이 없다. */}
              {needsReview(swapInLeg) ? (
                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">확인 필요 · {reviewReason(swapInLeg)}</p>
              ) : null}
              <p className="mt-1 text-zinc-500">지금 내는 세금이 아닙니다. 이 자산을 나중에 팔 때의 원가가 됩니다(손익 이연).</p>
            </div>
          </div>
        </section>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {/* 해시를 글자로만 두면 사용자가 원본 거래를 확인할 방법이 없다.
            우리가 모르는 체인이면 링크를 걸지 않는다 — 죽은 링크는 확인시켜주는 척만 한다. */}
        <div>
          <dt className="text-zinc-500">트랜잭션</dt>
          <dd className="mt-1 font-mono text-xs font-medium text-zinc-900">
            {explorerTxUrl(event.chain_id, event.tx_hash)
              ? <a className="underline" href={explorerTxUrl(event.chain_id, event.tx_hash)!} target="_blank" rel="noreferrer noopener">{shortHash(event.tx_hash)}</a>
              : shortHash(event.tx_hash)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">체인</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-1.5 font-medium text-zinc-900">
            <ChainIcon chainId={event.chain_id} />
            {chainLabel(event.chain_id)}
            {/* 브릿지는 도착 체인까지 병기한다 — 어디로 이동했는지가 이 거래의 핵심 사실이다. */}
            {event.bridge_dest_chain_id !== null ? (
              <>
                <span className="text-zinc-400">→</span>
                <ChainIcon chainId={event.bridge_dest_chain_id} />
                {chainLabel(event.bridge_dest_chain_id)}
              </>
            ) : null}
          </dd>
        </div>
        {/* 상대 주소. 알려진 컨트랙트(Aave·Lido 등)면 이름으로 부르고 축약 주소를 병기한다 —
            이름은 BE가 준 counterparty_label(브릿지·애그리게이터 레지스트리)이 먼저, 없으면 mock 레지스트리(lib/contracts.ts),
            모르는 주소는 지어내지 않고 축약만 보인다. */}
        <div>
          <dt className="text-zinc-500">상대</dt>
          <dd className="mt-1 wrap-anywhere font-medium text-zinc-900">
            {counterpartyLabel(event.counterparty, event.counterparty_label ?? null)}
            {knownContractName(event.counterparty, event.counterparty_label ?? null)
              ? <span className="ml-1 font-mono text-xs font-normal text-zinc-400">({shortHash(event.counterparty)})</span>
              : null}
          </dd>
        </div>
        <div><dt className="text-zinc-500">방향</dt><dd className="mt-1 font-medium text-zinc-900">{DIRECTION_LABEL[event.direction]}</dd></div>
        {/* DeFi 수익 수령이면 무슨 수익인지 밝힌다. 과세/보류 여부는 아래 판정 배지가 말하므로 여기선 종류만 둔다. */}
        {event.income_kind
          ? <div><dt className="text-zinc-500">수익 종류</dt><dd className="mt-1 font-medium text-zinc-900">{INCOME_KIND_LABEL[event.income_kind]}</dd></div>
          : null}
        {/* 심볼은 사칭할 수 있다. 대조 결과를 자산 정보 옆에 붙여 이름만 믿지 않게 한다. */}
        <div>
          <dt className="text-zinc-500">자산 타입</dt>
          <dd className="mt-1 font-medium text-zinc-900">
            {event.asset_type} · {event.asset_verified ? "검증됨" : "미검증 토큰"}
          </dd>
        </div>
        <div><dt className="text-zinc-500">신뢰도</dt><dd className="mt-1 font-medium text-zinc-900">{Math.round(event.confidence * 100)}%</dd></div>
        <div><dt className="text-zinc-500">이력</dt><dd className="mt-1 font-medium text-zinc-900">{event.user_override ? `사용자 확정 · ${formatDate(event.user_override.overridden_at)}` : "자동 분류"}</dd></div>
        {/* 가스는 체인 네이티브 수량이라 법정통화 환산 없이는 원가·양도가액에 넣을 수 없다
            (LIMITATION_MESSAGE.GAS_FEE). 위 손익 근거의 `− 수수료`가 왜 0인지 여기서만 답할 수 있다. */}
        <div><dt className="text-zinc-500">가스</dt><dd className="mt-1 font-medium text-zinc-900">{formatTokenAmount(event.gas_fee_native, 0)} {nativeSymbol(event.chain_id)}</dd></div>
      </dl>
      {gainRows.length > 0 ? (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-700">손익은 이렇게 나왔습니다</h3>
          <div className="mt-3 space-y-4">
            {gainRows.map((row, index) => (
              <div key={`${row.eventId}-${row.leg}-${index}`}>
                {row.leg !== "single" ? <h4 className="text-sm font-medium text-zinc-700">{row.leg === "dispose" ? "내보낸 자산" : "받은 자산"}</h4> : null}
                {/* 금액만 보이고 어떻게 나왔는지 숨기면 사용자가 검증할 수 없다.
                    양도가액 − 취득가액 − 수수료 = 손익 네 줄을 그대로 보인다. */}
                {/* 네 줄의 산술이 화면에서도 맞아야 한다 — 독립 반올림하면
                    €0.01 − €0.00 − €0.00 = €0.00 같은 모순이 생기므로 정확 표기를 쓴다. */}
                {row.breakdown ? (
                  <dl className="mt-2 grid gap-1 rounded-lg bg-white p-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-zinc-500">양도가액</dt>
                      <dd className="font-medium text-zinc-900">{formatFiatExact(row.breakdown.proceeds, currency)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-zinc-500">− 취득가액</dt>
                      <dd className="font-medium text-zinc-900">{formatFiatExact(row.breakdown.cost, currency)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-zinc-500">− 수수료</dt>
                      <dd className="font-medium text-zinc-900">{formatFiatExact(row.breakdown.fee, currency)}</dd>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-1">
                      <dt className="font-medium text-zinc-700">= 손익</dt>
                      <dd className="font-bold text-zinc-900">{formatFiatExact(row.amount, currency)}</dd>
                    </div>
                  </dl>
                ) : null}
                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-zinc-500">손익</dt><dd className="mt-1 font-medium text-zinc-900">{isZero(row.amount) ? "손익 없음" : formatFiat(row.amount, currency)}</dd></div>
                  <div>
                    <dt className="text-zinc-500">보유일</dt>
                    {/* 여러 취득분을 소비하면 보유기간이 하나로 정해지지 않는다.
                        "-"만 두면 기록이 없는 것과 구분되지 않는다. */}
                    <dd className="mt-1 font-medium text-zinc-900">
                      {row.holdingDays !== null
                        ? `${row.holdingDays}일`
                        : row.lots > 1
                          ? "취득분마다 다름"
                          : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">취득일</dt>
                    <dd className="mt-1 font-medium text-zinc-900">
                      {row.acquiredAt ? formatDate(row.acquiredAt) : row.lots > 1 ? "취득분마다 다름" : "-"}
                    </dd>
                  </div>
                  <div><dt className="text-zinc-500">소비한 취득분</dt><dd className="mt-1 font-medium text-zinc-900">{row.lots}개</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {isDuplicate ? (
        <section className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          같은 이벤트 id가 두 번 이상 들어와, 첫 건의 판정을 이 거래에 붙이지 않았습니다. 확인이 필요합니다.
          {needsReview(event) ? ` · ${reviewReason(event)}` : ""}
        </section>
      ) : isExcluded ? (
        <section className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          가격·분류·수량을 확정하지 못해 계산에 들어가지 않았습니다.
          {needsReview(event) ? ` · ${reviewReason(event)}` : ""}
        </section>
      ) : inPeriod !== null && effectiveClassification(event) === "INTERNAL_TRANSFER" ? (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
          {needsReview(event)
            ? `자기 지갑 간 이체라 처분으로 보지 않았습니다. 다만 ${reviewReason(event)} 상태라 확인이 필요합니다.`
            : "자기 지갑 간 이체라 처분으로 보지 않았습니다. 확인이 필요한 건이 아니라 과세 대상이 아닌 것입니다."}
        </section>
      ) : judgmentRows && judgmentRows.length > 0 ? (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-700">이 손익이 계산에서 어떻게 쓰였나</h3>
          <div className="mt-2 space-y-2 text-sm">
            {judgmentRows.map((row, index) => (
              <div key={`${row.eventId}-${row.leg}-${index}`} className="text-zinc-700">
                <JudgmentBadge group={row.group} label={row.label} />
                {/* 손익 행은 위 "손익은 이렇게 나왔습니다"가 산술 근거까지 보인다 — 여기서 또 쓰면 같은 값이 두 번 나온다.
                    취득·수령·이연에는 그 표가 없으므로, 금액이 세금이 아니라 무엇인지 밝힐 곳이 여기뿐이다. */}
                {row.amountKind !== "gain" ? (
                  <p className="mt-1 text-zinc-700">
                    {AMOUNT_KIND_LABEL[row.amountKind]} · {isZero(row.amount) ? "원가 없음" : formatFiat(row.amount, currency)}
                    {row.inPeriod ? "" : " · 기간 밖(원가 추적용)"}
                  </p>
                ) : null}
                <p className="mt-1 wrap-anywhere text-zinc-500">{row.basis}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
          {inPeriod === null
            ? (taxYearGrounded === false
                ? "기준 기간을 확인하지 못해 이 거래의 판정을 계산하지 않았습니다."
                : judgmentError
                  ? "판정 결과를 불러오지 못했습니다. 위의 다시 시도를 눌러주세요."
                  : "판정 결과를 아직 불러오는 중입니다.")
            : inPeriod === false && period
            ? `이번 과세기간(${periodLabel(period)}) 밖이라 이 계산에 들어가지 않았습니다.`
            : "이 과세기간 계산에서 판정을 찾지 못했습니다. 확인이 필요합니다."}
        </section>
      )}
      {marginalContribution !== undefined ? (
        <details className="mt-4 rounded-lg bg-zinc-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-700 marker:text-zinc-400">이 거래가 없었다면</summary>
          <p className="mt-2 text-sm text-zinc-700">
            {isZero(marginalContribution)
              ? "총액이 그대로입니다. 부담에 영향 없음"
              : isNegative(marginalContribution)
                ? <>이 거래를 지우면 부담이 늘어납니다. 취득원가가 사라지기 때문입니다 · {formatFiat(marginalContribution, currency)}</>
                : formatFiat(marginalContribution, currency)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">부담을 건별로 나눠 넣을 수 없어, 이 거래를 뺀 경우의 차이를 보입니다.</p>
        </details>
      ) : null}
      {/* 중복 레코드는 자기 판정이 없다. 나라별 비교도 id로 잡히므로 첫 건의 결과를 물려받으면 안 된다. */}
      {isDuplicate ? null : (
        <OtherCountryJudgments eventId={event.id} countryCode={resolvedCountryCode} taxYear={resolvedTaxYear} grounded={taxYearGrounded ?? true} />
      )}
      {history.length > 0 ? (
        <details className="mt-4 rounded-lg bg-zinc-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-700 marker:text-zinc-400">재분류 이력</summary>
          <ul className="mt-2 space-y-1 text-sm wrap-anywhere text-zinc-600">
            {history.map((entry, index) => (
              <li key={`${entry.overridden_at}-${index}`}>
                {formatDate(entry.overridden_at)} · {entry.from} → {entry.to}
                {entry.reason ? ` · ${entry.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {/* 재분류·금액 입력은 **고칠 때만** 필요한 자리다. 늘 펼쳐 두면 사실을 읽으러 온 사용자가
          매번 입력 폼을 스크롤해서 지나쳐야 한다. 접되, 접힌 줄에서 지금 값이 무엇인지는 말한다. */}
      <details className="mt-6 border-t border-zinc-200 pt-5">
        <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">
          재분류
          <span className="ml-2 text-sm font-medium text-zinc-500">현재 {CLASSIFICATION_LABEL[classification]}</span>
        </summary>
        <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="classification">분류</label>
        <select id="classification" className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5" value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
          {classifications.map((item) => <option key={item} value={item}>{CLASSIFICATION_LABEL[item]}</option>)}
        </select>
        <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="reason">사유 (선택)</label>
        <input id="reason" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5" placeholder="예: 본인 지갑 간 이동" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" className="mt-4 w-full rounded-lg bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={reclassify.isPending} onClick={apply}>적용</button>
      </details>
      <ValueOverrideEditor
        event={event}
        version={current.version}
        onSaved={(mutation) => {
          setCurrent(mutation);
          // 내가 만든 변경이다. 이후 목록 갱신으로 같은 version이 들어와도 외부 변경으로 오인하지 않는다.
          setSyncedVersion(mutation.version);
        }}
      />
    </BottomSheet>
  );
}

/**
 * 한 거래의 금액 override 입력 — 취득가·양도가·부대비용·가스비·가격출처·증빙·50% 필요경비 의제.
 *
 * 재분류 state와 섞지 않으려고 독립 컴포넌트로 둔다(각자 자기 입력만 동기화한다).
 * 저장하면 estimate·요약·판정 캐시가 무효화돼(useSetValueOverride) 취득가 0원 경고가 사라지고 부담이 다시 계산된다.
 */
function ValueOverrideEditor({
  event,
  version,
  onSaved,
}: {
  event: NormalizedEvent;
  version: number;
  onSaved: (mutation: EventRecord) => void;
}) {
  const setOverride = useSetValueOverride();
  const vo = event.value_override;
  const [acquisitionCost, setAcquisitionCost] = useState(vo?.acquisition_cost ?? "");
  const [disposalValue, setDisposalValue] = useState(vo?.disposal_value ?? "");
  const [incidentalCost, setIncidentalCost] = useState(vo?.incidental_cost ?? "");
  const [gasFee, setGasFee] = useState(vo?.gas_fee ?? "");
  const [priceSource, setPriceSource] = useState(vo?.price_source ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(vo?.evidence_url ?? "");
  const [deemed50, setDeemed50] = useState(vo?.deemed_expense_50 ?? false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);

  const flow = assetFlow(event);
  const isDisposal = flow === "out";
  // 저장된 override가 하나라도 있으면 접힌 줄에서 그렇다고 말한다(입력 중인 state가 아니라 **저장된 사실**).
  const hasOverride =
    vo !== undefined &&
    vo !== null &&
    (vo.acquisition_cost !== null ||
      vo.disposal_value !== null ||
      vo.incidental_cost !== null ||
      vo.gas_fee !== null ||
      vo.price_source !== null ||
      vo.evidence_url !== null ||
      vo.deemed_expense_50 === true);
  // 빈 입력은 "비움"(null)으로 저장한다. 공백만 남긴 것도 같게 본다.
  const clean = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };

  const save = () => {
    setSaved(false);
    setConflict(false);
    setOverride.mutate(
      {
        id: event.id,
        input: {
          expectedVersion: version,
          value_override: {
            acquisition_cost: clean(acquisitionCost),
            disposal_value: clean(disposalValue),
            incidental_cost: clean(incidentalCost),
            gas_fee: clean(gasFee),
            price_source: clean(priceSource),
            evidence_url: clean(evidenceUrl),
            deemed_expense_50: deemed50,
          },
        },
      },
      {
        onSuccess: (result) => {
          if (result.status === "not_found") return;
          onSaved({ event: result.event, version: result.version });
          setConflict(result.status === "conflict");
          setSaved(result.status === "ok");
        },
      },
    );
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5";
  const labelClass = "mt-3 block text-sm font-medium text-zinc-700";

  return (
    <details className="mt-6 border-t border-zinc-200 pt-5" data-surface="value-override">
      <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">
        취득가·부대비용 입력
        {/* 접힌 채로는 "내가 직접 채운 금액이 이미 있는지"를 알 길이 없다 — 그 사실만은 겉에 남긴다. */}
        <span className="ml-2 text-sm font-medium text-zinc-500">{hasOverride ? "직접 입력한 금액 있음" : "비어 있음"}</span>
      </summary>
      <p className="mt-2 text-sm text-zinc-500">지갑 데이터로 확정되지 않은 금액을 직접 채우면 &ldquo;취득가 0원&rdquo; 경고가 사라지고 계산에 반영됩니다.</p>
      {conflict ? <p role="alert" className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">다른 곳에서 변경됨, 다시 확인</p> : null}
      {saved && !conflict ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">금액을 저장했습니다.</p> : null}

      {isDisposal ? (
        <>
          <label className={labelClass} htmlFor="vo-disposal">양도가액 (원)</label>
          <input id="vo-disposal" inputMode="numeric" className={fieldClass} placeholder="예: 5000000" value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} />
        </>
      ) : (
        <>
          <label className={labelClass} htmlFor="vo-acquisition">취득가액 (원)</label>
          <input id="vo-acquisition" inputMode="numeric" className={fieldClass} placeholder="예: 1000000" value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} />
        </>
      )}

      <label className={labelClass} htmlFor="vo-incidental">부대비용 (원)</label>
      <input id="vo-incidental" inputMode="numeric" className={fieldClass} placeholder="예: 5000" value={incidentalCost} onChange={(e) => setIncidentalCost(e.target.value)} />

      <label className={labelClass} htmlFor="vo-gas">가스비 (원)</label>
      <input id="vo-gas" inputMode="numeric" className={fieldClass} placeholder="예: 3000" value={gasFee} onChange={(e) => setGasFee(e.target.value)} />

      <label className={labelClass} htmlFor="vo-source">가격 출처 (선택)</label>
      <input id="vo-source" className={fieldClass} placeholder="예: 업비트 종가" value={priceSource} onChange={(e) => setPriceSource(e.target.value)} />

      <label className={labelClass} htmlFor="vo-evidence">증빙 링크 (선택)</label>
      <input id="vo-evidence" className={fieldClass} placeholder="https://" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />

      {isDisposal ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="mt-0.5" checked={deemed50} onChange={(e) => setDeemed50(e.target.checked)} />
          <span>취득가 입증이 어려우면 양도가액의 50%를 필요경비로 인정</span>
        </label>
      ) : null}

      <button type="button" className="mt-4 w-full rounded-lg bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={setOverride.isPending} onClick={save}>금액 저장</button>
    </details>
  );
}

/**
 * 목록 한 줄의 **거래 타입** 라벨(왼쪽 굵은 줄).
 *
 * 분류(classification)를 그대로 쓰되, 스왑·브릿지는 별도로 부른다:
 * - income_kind가 있으면 그 수익 종류(스테이킹 보상 등)
 * - EXCHANGE → 도착 체인이 있으면(자산이 바뀌는 크로스체인 브릿지, 예: Mayan) "브릿지 스왑",
 *   아니면 같은 체인 스왑 "스왑"
 * - INTERNAL_TRANSFER → 도착 체인이 있으면(같은 자산 크로스체인 이동) "브릿지", 아니면 "이동"
 * - 그 밖(RECEIVE·SEND·UNKNOWN) → 분류 라벨(수신·송금·미분류)
 *
 * 판정 도장(취득·양도 등)은 이제 목록이 아니라 거래 상세에서만 말한다.
 */
function transactionTypeLabel(event: NormalizedEvent): string {
  if (event.income_kind) return INCOME_KIND_LABEL[event.income_kind];
  const classification = effectiveClassification(event);
  if (classification === "EXCHANGE") return event.bridge_dest_chain_id !== null ? "브릿지 스왑" : "스왑";
  if (classification === "INTERNAL_TRANSFER") return event.bridge_dest_chain_id !== null ? "브릿지" : "이동";
  return CLASSIFICATION_LABEL[classification];
}

/**
 * 거래 타입 배지의 색. 분류별 색은 상세 상단의 ClassificationBadge와 같은 팔레트를 쓰되,
 * income_kind(수익 수령)는 IncomeKindBadge처럼 violet로 구분한다. 스왑(EXCHANGE)·브릿지·이동
 * (INTERNAL_TRANSFER)은 분류 색을 그대로 따른다(라벨만 transactionTypeLabel이 바꾼다).
 */
const TYPE_BADGE_CLASS: Record<Classification, string> = {
  RECEIVE: "bg-green-100 text-green-700",
  SEND: "bg-red-100 text-red-700",
  EXCHANGE: "bg-orange-100 text-orange-700",
  INTERNAL_TRANSFER: "bg-blue-100 text-blue-700",
  UNKNOWN: "bg-zinc-100 text-zinc-600",
  // 스팸은 원장에서 빠져 목록에 뜨지 않지만 Record 계약상 빠짐없이 있어야 한다.
  SPAM: "bg-zinc-200 text-zinc-500",
};

/** 목록 왼쪽의 **거래 타입 배지**. 라벨은 transactionTypeLabel, 색은 분류(또는 수익 수령이면 violet). */
function TransactionTypeBadge({ event }: { event: NormalizedEvent }) {
  const className = event.income_kind
    ? "bg-violet-100 text-violet-700"
    : TYPE_BADGE_CLASS[effectiveClassification(event)];
  return (
    <span className={`inline-flex shrink-0 items-center self-start rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      {transactionTypeLabel(event)}
    </span>
  );
}

/** 토큰 로고 코너에 얹는 작은 체인 배지 — 배경 흰 링으로 로고와 분리한다. */
function ChainBadgeGlyph({ chainId, size = 18 }: { chainId: number; size?: number }) {
  return (
    <span className="inline-flex rounded-full shadow-[0_0_0_2px_#fff]">
      <ChainIcon chainId={chainId} size={size} />
    </span>
  );
}

/**
 * 목록 왼쪽의 **로고 클러스터**. 체인 이름은 텍스트로 쓰지 않고 로고만 코너 배지로 얹는다.
 * - 스왑: 보낸 자산·받은 자산 두 로고를 겹쳐 보인다(상대 자산은 표시 힌트 `swap_to_*`).
 * - 브릿지: 자산 로고 하나에 출발·도착 두 체인 배지를 나란히 얹는다.
 * - 그 밖: 자산 로고 하나에 체인 배지 하나.
 * 아이콘은 전부 `aria-hidden`이고, 무슨 거래인지는 옆의 타입·티커 텍스트가 말한다.
 */
function TransactionLogo({ event, swapInLeg }: { event: NormalizedEvent; swapInLeg?: NormalizedEvent | null }) {
  // 스왑 페어(같은 tx의 IN 다리)가 있으면 실제 받은 자산의 마크를 겹쳐 그린다 — 표시 힌트보다 원장이 우선.
  if (swapInLeg) {
    // 자산이 바뀌는 브릿지(브릿지 스왑)는 체인도 둘이다 — 같은 자산 브릿지와 같은 방식으로
    // 출발·도착 체인 배지를 나란히 얹어, 체인 이름을 텍스트로 쓰지 않아도 어디서 어디로 건넜는지 보이게 한다.
    const destChainId = event.bridge_dest_chain_id;
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <SplitAssetLogo left={event} right={swapInLeg} size={40} />
        {destChainId !== null ? (
          <span className="absolute -bottom-1 -right-2 flex items-center">
            <ChainBadgeGlyph chainId={event.chain_id} size={16} />
            <span className="-ml-1.5">
              <ChainBadgeGlyph chainId={destChainId} size={16} />
            </span>
          </span>
        ) : (
          <span className="absolute -bottom-1 -right-1">
            <ChainBadgeGlyph chainId={event.chain_id} size={18} />
          </span>
        )}
      </span>
    );
  }

  if (event.swap_to_symbol !== null) {
    // 받은 자산은 원장이 알려준 표시 힌트다 — 컨트랙트가 없어 로고는 메타데이터 이미지나 대체 마크로 그린다.
    const toMark = {
      chain_id: event.chain_id,
      asset_type: "ERC20" as const,
      asset_contract: null,
      asset_symbol: event.swap_to_symbol,
      asset_icon_url: event.swap_to_icon_url,
      token_id: null,
    };
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <SplitAssetLogo left={event} right={toMark} size={40} />
        <span className="absolute -bottom-1 -right-1">
          <ChainBadgeGlyph chainId={event.chain_id} size={18} />
        </span>
      </span>
    );
  }

  if (event.bridge_dest_chain_id !== null) {
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <AssetLogo event={event} size={40} />
        <span className="absolute -bottom-1 -right-2 flex items-center">
          <ChainBadgeGlyph chainId={event.chain_id} size={16} />
          <span className="-ml-1.5">
            <ChainBadgeGlyph chainId={event.bridge_dest_chain_id} size={16} />
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
      <AssetLogo event={event} size={40} />
      <span className="absolute -bottom-1 -right-1">
        <ChainBadgeGlyph chainId={event.chain_id} size={18} />
      </span>
    </span>
  );
}

function EventRow({
  record,
  onSelect,
  rows,
  currency,
  isExcluded,
  inPeriod,
  isDuplicate,
  hideBalances,
  swapInLeg,
  isFirstNew,
}: {
  record: EventRecord;
  onSelect: () => void;
  rows: JudgmentRow[];
  /** 손익을 그릴 통화(estimate와 같은 소스). rows가 비면 손익도 없어 통화는 쓰이지 않는다. */
  currency: string;
  isExcluded: boolean;
  inPeriod: boolean | null;
  isDuplicate: boolean;
  /** 잔액 가리기 모드. 수량은 가리되 자산 심볼·배지·건수는 정보로 남긴다. */
  hideBalances?: boolean;
  /** 스왑의 받은(IN) 다리 — 같은 tx_hash 페어. 있으면 이 행이 두 다리를 한 줄로 말한다. */
  swapInLeg?: NormalizedEvent | null;
  /** 이번 불러오기로 들어온 **첫** 거래인가. 완료 알림의 "보러 가기"가 찾아올 자리다. */
  isFirstNew?: boolean;
}) {
  const { event } = record;
  // 손익·수익률은 상세와 같은 판정 손익 행에서만 나온다 — 보류·중복·제외 때는 rows가 비어 자연히 null이 된다.
  const gain = gainAmount(rows);
  const returnPercent = gainReturnPercent(rows);

  return (
    // 카드는 이벤트 id로 식별한다. 금액 라벨은 유효 분류에 따라 부호가 뒤집히므로(재분류 후 +0.01 → -0.01)
    // 그걸 식별자로 쓰면 "방금 고친 카드"를 다시 찾지 못한다.
    // 한 줄 레이아웃 — 왼쪽: 로고(체인은 코너 배지)·거래 타입·티커 / 오른쪽: 손익·수익률.
    // 그리드 아이템은 min-width:auto라 스왑 행의 nowrap 티커 줄이 행 전체를 컬럼보다 넓게 키운다 — min-w-0로 트랙 폭에 맞춰 truncate가 실제로 일하게 한다.
    <button data-event-id={event.id} data-new-event={isFirstNew ? "true" : undefined} type="button" className="flex min-w-0 items-center gap-3 rounded-card border border-zinc-200 bg-white px-4 py-3 text-left shadow-card active:bg-zinc-50" onClick={onSelect}>
      {/* 왼쪽 로고 클러스터. 체인 이름은 텍스트로 쓰지 않고 로고만 코너 배지로 얹는다.
          스왑은 두 자산 로고, 브릿지는 두 체인 배지로 그린다. */}
      <TransactionLogo event={event} swapInLeg={swapInLeg} />
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <TransactionTypeBadge event={event} />
        {/* 티커 줄. e2e·테스트가 이 속성으로 행을 집으므로 레이아웃이 바뀌어도 유지한다.
            스왑 페어는 "−보낸 수량 → +받은 수량"(얼마를 얼마만큼), 같은 자산 브릿지는 부호 없는 수량과 티커,
            NFT는 개체 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커를 함께 보인다. 체인은 브릿지도 포함해
            텍스트로 쓰지 않는다 — 출발·도착은 왼쪽 로고의 체인 배지 두 개가 말하고, 스크린리더용 sr-only만 남긴다. */}
        <span data-event-label className="mt-0.5 block truncate text-[0.8125rem] text-zinc-500">
          {swapInLeg ? (
            <>
              <span className="text-rose-700">{hideBalances ? "•••••" : `${formatSignedTokenAmount(event)} ${assetTicker(event)}`}</span>
              <span className="text-zinc-400"> → </span>
              <span className="text-emerald-700">{hideBalances ? "•••••" : `${formatSignedTokenAmount(swapInLeg)} ${assetTicker(swapInLeg)}`}</span>
            </>
          ) : event.swap_to_symbol !== null
            ? `${assetTicker(event)} → ${event.swap_to_symbol}`
            : event.bridge_dest_chain_id !== null
              ? `${hideBalances ? "•••••" : formatSignedTokenAmount(event)} ${assetTicker(event)}`
              : event.token_id !== null
                ? assetTicker(event)
                : `${hideBalances ? "•••••" : formatSignedTokenAmount(event)} ${assetTicker(event)}`}
        </span>
        {/* 체인은 시각적으로 코너 로고 배지로만 보이므로(체인 이름 텍스트 제거), 스크린리더에는
            체인명을 sr-only로 남겨 어느 체인의 자산인지 잃지 않게 한다. 브릿지는 출발·도착을 함께 읽어준다. */}
        <span className="sr-only">
          {event.bridge_dest_chain_id === null
            ? chainLabel(event.chain_id)
            : `${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`}
        </span>
      </div>
      {/* 오른쪽 칸은 방향과 무관하게 같은 뜻을 가진다.
          1줄: **거래 당시 평가액**(이벤트 통화 그대로). 수량 줄의 −/+는 지갑 기준 방향이고, 이 줄은 그 수량의 가치라
          부호·색 없이 중립으로 둔다. 가격 미확인이면 "-". 손익을 이 자리에 두면 "-563 USDC / -₩33,767"처럼
          방향 부호와 손익 부호가 한 행에 섞여 3만 원어치를 보냈다고 읽힌다(실제 가치는 77만 원).
          2줄: **실현 손익**(처분 행에만). 상세의 손익 근거표와 같은 판정 행(amountKind==="gain")을 합산하므로
          목록과 상세가 갈리지 않는다. 눈에 보이는 라벨을 붙여 1줄의 평가액과 뜻이 섞이지 않게 하고,
          상승은 receive(녹)·하락은 dispose(적) 토큰을 쓰되 색만으로 못 가르는 사용자를 위해 부호를 함께 둔다.
          판정이 아직 오지 않았으면(보류) 오른쪽을 비운다 — 손익 블록의 유무가 곧 정착 신호다.
          배지(판정 도장·미검증·확인 필요 등)는 목록이 아니라 거래 상세에서만 말한다. */}
      {isExcluded || isDuplicate || inPeriod !== null ? (
        <div data-surface="event-gain" className="flex shrink-0 flex-col items-end text-right">
          <span className="sr-only">거래 평가액 </span>
          {event.fiat_value !== null ? (
            <span className="text-[0.9375rem] font-bold tabular-nums text-zinc-900">
              {hideBalances ? "•••••" : formatFiat(event.fiat_value, event.fiat_currency)}
            </span>
          ) : (
            <span className="text-[0.9375rem] font-bold tabular-nums text-zinc-400">-</span>
          )}
          {gain !== null ? (
            hideBalances ? (
              <span className="mt-0.5 text-[0.8125rem] tabular-nums text-zinc-500">
                <span className="text-zinc-400">실현 손익 </span>•••••
              </span>
            ) : (
              <span className={`mt-0.5 text-[0.8125rem] font-semibold tabular-nums ${isPositive(gain) ? "text-receive" : isNegative(gain) ? "text-dispose" : "text-zinc-500"}`}>
                <span className="font-normal text-zinc-400">실현 손익 </span>
                {isPositive(gain) ? "+" : ""}{formatFiat(gain, currency)}
                {returnPercent !== null ? (
                  <span className="font-normal text-zinc-400"> (<span className="sr-only">수익률 </span>{isPositive(returnPercent) ? "+" : ""}{returnPercent}%)</span>
                ) : null}
              </span>
            )
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

/** `provenance`는 서버 페이지가 API 모드에서 계산해 준다 — 이 화면의 요약·목록 응답에는 출처가 실려 오지 않는다. */
export function DashboardView({ countryCode, provenance = "mock" }: { countryCode?: string; provenance?: Provenance }) {
  const queryClient = useQueryClient();
  // 불러오기 상태를 구독한다. 프로바이더가 없으면 "진행 중인 불러오기 없음"으로 읽히므로
  // 이 화면만 따로 렌더해도 그대로 돈다 — 원장은 불러오기와 독립적으로 존재하는 화면이다.
  // 마커를 언제 걷을지는 이 화면이 정하지 않는다. 원장을 **떠나는 순간**이 그 경계이고,
  // 그 사실은 컴포넌트 수명이 아니라 경로 변화에만 있어 트래커가 쥔다 —
  // effect 정리에 두면 StrictMode의 마운트 → 정리 → 마운트가 도착하자마자 마커를 지운다.
  const importTracker = useImportTracker();
  // 잔액 가리기. 서버는 저장소를 모르므로 첫 렌더는 항상 꺼짐이고, 마운트 후 저장값으로 복원한다.
  const [hideBalances, setHideBalances] = useHideBalances();
  const [tab, setTab] = useState<Tab>("all");
  const [group, setGroup] = useState<JudgmentGroup | "excluded" | null>(null);
  // 체인 필터. null = 전체. 목록에 없는 체인이 걸리면 아래에서 무시한다.
  const [chain, setChain] = useState<number | null>(null);
  // 지갑 필터. null = 전체. 지갑을 여럿 등록하면 한 목록에 섞여 "이 지갑에서 무슨 일이 있었나"를
  // 볼 방법이 없다. 체인·연도와 같은 성격의 **표시 필터**라 판정·요약 금액은 이 선택에 흔들리지 않는다.
  const [wallet, setWallet] = useState<string | null>(null);
  // 연도 필터. null = 전체. 체인 필터와 같은 성격의 **표시 필터**라 판정·요약은 건드리지 않는다
  // (연도가 계산 경계인 곳은 세금 탭이고, 여기서 고른 해는 목록만 좁힌다).
  const [year, setYear] = useState<number | null>(null);
  // 화면이 보고 있는 기간. 헤더 문구·그래프 창·목록 필터가 **이 하나**에서 나온다 —
  // 그래프만 따로 자르던 때는 "1개월"을 그려도 헤더는 전체 기간을 말했다.
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(DEFAULT_PERIOD);
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

  // ── 지갑 스코프 ──────────────────────────────────────────────────────────────
  // 지갑 선택은 목록만 거르는 필터가 아니라 **보는 대상**을 바꾼다. 그래서 다른 모든 파생값보다 앞에 둔다 —
  // 기간·그래프·건수·목록이 같은 거래 집합에서 나와야 한 화면이 한 이야기를 한다. 목록만 거르던 때는
  // "이 지갑"을 골라도 위의 누적 순유입 선과 기간은 전체 지갑을 그려 두 이야기가 겹쳤다.
  //
  // 세금 금액(아래 headline·estimate)은 이 스코프를 따르지 않는다. 한국처럼 거주자별 총평균법을 쓰는 나라는
  // 한 사람의 **모든** 지갑을 묶어 단가를 내므로, 지갑별로 쪼갠 값은 실제 신고값이 아니다 —
  // 지어내는 대신 무엇을 합산한 값인지 카드 아래에서 밝힌다.
  //
  // 선택지와 건수는 스코프를 걸기 **전** 원장에서 센다. 스코프 안에서 세면 하나를 고르는 순간 다른 지갑이
  // 목록에서 사라져 되돌아갈 문이 없어진다.
  const walletAddressOf = (record: EventRecord) => record.event.wallet_address.toLowerCase();
  const walletCounts = new Map<string, number>();
  for (const record of items) {
    const address = walletAddressOf(record);
    walletCounts.set(address, (walletCounts.get(address) ?? 0) + 1);
  }
  // 지갑이 하나뿐이면 고를 것이 없다 — 선택지 하나짜리 드롭다운은 자리만 차지한다(체인 칩과 같은 규칙).
  // 거래가 있는 지갑만 나온다: 등록만 하고 거래가 없는 지갑은 이벤트에 흔적이 없어 여기서 알 수 없다.
  const walletFilters = walletCounts.size > 1
    ? [...walletCounts.entries()].sort((left, right) => right[1] - left[1])
    : [];
  const walletTotal = items.length;
  // 원장에 없는 지갑이 선택에 남아 있으면 빈 화면만 보이고 사용자는 이유를 알 수 없다 — 그때는 놓는다.
  const activeWallet = wallet !== null && walletCounts.has(wallet) ? wallet : null;
  const scopedItems = activeWallet === null
    ? items
    : items.filter((record) => walletAddressOf(record) === activeWallet);

  // 프리셋("최근 1개월")은 벽시계가 아니라 **받아온 거래의 끝**을 기준으로 센다 —
  // 벽시계로 세면 오래된 지갑·데모에서 모든 버튼이 빈 기간을 가리킨다.
  // 기준은 스코프 안의 거래다: 2021년부터 쓴 지갑과 지난달 만든 지갑이 같은 "전체"를 말하면 안 된다.
  const periodWindow = resolvePeriod(periodSelection, dataBounds(scopedItems.map((item) => item.event.block_timestamp)));
  // 고르지 않았거나 기준이 없으면 좁힐 근거가 없다. 그때 화면은 예전처럼 전부를 보인다.
  const periodNarrowed = !isDefaultPeriod(periodSelection) && periodWindow !== null;
  // 레퍼런스 관례대로 최신이 위. 원본 배열은 건드리지 않는다 — 누적 그래프는 시간순으로 받아야 한다.
  // 페이지를 끝까지 이어 받은 뒤 정렬하므로 "최신"이 페이지 경계에 좌우되지는 않지만,
  // 목록이 잘렸을 때 이 순서가 전부는 아니라는 사실은 아래 잘림 고지가 말한다.
  const orderedItems = [...scopedItems].sort(
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
  // 고른 기간 밖의 거래는 목록에서도 빠진다 — 그래프만 좁아지고 목록이 그대로면
  // 한 화면이 두 기간을 동시에 말한다. 시각을 모르는 건은 어느 기간에도 놓을 수 없어
  // 연도 칩과 같은 규칙으로 빠진다(그 사실은 아래 기간 고지가 말한다).
  const pairedItems = annotated.filter(
    (item) =>
      item.isDuplicate ||
      (!swapPairing.pairedInIds.has(item.record.event.id) && !bridgePairing.pairedInIds.has(item.record.event.id)),
  );
  const listItems = pairedItems.filter(
    (item) => !periodNarrowed || inPeriodWindow(item.record.event.block_timestamp, periodWindow!),
  );
  // 기간을 좁히면 날짜를 모르는 건이 조용히 사라진다. 실제로 그런 건이 있을 때만 말한다 —
  // 없는 문제를 경고하면 화면이 늘 무언가 잘못된 것처럼 읽힌다.
  const undatedDropped = periodNarrowed
    ? pairedItems.filter((item) => isoDay(item.record.event.block_timestamp) === "").length
    : 0;
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
  const groupExistsInTab = group === null || tabItems.some((item) => groupsOf(item).has(group));
  const activeGroup = judgments.isError || judgmentsPending || !groupExistsInTab ? null : group;
  // 고른 체인이 이 탭에 없으면 필터를 유지할 근거가 없다.
  // 유지하면 빈 목록만 남고 사용자는 자기가 건 필터 때문인지 거래가 없는 건지 알 수 없다.
  const activeChain = chain !== null && tabItems.some((item) => matchesChain(item, chain)) ? chain : null;
  // 연도도 같은 규칙이다 — 고른 해가 이 탭에 없으면 놓는다.
  const activeYear = year !== null && tabItems.some((item) => matchesYear(item, year)) ? year : null;
  const displayedItems = tabItems.filter(
    (item) =>
      matchesChain(item, activeChain) &&
      matchesGroup(item, activeGroup) &&
      matchesYear(item, activeYear),
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
  for (const item of judgmentsPending || judgments.isError
    ? []
    : tabItems.filter((row) => matchesChain(row, activeChain) && matchesYear(row, activeYear))) {
    for (const key of groupsOf(item)) groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groups = [...groupCounts.entries()];
  // 체인·연도 칩은 판정과 무관하게 온체인 사실이라 판정 조회 상태와 관계없이 셀 수 있다.
  const chainCounts = new Map<number, number>();
  for (const item of tabItems.filter((row) => matchesGroup(row, activeGroup) && matchesYear(row, activeYear))) {
    const id = item.record.event.chain_id;
    chainCounts.set(id, (chainCounts.get(id) ?? 0) + 1);
  }
  // 체인이 하나뿐이면 고를 것이 없다 — 누를 수 없는 칩 한 줄은 자리만 차지한다.
  const chainFilters = chainCounts.size > 1 ? [...chainCounts.entries()].sort((left, right) => left[0] - right[0]) : [];
  const yearCounts = new Map<number, number>();
  for (const item of tabItems.filter((row) => matchesChain(row, activeChain) && matchesGroup(row, activeGroup))) {
    const value = yearOf(item);
    if (value !== null) yearCounts.set(value, (yearCounts.get(value) ?? 0) + 1);
  }
  // 연도가 하나뿐이면 고를 것이 없다(체인 필터와 같은 규칙). 목록은 최신순이라 칩도 최신 연도가 먼저다.
  const yearFilters = yearCounts.size > 1 ? [...yearCounts.entries()].sort((left, right) => right[0] - left[0]) : [];
  const estimate = judgments.estimate;
  // 헤드라인 손익·건수는 이제 요약(이벤트 직접 집계)이 아니라 **세금 화면과 같은 estimate**에서 파생한다.
  // 그래야 같은 귀속연도에서 대시보드·세금·내보내기가 한 숫자를 말한다(P1-5).
  // 판정을 다시 계산하는 중이면 옛 estimate로 손익을 단정하지 않는다 — 카드가 두 이야기를 하지 않도록 보류한다.
  const headline = judgmentsPending || estimate === undefined ? undefined : estimateHeadline(estimate);
  const headlineCurrency = estimate?.currency ?? summaryFresh.data?.currency ?? "KRW";
  // 신뢰도 칩(P1-9)도 같은 estimate에서 파생한다 — 세금 화면 "확인이 필요한 거래"과 같은 소스를 압축해 보인다.
  const confidence = headline === undefined || estimate === undefined ? undefined : estimateConfidence(estimate);
  // 지갑을 고르면 헤더 기간도 그 지갑 것이어야 한다 — 선은 좁아졌는데 기간만 전체를 말하면
  // 한 화면이 두 기간을 동시에 말한다. 고르지 않았을 때는 서버 요약의 기간을 그대로 쓴다:
  // 목록이 잘려도 전체 기간은 요약이 안다(목록에서 센 범위는 잘린 만큼 좁다).
  const headerPeriodLabel = (periodNarrowed || activeWallet !== null) && periodWindow !== null
    ? periodWindowLabel(periodWindow)
    : period !== undefined
      ? periodLabel(period)
      : "기간 미정";

  const selected = selectedKey
    ? annotated.find((item) => item.record.event.id === selectedKey.eventId && item.occurrence === selectedKey.occurrence) ?? null
    : null;

  const tabClass = (active: boolean) =>
    `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-semibold transition-colors ${
      active ? "border-primary-500 text-primary-600" : "border-transparent text-zinc-400"
    }`;

  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="dashboard-summary" className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">거래 요약</h1>
          {/* 빈 기간을 ` ~ `로 보이면 기간이 있는 것처럼 말하는 셈이다.
              고르기 전에는 요약이 말하는 기간을 그대로 보이고, 고른 뒤에는 **고른 기간**을 말한다. */}
          {period ? (
            <PeriodPicker
              label={headerPeriodLabel}
              selection={periodSelection}
              onSelect={setPeriodSelection}
            />
          ) : null}
          {periodNarrowed ? (
            <p className="mt-1 text-xs text-zinc-400">
              고른 기간의 거래 {listItems.length}건
              {undatedDropped > 0 ? ` · 날짜를 모르는 ${undatedDropped}건은 빠집니다` : null}
            </p>
          ) : activeWallet !== null ? (
            // 기간을 좁히지 않았어도 지갑을 골랐으면 위 기간·선·건수가 그 지갑 것임을 말해야 한다.
            <p className="mt-1 text-xs text-zinc-400">고른 지갑의 거래 {scopedItems.length}건</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ProvenanceChip provenance={provenance} />
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
      {/* 지갑 선택. 체인·연도 칩이 목록을 좁히는 **필터**라면, 이것은 화면 전체가 무엇을 보는지 바꾸는
          **스코프**다 — 그래서 목록 안이 아니라 그래프 위, 기간 바로 아래에 둔다. 여기서 고른 지갑은
          아래 누적 순유입 선·기간·건수·목록에 그대로 적용된다.
          드롭다운인 이유는 주소가 길어 칩으로 늘어놓으면 한 줄을 다 먹기 때문이다. */}
      {walletFilters.length > 0 ? (
        <div className="mt-4" data-surface="wallet-filter">
          <label className="text-xs font-medium text-zinc-500" htmlFor="dashboard-wallet-filter">
            지갑 선택하기
          </label>
          <select
            id="dashboard-wallet-filter"
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800"
            value={activeWallet ?? ""}
            onChange={(event) => setWallet(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">전체 지갑 · {walletTotal}건</option>
            {walletFilters.map(([address, count]) => (
              <option key={address} value={address}>
                {shortHash(address)} · {count}건
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* 이 화면은 지갑 이력이 그린 선까지만 말한다. 세금 금액·판정 기준·계산의 한계는
          세금 탭 한 곳에서만 답한다 — 두 화면이 각자 금액을 말하면 어느 쪽이 최신인지 알 수 없다. */}
      {/* 그래프의 기간 버튼은 자기 창만 바꾸지 않는다 — 헤더·목록이 함께 따라온다. */}
      <FlowChart
        events={scopedItems.map((item) => item.event)}
        state={eventsFresh.state}
        truncated={events.data?.truncated === true}
        hideBalances={hideBalances}
        selection={periodSelection}
        period={periodWindow}
        onSelect={setPeriodSelection}
      />

      <ExchangeLinkSummary />

      {/* 위 그래프는 화면이 고른 기간(기본: 데이터 전체)을 그리는데, 아래 두 값은 **귀속연도 하나**의 답이다.
          라벨 없이 나란히 두면 전체 기간 순유입과 그 해의 손익이 같은 자로 잰 숫자처럼 읽힌다
          (실데이터에서 14억 옆에 16만이 붙었다). 귀속연도와 그 과세기간을 값 위에 못 박는다.
          과세기간은 엔진이 준 `estimate.period`를 쓴다 — 영국 4/6~·호주 7/1~ 때문에 화면이 다시 계산하면 안 된다. */}
      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-900">{taxYear}년 귀속</h2>
        {estimate !== undefined && isGroundedPeriod(estimate.period) ? (
          <p className="shrink-0 text-xs text-zinc-400 tabular-nums">{halfOpenPeriodLabel(estimate.period)}</p>
        ) : null}
      </div>

      <section className="mt-2 grid gap-3">
        {/* 계산에 들어간 이벤트가 없으면 "0"은 손익이 아니라 계산할 것이 없었다는 뜻이다.
            손익은 세금 화면과 같은 estimate에서 파생한다 — 판정을 못 냈으면(headline 미정) 요약 상태를 그대로 말한다. */}
        <SummaryCard
          label="예상 손익"
          value={
            headline === undefined
              ? "-"
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
          value={headline !== undefined ? `${headline.computableEventCount}건` : "-"}
          supportingText={
            summaryFresh.data
              ? estimate !== undefined && estimate.status !== "UNDETERMINED"
                ? `확인 필요 항목 ${summaryFresh.data.pendingReviewCount}건 · 과세 여부는 아래 판정에서 갈립니다`
                : `확인 필요 항목 ${summaryFresh.data.pendingReviewCount}건 · 과세 여부는 아직 판단하지 않았습니다`
              : (freshNotice(summaryFresh.state, "요약") ?? undefined)
          }
          // 불러오는 중이면 이 숫자는 아직 새 지갑을 모른다. 말하지 않으면 사용자는 건수가 틀렸다고 읽는다.
          note={importTracker.state.status === "running" ? "새 지갑 거래는 불러온 뒤 반영돼요" : undefined}
        />
        {/* 위 두 값만 스코프를 따르지 않는다. 지갑별로 쪼갠 세금을 보여 주면 더 친절해 보이지만,
            한국처럼 거주자별 총평균법을 쓰는 나라는 한 사람의 모든 지갑을 묶어 단가를 내므로
            그 숫자는 신고값이 아니다. 지어내는 대신 무엇을 합산한 값인지 밝힌다.
            `estimate.method`를 문장에 끼우지 않는다 — 룰셋 라벨은 "원장 집계만 수행(시행 전)"처럼
            주어가 될 수 없는 문자열이라 끼우는 순간 비문이 된다. */}
        {activeWallet !== null ? (
          <p data-surface="tax-scope-note" className="text-xs leading-5 text-zinc-500">
            위 두 값은 고른 지갑이 아니라 <span className="font-semibold text-zinc-700">전체 지갑 합산</span>{" "}
            기준입니다. 거주국에 따라 취득가액을 지갑 전체로 묶어 산정하므로, 지갑 하나만 떼어낸 값은 그대로
            신고에 쓸 수 없습니다.
          </p>
        ) : null}
        {/* 신뢰도 칩(P1-9) — 세금 화면 "확인이 필요한 거래"과 같은 estimate에서 파생한 건수를 헤드라인 옆에 압축한다.
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

      <section className="mt-8">
        <div className="flex gap-1 border-b border-zinc-200" role="tablist" aria-label="거래 필터">
          <button role="tab" aria-selected={tab === "all"} type="button" className={tabClass(tab === "all")} onClick={() => setTab("all")}>
            전체 거래
            {/* 기간을 좁혔으면 배지도 그 기간의 수여야 한다 — "전체 거래 42"라 적고 5건을 보이면 둘 중 하나는 거짓이다. */}
            <span aria-hidden="true" className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-500">{periodNarrowed ? listItems.length : scopedItems.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "review"} type="button" className={tabClass(tab === "review")} onClick={() => setTab("review")}>
            확인 필요
            <span aria-hidden="true" className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${reviewItems.length > 0 ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{reviewItems.length}</span>
          </button>
        </div>
        {/* 두 배지 체계의 구분은 앱 안에서 한 곳이 말해야 한다 — 여기가 그 한 곳이다. */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-400">배지 뜻</summary>
          <div className="mt-2 space-y-1 text-sm text-zinc-600">
            <p>분류: 온체인에서 일어난 일(수신·송금·교환·내부 이동·미분류). 상세에서 직접 바꿀 수 있습니다.</p>
            <p>판정: 이 거래가 세금 계산에서 어떻게 쓰였는지(과세·취득·비과세·이연 등). 거주국 룰셋이 정하며 나라마다 다릅니다.</p>
            <p>앰버 배지: 확인이 필요한 문제. 정상 상태는 배지를 달지 않습니다.</p>
          </div>
        </details>
        {/* 원장에서 빠진 것들을 반드시 말한다. 조용히 빼면 목록이 완전한 것처럼 보이면서 거래가 사라진다.
            스팸은 숨긴 것(되돌릴 수 있음)이고, 형식 오류는 서버 응답이 계약을 벗어나 읽지 못한 것이다 —
            원인이 다르므로 한 문장으로 뭉개지 않는다. */}
        {(events.data?.spam ?? 0) > 0 || (events.data?.dropped ?? 0) > 0 ? (
          <p data-surface="ledger-omissions" className="mt-3 text-xs text-zinc-500">
            {(events.data?.spam ?? 0) > 0 ? `스팸으로 분류된 ${events.data!.spam}건은 목록·계산에서 빼고 있습니다.` : null}
            {(events.data?.dropped ?? 0) > 0
              ? `${(events.data?.spam ?? 0) > 0 ? " " : ""}형식이 맞지 않아 읽지 못한 ${events.data!.dropped}건이 있습니다.`
              : null}
          </p>
        ) : null}
        {/* 연도 필터. 목록 자체는 늘 최신순이고, 연도는 정렬이 아니라 **경계**다 —
            "2025년에 무슨 일이 있었나"를 보려면 그 해만 남길 문이 있어야 한다.
            체인 필터와 같은 표시 필터라 판정·요약 금액은 이 선택에 흔들리지 않는다. */}
        {yearFilters.length > 0 ? (
          <ChipScroller className="mt-3" aria-label="연도 필터">
            <button
              type="button"
              aria-pressed={activeYear === null}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeYear === null ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
              onClick={() => setYear(null)}
            >
              전체 연도
            </button>
            {yearFilters.map(([value, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeYear === value}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeYear === value ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
                // 누른 칩을 다시 누르면 풀린다. 필터가 겹쳐 걸리는 이상 되돌릴 문이 칩 자체에 있어야 한다.
                onClick={() => setYear(year === value ? null : value)}
              >
                {value}년 <span aria-hidden="true">{count}</span>
              </button>
            ))}
          </ChipScroller>
        ) : null}
        {/* 체인 필터. 여러 체인을 한 목록에 섞어 두면 "이 체인에서 무슨 일이 있었나"를 볼 방법이 없다.
            판정 필터와 독립이라 둘을 겹쳐 걸 수 있고, 각 칩의 건수는 상대 필터를 적용한 뒤의 수다. */}
        {chainFilters.length > 0 ? (
          <ChipScroller className="mt-3" aria-label="체인 필터">
            <button
              type="button"
              aria-pressed={activeChain === null}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeChain === null ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
              onClick={() => setChain(null)}
            >
              전체 체인
            </button>
            {chainFilters.map(([chainId, count]) => (
              <button
                key={chainId}
                type="button"
                aria-pressed={activeChain === chainId}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${activeChain === chainId ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
                // 누른 칩을 다시 누르면 풀린다. 두 필터가 겹쳐 걸리는 이상 되돌릴 문이 칩 자체에 있어야 한다.
                onClick={() => setChain(chain === chainId ? null : chainId)}
              >
                <ChainIcon chainId={chainId} />
                {chainLabel(chainId)} <span aria-hidden="true">{count}</span>
              </button>
            ))}
          </ChipScroller>
        ) : null}
        {!judgments.isLoading && groups.length > 0 ? (
          <ChipScroller className="mt-3" aria-label="판정 필터">
            <button type="button" aria-pressed={activeGroup === null} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeGroup === null ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`} onClick={() => setGroup(null)}>
              전체
            </button>
            {groups.map(([item, count]) => (
              <button key={item} type="button" aria-pressed={activeGroup === item} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeGroup === item ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`} onClick={() => setGroup(group === item ? null : item)}>
                {GROUP_SHORT_LABEL[item]} <span aria-hidden="true">{count}</span>
              </button>
            ))}
          </ChipScroller>
        ) : null}
        {tab === "review" ? (
          <div className="mt-3 text-sm text-zinc-500">
            <p>계산에서 빠졌거나 확인이 필요한 거래만 모았습니다.</p>
            {/* 정직성 문장은 삭제가 아니라 강등이다 — 왜 가격·신뢰도가 다르게 취급되는지는 접어서 보존한다. */}
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-zinc-600 marker:text-zinc-400">어떤 기준인가</summary>
              <p className="mt-1">가격·분류·수량을 확정하지 못한 건은 계산에서 빠집니다. 신뢰도만 낮은 건은 계산 대상 분류라면 그대로 들어갑니다(자기 지갑 간 이체는 애초에 처분이 아닙니다).</p>
            </details>
          </div>
        ) : null}
        {/* 잘림·갱신 배너는 둘 다 앰버·회색으로 목록 위를 겹겹이 덮었다. 실패 문구와 "더 불러오기"는
            내용이지 부피가 아니므로 지우지 않고, 저채도 한 줄 노트로 부피만 강등한다. */}
        {events.data?.truncated || (eventsStale && events.data) ? (
          <p role="status" className="mt-3 border-l-2 border-zinc-200 pl-2 text-xs text-zinc-400">
            {eventsStale && events.data
              ? (eventsFresh.state === "error"
                  ? "갱신하지 못했습니다. 마지막으로 받은 상태 표시"
                  : "갱신 중. 마지막으로 받은 상태 표시")
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
        <div className="mt-3 grid gap-3">
          {events.isLoading ? <p className="text-sm text-zinc-500">거래를 불러오는 중입니다</p> : null}
          {events.isError ? (
            <p role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              거래를 불러오지 못했습니다.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void events.refetch()}>다시 시도</button>
            </p>
          ) : null}
          {!events.isLoading && !events.isError && displayedItems.length === 0 ? (
            <p className="text-sm text-zinc-500">{tab === "review" ? "확인이 필요한 거래가 없습니다." : "표시할 거래가 없습니다."}</p>
          ) : null}
          {displayedItems.map(({ record, occurrence, isDuplicate }, index) => {
            // 날짜는 UTC 하루 단위로 한 번만 찍는다. 모든 줄에 같은 날짜를 반복하면
            // 정작 읽어야 할 "그날 무슨 일이 있었나"가 안 보인다.
            const day = isoDay(record.event.block_timestamp);
            const previousDay =
              index > 0 ? isoDay(displayedItems[index - 1].record.event.block_timestamp) : null;
            return (
              <Fragment key={`${record.event.id}#${occurrence}`}>
                {day === previousDay ? null : (
                  <h3 className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-500 first:mt-0">
                    <span>{day ? formatDate(record.event.block_timestamp) : "날짜 미상"}</span>
                    {/* 방금 들어온 거래가 어느 날짜에 꽂혔는지 말한다. 없으면 배지도 없다 — 없는 사실을 만들지 않는다. */}
                    {(newEventCountByDay.get(day ?? "") ?? 0) > 0 ? (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold text-primary-600">
                        새로 들어온 거래 {newEventCountByDay.get(day ?? "")}
                      </span>
                    ) : null}
                  </h3>
                )}
                <EventRow
                  isFirstNew={record.event.id === firstNewEventId}
                  record={record}
                  onSelect={() => setSelectedKey({ eventId: record.event.id, occurrence })}
                  rows={isDuplicate || judgmentsPending ? [] : judgments.rowsOf(record.event.id)}
                  currency={estimate?.currency ?? "KRW"}
                  isExcluded={!judgmentsPending && judgments.excluded.has(record.event.id)}
                  inPeriod={judgmentsPending ? null : judgments.inPeriod(record.event.block_timestamp)}
                  isDuplicate={isDuplicate}
                  hideBalances={hideBalances}
                  swapInLeg={isDuplicate ? null : swapPairing.inLegByOutId.get(record.event.id) ?? bridgeSwapInLegFor(record.event)}
                />
              </Fragment>
            );
          })}
        </div>
        {/* 시간대는 화면 전체가 한 번만 약속한다. 줄마다 "UTC"를 붙이면 읽히지 않고,
            아예 안 밝히면 사용자가 자기 시간대로 읽어 과세연도 경계에서 다른 날로 이해한다. */}
        <p className="mt-3 text-xs text-zinc-400">{UTC_NOTICE}</p>
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
          swapInLeg={selected.isDuplicate ? null : swapPairing.inLegByOutId.get(selected.record.event.id) ?? bridgeSwapInLegFor(selected.record.event)}
        />
      ) : null}
    </main>
  );
}
