"use client";

import { useState } from "react";
import { OtherCountryJudgments } from "@/components/transactions/other-country-judgments";
import { ValueOverrideEditor } from "@/components/transactions/value-override-editor";
import { AssetLogo, SplitAssetLogo } from "@/components/ui/asset-logo";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ChainIcon } from "@/components/ui/chain-icon";
import { CLASSIFICATION_LABEL, ClassificationBadge } from "@/components/ui/classification-badge";
import { INCOME_KIND_LABEL } from "@/components/ui/income-kind-badge";
import { AMOUNT_KIND_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { counterpartyLabel, knownContractName } from "@/lib/contracts";
import { assetLabel, assetTicker, chainLabel, explorerTxUrl, formatDate, formatDateTime, formatFiat, formatFiatExact, formatSignedTokenAmount, formatTokenAmount, nativeSymbol, shortHash } from "@/lib/format";
import { periodLabel } from "@/lib/period";
import { fresh } from "@/lib/queries/fresh";
import { useEventDetail, useReclassify } from "@/lib/queries/events";
import { useTaxEstimate } from "@/lib/queries/tax";
import { assetFlow, effectiveClassification, needsReview, reviewReason } from "@/lib/review";
import type { AssetFlow } from "@/lib/review";
import { isNegative, isZero } from "@/lib/tax/decimal";
import { omitsCharge } from "@/lib/tax/status";
import type { EventRecord } from "@/lib/transactions/types";
import type { Classification, NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentRow, TaxEstimate } from "@/lib/tax/types";

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

export function EventDetails({
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
          <h3 className="text-sm font-semibold text-zinc-700">스왑 구성 — 한 거래, 두 다리</h3>
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-zinc-700">
              <span className="font-semibold text-rose-700">내보낸 자산</span> {formatSignedTokenAmount(event)} {assetTicker(event)}
              <span className="text-zinc-500"> — 손익은 아래 근거표가 말합니다.</span>
            </p>
            <div className="rounded-lg bg-white p-3">
              <p className="font-semibold text-emerald-700">받은 자산 {formatSignedTokenAmount(swapInLeg)} {assetTicker(swapInLeg)}</p>
              <p className="mt-1 text-zinc-700">취득가액 · {formatFiat(swapInLeg.fiat_value, swapInLeg.fiat_currency)}</p>
              {/* 받은 다리가 목록·대표 배지에서 빠지므로, 이 다리의 확인 필요(가격 미확정 등)는
                  취득원가를 고치는 바로 이 자리에서 밝힌다 — 안 그러면 취득원가를 바로잡을 길이 없다. */}
              {needsReview(swapInLeg) ? (
                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">확인 필요 · {reviewReason(swapInLeg)}</p>
              ) : null}
              <p className="mt-1 text-zinc-500">지금 내는 세금이 아닙니다 — 이 자산을 나중에 팔 때의 원가가 됩니다(손익 이연).</p>
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
          <dd className="mt-1 font-medium text-zinc-900">
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
        <details className="mt-4 rounded-lg bg-zinc-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-700 marker:text-zinc-400">이 거래가 없었다면</summary>
          <p className="mt-2 text-sm text-zinc-700">
            {isZero(marginalContribution)
              ? "총액이 그대로입니다 — 부담에 영향 없음"
              : isNegative(marginalContribution)
                ? <>이 거래를 지우면 부담이 늘어납니다 — 취득원가가 사라지기 때문입니다 · {formatFiat(marginalContribution, currency)}</>
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
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
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
