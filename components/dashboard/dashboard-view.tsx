"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CLASSIFICATION_LABEL, ClassificationBadge } from "@/components/ui/classification-badge";
import { isGroundedPeriod, periodLabel } from "@/lib/period";
import { fresh, freshNotice, type FreshState } from "@/lib/queries/fresh";
import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { SummaryCard } from "@/components/ui/summary-card";
import { assetLabel, chainLabel, formatDate, formatFiat, formatFiatExact, formatTokenAmount, shortHash } from "@/lib/format";
import { eventSummaryQueryKey, useEventDetail, useEventList, useEventSummary, useReclassify } from "@/lib/queries/events";
import { useTaxEstimate } from "@/lib/queries/tax";
import { useJudgments } from "@/lib/queries/judgments";
import { effectiveClassification, needsReview, reviewReason } from "@/lib/review";
import { isNegative, isZero } from "@/lib/tax/decimal";
import { taxYearFor } from "@/lib/tax/engine";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentGroup, JudgmentRow, TaxEstimate } from "@/lib/tax/types";

type EventRecord = { event: NormalizedEvent; version: number };
/** 목록 순서로 계산한 중복 마커. 객체 동일성 대신 이 값을 화면 전체가 공유한다. */
type AnnotatedRecord = { record: EventRecord; occurrence: number; isDuplicate: boolean };
type Tab = "all" | "review";

const classifications: Classification[] = ["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"];

const DIRECTION_LABEL: Record<NormalizedEvent["direction"], string> = { IN: "받음", OUT: "보냄" };

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
    <section className="mt-4 rounded-lg bg-zinc-50 p-3">
      <h3 className="text-sm font-semibold text-zinc-700">다른 나라였다면</h3>
      <div className="mt-2 space-y-2">
        {renderRows(firstFresh.data, firstRows, firstCountry, firstFresh.state)}
        {renderRows(secondFresh.data, secondRows, secondCountry, secondFresh.state)}
      </div>
    </section>
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
}: {
  record: EventRecord;
  onClose: () => void;
  judgmentRows?: JudgmentRow[];
  isExcluded?: boolean;
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
    // 산출 불가 룰셋(한국 등)은 부담 자체를 계산하지 않는다. 그 0을 차분해 "영향 없음"이라 하면 거짓이다.
    // 중복 레코드도 id로 키가 잡히는 결과를 물려받으면 안 된다.
    (taxYearGrounded ?? true) && estimate !== undefined && estimate.status !== "UNDETERMINED" && !isDuplicate,
  );
  const gainRows = (judgmentRows ?? []).filter((row) => row.amountKind === "gain");
  const marginalFresh = fresh(
    marginalEstimate,
    taxYearGrounded === false || estimate === undefined || estimate.status === "UNDETERMINED" || isDuplicate === true,
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
        <p className="text-2xl font-bold tracking-tight text-zinc-900">
          {formatTokenAmount(event.raw_amount, event.decimals)} <span className="text-base font-semibold text-zinc-500">{assetLabel(event)}</span>
        </p>
        <ClassificationBadge classification={effectiveClassification(event)} />
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {formatDate(event.block_timestamp)} · {event.price_status === "UNKNOWN" ? "가격 미확인" : formatFiat(event.fiat_value, event.fiat_currency)}
        {event.price_status === "ESTIMATED" ? " (추정)" : ""}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-zinc-500">트랜잭션</dt><dd className="mt-1 font-mono text-xs font-medium text-zinc-900">{shortHash(event.tx_hash)}</dd></div>
        <div><dt className="text-zinc-500">체인</dt><dd className="mt-1 font-medium text-zinc-900">{chainLabel(event.chain_id)}</dd></div>
        <div><dt className="text-zinc-500">방향</dt><dd className="mt-1 font-medium text-zinc-900">{DIRECTION_LABEL[event.direction]}</dd></div>
        <div><dt className="text-zinc-500">자산 타입</dt><dd className="mt-1 font-medium text-zinc-900">{event.asset_type}</dd></div>
        <div><dt className="text-zinc-500">신뢰도</dt><dd className="mt-1 font-medium text-zinc-900">{Math.round(event.confidence * 100)}%</dd></div>
        <div><dt className="text-zinc-500">이력</dt><dd className="mt-1 font-medium text-zinc-900">{event.user_override ? `사용자 확정 · ${formatDate(event.user_override.overridden_at)}` : "자동 분류"}</dd></div>
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
                        "—"만 두면 기록이 없는 것과 구분되지 않는다. */}
                    <dd className="mt-1 font-medium text-zinc-900">
                      {row.holdingDays !== null
                        ? `${row.holdingDays}일`
                        : row.lots > 1
                          ? "취득분마다 다름"
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">취득일</dt>
                    <dd className="mt-1 font-medium text-zinc-900">
                      {row.acquiredAt ? formatDate(row.acquiredAt) : row.lots > 1 ? "취득분마다 다름" : "—"}
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
        </section>
      ) : isExcluded ? (
        <section className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          가격·분류·수량을 확정하지 못해 계산에 들어가지 않았습니다.
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
                <p className="mt-1 text-zinc-500">{row.basis}</p>
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
        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-700">이 거래가 없었다면</h3>
          <p className="mt-2 text-sm text-zinc-700">
            {isZero(marginalContribution)
              ? "총액이 그대로입니다 — 부담에 영향 없음"
              : isNegative(marginalContribution)
                ? <>이 거래를 지우면 부담이 늘어납니다 — 취득원가가 사라지기 때문입니다 · {formatFiat(marginalContribution, currency)}</>
                : formatFiat(marginalContribution, currency)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">부담을 건별로 나눠 넣을 수 없어, 이 거래를 뺀 경우의 차이를 보입니다.</p>
        </section>
      ) : null}
      {/* 중복 레코드는 자기 판정이 없다. 나라별 비교도 id로 잡히므로 첫 건의 결과를 물려받으면 안 된다. */}
      {isDuplicate ? null : (
        <OtherCountryJudgments eventId={event.id} countryCode={resolvedCountryCode} taxYear={resolvedTaxYear} grounded={taxYearGrounded ?? true} />
      )}
      {history.length > 0 ? (
        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-700">재분류 이력</h3>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
            {history.map((entry, index) => (
              <li key={`${entry.overridden_at}-${index}`}>
                {formatDate(entry.overridden_at)} · {entry.from} → {entry.to}
                {entry.reason ? ` · ${entry.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="mt-6 border-t border-zinc-200 pt-5">
        <h3 className="font-bold text-zinc-900">재분류</h3>
        <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="classification">분류</label>
        <select id="classification" className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5" value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
          {classifications.map((item) => <option key={item} value={item}>{CLASSIFICATION_LABEL[item]}</option>)}
        </select>
        <label className="mt-3 block text-sm font-medium text-zinc-700" htmlFor="reason">사유 (선택)</label>
        <input id="reason" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5" placeholder="예: 본인 지갑 간 이동" value={reason} onChange={(event) => setReason(event.target.value)} />
        <button type="button" className="mt-4 w-full rounded-lg bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={reclassify.isPending} onClick={apply}>적용</button>
      </section>
    </BottomSheet>
  );
}

function EventRow({
  record,
  onSelect,
  rows,
  isExcluded,
  inPeriod,
  judgmentError,
  judgmentDisabled,
  isDuplicate,
  estimate,
}: {
  record: EventRecord;
  onSelect: () => void;
  rows: JudgmentRow[];
  isExcluded: boolean;
  inPeriod: boolean | null;
  judgmentError?: boolean;
  /** 기준 기간이 없어 판정을 아예 계산하지 않은 상태. "확인 중"과 구분해야 한다. */
  judgmentDisabled?: boolean;
  isDuplicate: boolean;
  estimate: TaxEstimate | undefined;
}) {
  const { event } = record;
  // `이동 · 처분 아님`은 분류가 아니라 **판정** 주장이다. 판정이 보류면 이것도 단정하지 않는다.
  const isInternalTransfer =
    inPeriod !== null && effectiveClassification(event) === "INTERNAL_TRANSFER" && rows.length === 0;

  return (
    <button type="button" className="rounded-card border border-zinc-200 bg-white p-4 text-left shadow-card active:bg-zinc-50" onClick={onSelect}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-900">
            {formatTokenAmount(event.raw_amount, event.decimals)} · {assetLabel(event)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{formatDate(event.block_timestamp)} · {chainLabel(event.chain_id)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ClassificationBadge classification={effectiveClassification(event)} />
          {event.price_status === "UNKNOWN"
            ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">가격 확인 필요</span>
            : (
              <span className="flex flex-col items-end">
                <span className="text-xs font-medium text-zinc-500">거래액</span>
                <span className="text-sm font-medium text-zinc-700">{formatFiat(event.fiat_value, event.fiat_currency)}</span>
              </span>
            )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {needsReview(event) && event.price_status !== "UNKNOWN"
            ? <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{reviewReason(event)}</span>
            : null}
          {event.price_status === "ESTIMATED" ? <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-600">추정가</span> : null}
          {event.user_override ? <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-800">수동 분류됨</span> : null}
          {isDuplicate
            ? <JudgmentBadge group="excluded" label="중복 id · 확인 필요" />
            : isExcluded
              ? <JudgmentBadge group="excluded" label="계산 제외 · 확인 필요" />
              : isInternalTransfer
                ? <JudgmentBadge group="deferred" label="이동 · 처분 아님" />
                : rows.length > 0
                  ? rows.map((row, index) => <JudgmentBadge key={`${row.eventId}-${row.leg}-${index}`} group={row.group} label={row.label} />)
                  : inPeriod === false
                    ? <JudgmentBadge group="deferred" label="기간 밖 · 이번 계산에 없음" />
                    : inPeriod === null
                      // estimate가 아직 없다. "결과 없음"이라 단정하면 로딩·오류 중에 거짓이 된다.
                      ? <JudgmentBadge
                          group="pending"
                          label={
                            judgmentDisabled
                              ? "판정 미계산 · 기준 기간 확인 필요"
                              : judgmentError
                                ? "판정 불러오기 실패"
                                : "판정 확인 중"
                          }
                        />
                      : <JudgmentBadge group="excluded" label="계산 결과 없음 · 확인 필요" />}
      </div>
      {estimate ? rows.map((row, index) => (
        <p key={`${row.eventId}-${row.leg}-${index}`} className="mt-2 text-sm text-zinc-600">
          {AMOUNT_KIND_LABEL[row.amountKind]} · {Number(row.amount) === 0 ? "원가 없음" : formatFiat(row.amount, estimate.currency)}
          {row.inPeriod ? "" : " · 기간 밖(원가 추적용)"}
          {row.holdingDays !== null ? ` · 보유 ${row.holdingDays}일` : row.lots > 1 ? " · 보유기간 취득분마다 다름" : ""}
          {row.acquiredAt ? ` · ${formatDate(row.acquiredAt)} 취득` : ""}
          {row.lots > 1 ? ` · 취득분 ${row.lots}건` : ""}
        </p>
      )) : null}
    </button>
  );
}

export function DashboardView({ countryCode }: { countryCode?: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [group, setGroup] = useState<JudgmentGroup | "excluded" | null>(null);
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
  const referencePeriod = isGroundedPeriod(summaryFresh.data?.period)
    ? summaryFresh.data!.period.from
    : null;
  const taxYear = taxYearFor(countryCode ?? "KR", referencePeriod ?? new Date().toISOString());
  const judgments = useJudgments(countryCode ?? "KR", taxYear, referencePeriod !== null);
  const items = events.data?.items ?? [];
  // 같은 id가 두 번 이상 나오면 두 번째부터는 판정을 붙일 수 없다 — 확인 필요로 올린다.
  // 중복 판정은 **원본 목록 순서**로 한 번만 계산하고 마커를 레코드에 붙인다.
  // 객체 동일성(Set<EventRecord>)으로 들고 있으면 목록을 다시 불러온 순간 마커가 사라져
  // 두 번째 중복이 첫 건의 판정을 물려받는다.
  const seenCounts = new Map<string, number>();
  const annotated: AnnotatedRecord[] = items.map((record) => {
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

  const reviewItems = annotated.filter((item) => needsReview(item.record.event) || item.isDuplicate);
  const tabItems = tab === "review" ? reviewItems : annotated;
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
  const groupExistsInTab = group === null || tabItems.some((item) => groupsOf(item).has(group));
  const activeGroup = judgments.isError || judgmentsPending || !groupExistsInTab ? null : group;
  const displayedItems = activeGroup ? tabItems.filter((item) => groupsOf(item).has(activeGroup)) : tabItems;
  // 칩 건수는 **지금 탭에서 실제로 필터가 남길 카드 수**여야 한다.
  // 전체 목록 기준으로 세면 확인 필요 탭에서 칩 건수와 카드 수가 어긋난다.
  const groupCounts = new Map<JudgmentGroup | "excluded", number>();
  // 판정을 다시 계산하는 중이면 칩도 보류한다.
  // 카드가 "판정 확인 중"인데 칩이 "취득 10"이라 하면 화면이 두 이야기를 한다.
  for (const item of judgmentsPending || judgments.isError ? [] : tabItems) {
    for (const key of groupsOf(item)) groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groups = [...groupCounts.entries()];
  const estimate = judgments.estimate;
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
          {/* 빈 기간을 ` ~ `로 보이면 기간이 있는 것처럼 말하는 셈이다. */}
          {period ? <p className="mt-1 text-sm text-zinc-500">{periodLabel(period)}</p> : null}
        </div>
        <MockProvenanceChip />
      </header>
      <section className="mt-4 rounded-card border border-zinc-200 bg-white px-4 py-3 shadow-card" aria-label="판정 기준">
        {/* 우선순위는 모든 표면에서 같다: disabled → error → pending → ready.
            기준 기간이 없으면 애초에 요청하지 않았으므로 옛 오류를 현재 상태로 말하면 안 된다. */}
        {referencePeriod === null ? (
          <p className="text-sm text-zinc-500">기준 기간을 확인하지 못해 판정을 계산하지 않았습니다.</p>
        ) : judgments.isError ? (
          <p role="alert" className="text-sm text-zinc-500">
            판정 기준을 불러오지 못했습니다.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void judgments.refetch()}>다시 시도</button>
          </p>
        ) : judgmentsPending || !estimate ? (
          // 재조회 중이면 옛 총액을 최신인 척 보이지 않는다.
          <p className="text-sm text-zinc-500">판정 기준을 불러오는 중입니다.</p>
        ) : (
          <>
            <p className="text-xs font-medium text-zinc-500">{estimate.countryLabel} 룰셋으로 판정 중</p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-900">{estimate.taxYear}년 세금</p>
              {/* 세금 금액은 화면에서 이 한 줄에만 존재한다. 거래 행에는 판정 도장만 찍는다. */}
              <p className="text-lg font-bold text-zinc-900">
                {estimate.status === "UNDETERMINED"
                  ? "산출 불가"
                  : Number(estimate.totals.estimatedCharge) === 0
                    ? "부담 없음"
                    : formatFiat(estimate.totals.estimatedCharge, estimate.currency)}
              </p>
            </div>
            {estimate.status === "UNDETERMINED" ? (
              <p className="mt-1 text-xs text-zinc-500">과세 방식·시행 시기가 확정되지 않아 부담을 추정하지 않습니다.</p>
            ) : null}
            {/* 금액을 보여주는 곳이면 그 금액의 한계도 같은 자리에서 말해야 한다.
                세금 탭에만 두면 대시보드만 보는 사용자는 근사인 줄 모른다. */}
            {estimate.limitations.length > 0 ? (
              <div className="mt-2 border-t border-zinc-100 pt-2">
                <p className="text-xs font-medium text-zinc-500">이 금액이 흔들리는 지점 {estimate.limitations.length}건</p>
                <ul className="mt-1 grid gap-1">
                  {estimate.limitations.slice(0, 2).map((limitation, index) => (
                    <li key={`${limitation.kind}-${index}`} className="text-xs leading-5 text-zinc-600">
                      {limitation.message}
                    </li>
                  ))}
                </ul>
                <Link href="/tax" className="mt-1 inline-flex text-xs font-semibold text-primary-600 underline">
                  전부 보기
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="mt-6 grid gap-3">
        {/* 계산에 들어간 이벤트가 없으면 "0"은 손익이 아니라 계산할 것이 없었다는 뜻이다. */}
        <SummaryCard
          label="예상 손익"
          value={
            !summaryFresh.data
              ? "—"
              : summaryFresh.data.computableEventCount === 0
                ? "계산할 거래 없음"
                : formatFiat(summaryFresh.data.periodPnl, summaryFresh.data.currency)
          }
          supportingText={
            summaryFresh.data && summaryFresh.data.computableEventCount === 0
              ? "가격·분류를 확정한 거래가 아직 없습니다."
              : undefined
          }
        />
        {/* 이 건수는 가격·분류만 보고 센다. 룰셋이 미확정인 나라에서는 "과세 대상"이라 단정할 수 없다. */}
        <SummaryCard
          // 이 건수는 가격·분류가 확정돼 **계산에 들어간** 이벤트 수다.
          // 실제 과세 여부는 판정 그룹(취득·비과세·상계 소멸…)이 정하므로 "과세 대상"이라 부르면 과장이다.
          label="계산 대상 이벤트"
          value={summaryFresh.data ? `${summaryFresh.data.taxableEventCount}건` : "—"}
          supportingText={
            summaryFresh.data
              ? estimate !== undefined && estimate.status !== "UNDETERMINED"
                ? `확인 필요 항목 ${summaryFresh.data.pendingReviewCount}건 · 과세 여부는 아래 판정에서 갈립니다`
                : `확인 필요 항목 ${summaryFresh.data.pendingReviewCount}건 · 과세 여부는 아직 판단하지 않았습니다`
              : (freshNotice(summaryFresh.state, "요약") ?? undefined)
          }
        />
      </section>

      <section className="mt-8">
        <div className="flex gap-1 border-b border-zinc-200" role="tablist" aria-label="거래 필터">
          <button role="tab" aria-selected={tab === "all"} type="button" className={tabClass(tab === "all")} onClick={() => setTab("all")}>
            전체 거래
            <span aria-hidden="true" className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-500">{items.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "review"} type="button" className={tabClass(tab === "review")} onClick={() => setTab("review")}>
            확인 필요
            <span aria-hidden="true" className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${reviewItems.length > 0 ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{reviewItems.length}</span>
          </button>
        </div>
        {!judgments.isLoading && groups.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="판정 필터">
            <button type="button" aria-pressed={activeGroup === null} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeGroup === null ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`} onClick={() => setGroup(null)}>
              전체
            </button>
            {groups.map(([item, count]) => (
              <button key={item} type="button" aria-pressed={activeGroup === item} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${activeGroup === item ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-600"}`} onClick={() => setGroup(item)}>
                {GROUP_SHORT_LABEL[item]} <span aria-hidden="true">{count}</span>
              </button>
            ))}
          </div>
        ) : null}
        {tab === "review" ? (
          <p className="mt-3 text-sm text-zinc-500">확인이 필요한 거래입니다. 가격·분류·수량을 확정하지 못한 건은 계산에서 빠집니다. 신뢰도만 낮은 건은 계산 대상 분류라면 그대로 들어갑니다(자기 지갑 간 이체는 애초에 처분이 아닙니다).</p>
        ) : null}
        {events.data?.truncated ? (
          <p role="status" className="mt-3 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            거래가 너무 많아 일부만 불러왔습니다. 아래 목록과 그룹 건수는 전체가 아닙니다.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setMaxPages((pages) => pages + 50)}>더 불러오기</button>
          </p>
        ) : null}
        {eventsStale && events.data ? (
          <p role="status" className="mt-3 rounded-card border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            {eventsFresh.state === "error"
              ? "목록을 갱신하지 못했습니다. 아래 내용은 마지막으로 받은 상태입니다."
              : "목록을 갱신하는 중입니다. 아래 내용은 마지막으로 받은 상태입니다."}
          </p>
        ) : null}
        {judgments.isError ? (
          <p role="status" className="mt-3 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            세금 판정을 불러오지 못해 각 거래의 도장을 확정하지 못했습니다. 아래 목록의 확인 필요 항목은 거래 자체의 문제만 반영합니다.
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
          {displayedItems.map(({ record, occurrence, isDuplicate }) => {
            return (
                <EventRow
                  key={`${record.event.id}#${occurrence}`}
                  record={record}
                  onSelect={() => setSelectedKey({ eventId: record.event.id, occurrence })}
                  rows={isDuplicate || judgmentsPending ? [] : judgments.rowsOf(record.event.id)}
                  isExcluded={!judgmentsPending && judgments.excluded.has(record.event.id)}
                  inPeriod={judgmentsPending ? null : judgments.inPeriod(record.event.block_timestamp)}
                  judgmentError={judgments.isError}
                  judgmentDisabled={referencePeriod === null}
                  isDuplicate={isDuplicate}
                  estimate={estimate}
                />
            );
          })}
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
        />
      ) : null}
    </main>
  );
}
