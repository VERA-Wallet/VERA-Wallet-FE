import { ZERO, add, div, gt, isPositive, round, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { formatKstDateTime, formatTokenAmount } from "@/lib/format";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { LimitationKind, TaxEstimate } from "@/lib/tax/types";
import { estimateConfidence } from "@/lib/tax/estimate-summary";

/**
 * 리포트 빌더 — 온체인 로그 덤프를 "신고를 채우고 방어하는 근거자료"로 바꾼다.
 *
 * 값은 **estimate에서만** 읽는다. 여기서 룰셋 조건을 다시 쓰면 화면·계산·리포트가 서로 다른 답을 말한다.
 * 각 빌더는 순수 함수이며 `Record<string, string | number>[]`(한 시트의 행)과 열 순서를 함께 낸다 —
 * xlsx `json_to_sheet(rows, { header })`와 CSV가 같은 정의를 공유한다.
 */

export type ReportRow = Record<string, string | number>;

/** 금액을 스프레드시트가 합산할 수 있는 숫자로. 원장·estimate가 이미 반올림했으므로 표시 반올림만 한다. */
function num(value: Decimal): number {
  return Number(round(value, 2));
}

/** estimate.lines에서 키로 금액을 읽는다. 없으면 0 — 국가가 그 줄을 내지 않았다는 뜻이다. */
function lineAmount(estimate: TaxEstimate, key: string): Decimal {
  return estimate.lines.find((line) => line.key === key)?.amount ?? ZERO;
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

// ─────────────────────────────────────────────────────────────────────────────
// P2-A 신고 요약서 (별지 제40호서식(6) 기입란 1:1)
// ─────────────────────────────────────────────────────────────────────────────

export const FILING_SUMMARY_COLUMNS = ["기입란", "금액", "근거"] as const;

const CONFIDENCE_STATUS_LABEL: Record<TaxEstimate["status"], string> = {
  CONFIRMED: "확정·시행중",
  SCHEDULED: "확정·시행예정",
  PARTIAL: "부분확정(잠정)",
  UNDETERMINED: "미확정",
};

/** estimate 하나에서 계산 신뢰도를 사람이 읽는 한 줄로. 문구를 지어내지 않고 구조에서만 파생한다. */
export function filingConfidenceNote(estimate: TaxEstimate): string {
  const confidence = estimateConfidence(estimate);
  const flags: string[] = [];
  if (confidence.notReflected > 0) flags.push(`미반영 ${confidence.notReflected}건`);
  if (confidence.zeroBasis > 0) flags.push(`취득가액 0원 계산 ${confidence.zeroBasis}건`);
  const base = CONFIDENCE_STATUS_LABEL[estimate.status];
  return flags.length > 0 ? `${base} · ${flags.join(" · ")}` : base;
}

/**
 * 별지 제40호서식(6)의 기입란을 estimate에서 1:1로 파생한다.
 *
 * 총수입금액·필요경비는 estimate.totals에 따로 없어 건별 판정의 손익 근거(breakdown)에서 집계한다:
 * 총수입금액 = Σ양도가액 + 대여대가, 필요경비 = Σ(취득가액+부대비용), 기타소득금액 = 총수입금액 − 필요경비.
 * 나머지(기본공제·과세표준·산출 소득세·지방소득세)는 룰셋이 이미 낸 lines/totals를 그대로 읽는다.
 */
export function buildFilingSummary(estimate: TaxEstimate): ReportRow[] {
  const gainRows = estimate.judgments.filter((row) => row.amountKind === "gain");
  const incomeRows = estimate.judgments.filter((row) => row.amountKind === "fmv" && row.group === "income");
  const proceeds = sum(gainRows.map((row) => row.breakdown?.proceeds ?? ZERO));
  const costBasis = sum(gainRows.map((row) => row.breakdown?.cost ?? ZERO));
  const fees = sum(gainRows.map((row) => row.breakdown?.fee ?? ZERO));
  const income = sum(incomeRows.map((row) => row.amount));

  const grossReceipts = add(proceeds, income);
  const necessaryExpense = add(costBasis, fees);
  const otherIncome = sub(grossReceipts, necessaryExpense);
  const basicDeduction = lineAmount(estimate, "basic_deduction");
  const taxBase = estimate.totals.taxableBase;
  const rate = estimate.lines.find((line) => line.key === "income_tax")?.rate ?? "20%";
  const incomeTax = lineAmount(estimate, "income_tax");
  const localTax = lineAmount(estimate, "local_tax");

  const row = (label: string, amount: Decimal, basis: string): ReportRow => ({
    기입란: label,
    금액: num(amount),
    근거: basis,
  });

  return [
    { 기입란: "귀속연도", 금액: estimate.taxYear, 근거: `${estimate.countryLabel} · ${estimate.method}` },
    row("총수입금액", grossReceipts, "양도가액 + 대여대가 합계"),
    row("필요경비", necessaryExpense, "취득가액 + 부대비용(수수료) 합계"),
    row("기타소득금액", otherIncome, "총수입금액 − 필요경비"),
    row("기본공제", basicDeduction, "과세최저한 연 250만원"),
    row("과세표준", taxBase, "기타소득금액 − 기본공제"),
    { 기입란: "세율", 금액: rate, 근거: "분리과세 기타소득" },
    row("산출 소득세", incomeTax, "과세표준 × 세율"),
    row("개인지방소득세", localTax, "산출 소득세의 10%"),
    // 신고 요약은 자기 행끼리 더해 맞아야 한다 — estimate.totals의 단일 반올림 합이 아니라 표기 소득세의 합을 쓴다.
    row("예상 합계 부담", add(incomeTax, localTax), "산출 소득세 + 개인지방소득세"),
    { 기입란: "계산 신뢰도", 금액: filingConfidenceNote(estimate), 근거: "미반영·근사 건수를 함께 표기" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// P2-B 자산별 취득가액 명세 (최우선)
// ─────────────────────────────────────────────────────────────────────────────

export const ASSET_COST_COLUMNS = [
  "자산",
  "기초수량",
  "기초가액",
  "당기취득수량",
  "당기취득가액",
  "총평균단가",
  "당기양도수량",
  "적용취득가액",
  "양도가액",
  "손익",
  "의제취득가액적용여부",
] as const;

type AssetBucket = {
  symbol: string;
  openingQty: Decimal;
  openingCost: Decimal;
  acquiredQty: Decimal;
  acquiredCost: Decimal;
  disposedQty: Decimal;
  appliedCost: Decimal;
  proceeds: Decimal;
  gain: Decimal;
};

function emptyBucket(symbol: string): AssetBucket {
  return {
    symbol,
    openingQty: ZERO,
    openingCost: ZERO,
    acquiredQty: ZERO,
    acquiredCost: ZERO,
    disposedQty: ZERO,
    appliedCost: ZERO,
    proceeds: ZERO,
    gain: ZERO,
  };
}

/**
 * 계산에 들어간 자산별로 취득·양도·손익을 집계한다. 총평균단가는 엔진이 실제로 적용한 원가에서 낸다:
 * 처분이 있으면 Σ적용취득가액 ÷ Σ양도수량(= seed 단가, 의제취득가액 uplift 포함), 없으면 취득 가중평균.
 * 의제취득가액 적용 여부는 그 두 단가가 갈리는지로 판별한다 — 조건을 다시 쓰지 않고 결과에서 읽는다.
 */
export function buildAssetCostDetail(estimate: TaxEstimate): ReportRow[] {
  const buckets = new Map<string, AssetBucket>();
  const bucketOf = (asset: string, symbol: string): AssetBucket => {
    const current = buckets.get(asset) ?? emptyBucket(symbol);
    buckets.set(asset, current);
    return current;
  };

  for (const judgment of estimate.judgments) {
    const bucket = bucketOf(judgment.asset, judgment.symbol);
    if (judgment.amountKind === "cost") {
      if (judgment.inPeriod) {
        bucket.acquiredQty = add(bucket.acquiredQty, judgment.quantity);
        bucket.acquiredCost = add(bucket.acquiredCost, judgment.amount);
      } else {
        bucket.openingQty = add(bucket.openingQty, judgment.quantity);
        bucket.openingCost = add(bucket.openingCost, judgment.amount);
      }
    } else if (judgment.amountKind === "gain") {
      bucket.disposedQty = add(bucket.disposedQty, judgment.quantity);
      bucket.appliedCost = add(bucket.appliedCost, judgment.breakdown?.cost ?? ZERO);
      bucket.proceeds = add(bucket.proceeds, judgment.breakdown?.proceeds ?? ZERO);
      bucket.gain = add(bucket.gain, judgment.amount);
    }
  }

  return [...buckets.values()]
    // 취득도 처분도 없는 유령 자산(수령 FMV만 있는 소득 등)은 취득가액 명세에 넣지 않는다.
    .filter((bucket) => isPositive(bucket.acquiredQty) || isPositive(bucket.openingQty) || isPositive(bucket.disposedQty))
    .map((bucket): ReportRow => {
      const holdingQty = add(bucket.openingQty, bucket.acquiredQty);
      const holdingCost = add(bucket.openingCost, bucket.acquiredCost);
      const rawUnit = isPositive(holdingQty) ? div(holdingCost, holdingQty) : ZERO;
      const appliedUnit = isPositive(bucket.disposedQty) ? div(bucket.appliedCost, bucket.disposedQty) : rawUnit;
      const deemed = isPositive(bucket.disposedQty) && gt(appliedUnit, rawUnit) ? "적용" : "미적용";
      return {
        자산: bucket.symbol,
        기초수량: round(bucket.openingQty, 8),
        기초가액: num(bucket.openingCost),
        당기취득수량: round(bucket.acquiredQty, 8),
        당기취득가액: num(bucket.acquiredCost),
        총평균단가: num(appliedUnit),
        당기양도수량: round(bucket.disposedQty, 8),
        적용취득가액: num(bucket.appliedCost),
        양도가액: num(bucket.proceeds),
        손익: num(bucket.gain),
        의제취득가액적용여부: deemed,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// P2-C 거래 원장 부속명세
// ─────────────────────────────────────────────────────────────────────────────

/** 기존 온체인 로그 칸(user_override JSON 통짜 칸은 제외 — 해석된 값으로 대체한다). */
const LEDGER_BASE_COLUMNS = [
  "id",
  "tx_hash",
  "chain_id",
  "log_index",
  "block_timestamp",
  "wallet_address",
  "direction",
  "asset_type",
  "asset_contract",
  "token_id",
  "decimals",
  "raw_amount",
  "counterparty",
  "gas_fee_native",
  "classification",
  "confidence",
  "price_status",
  "fiat_value",
  "fiat_currency",
  "asset_symbol",
  "asset_verified",
] as const;

/** 신고를 방어하는 해석 칸. estimate 판정·사용자 입력에서 해석된 값을 싣는다. */
const LEDGER_DERIVED_COLUMNS = [
  "귀속연도",
  "거래일시_KST",
  "정규화수량",
  "원화양도가액",
  "원화취득가액",
  "부대비용",
  "가스비_원",
  "손익",
  "과세판정",
  "판정근거조문",
  "가격출처",
  "계산엔진여부",
  "사용자수정여부",
  "증빙링크",
  "구분",
] as const;

export const LEDGER_COLUMNS = [...LEDGER_BASE_COLUMNS, ...LEDGER_DERIVED_COLUMNS] as const;

type EventJudgment = {
  proceeds: Decimal;
  cost: Decimal;
  gain: Decimal;
  hasGain: boolean;
  labels: string[];
  bases: string[];
  inPeriod: boolean;
};

function indexJudgmentsByEvent(estimate: TaxEstimate): Map<string, EventJudgment> {
  const map = new Map<string, EventJudgment>();
  for (const judgment of estimate.judgments) {
    const current: EventJudgment = map.get(judgment.eventId) ?? {
      proceeds: ZERO,
      cost: ZERO,
      gain: ZERO,
      hasGain: false,
      labels: [],
      bases: [],
      inPeriod: false,
    };
    if (judgment.amountKind === "gain") {
      current.hasGain = true;
      current.proceeds = add(current.proceeds, judgment.breakdown?.proceeds ?? ZERO);
      current.cost = add(current.cost, judgment.breakdown?.cost ?? ZERO);
      current.gain = add(current.gain, judgment.amount);
    } else if (judgment.amountKind === "cost") {
      current.cost = add(current.cost, judgment.amount);
    }
    current.labels.push(judgment.label);
    current.bases.push(judgment.basis);
    current.inPeriod = current.inPeriod || judgment.inPeriod;
    map.set(judgment.eventId, current);
  }
  return map;
}

/**
 * 이벤트 하나를 원장 부속명세 한 행으로. estimate가 있으면 판정·손익을 싣고,
 * 없으면(빈 지갑·계산 실패) 온체인 값과 사용자 입력만으로 채운다 — 파일은 언제나 만들 수 있어야 한다.
 */
export function buildLedgerDetail(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): ReportRow[] {
  const byEvent = estimate ? indexJudgmentsByEvent(estimate) : new Map<string, EventJudgment>();
  const excluded = new Set(estimate?.excludedEventIds ?? []);
  const taxYear = estimate?.taxYear ?? "";

  return events.map((event): ReportRow => {
    const override = event.value_override;
    const judgment = byEvent.get(event.id);
    const isExcluded = excluded.has(event.id);
    const proceeds = judgment?.hasGain ? String(round(judgment.proceeds, 2)) : override?.disposal_value ?? "";
    const cost = judgment && (judgment.hasGain || gt(judgment.cost, ZERO))
      ? String(round(judgment.cost, 2))
      : override?.acquisition_cost ?? "";
    const partition = isExcluded ? "제외" : judgment ? (judgment.inPeriod ? "계산대상" : "원가추적") : "미계산";
    return {
      id: event.id,
      tx_hash: event.tx_hash,
      chain_id: event.chain_id,
      log_index: event.log_index,
      block_timestamp: event.block_timestamp,
      wallet_address: event.wallet_address,
      direction: event.direction,
      asset_type: event.asset_type,
      asset_contract: event.asset_contract ?? "",
      token_id: event.token_id ?? "",
      decimals: event.decimals,
      raw_amount: event.raw_amount,
      counterparty: event.counterparty,
      gas_fee_native: event.gas_fee_native,
      classification: event.classification,
      confidence: event.confidence,
      price_status: event.price_status,
      fiat_value: event.price_status === "UNKNOWN" ? "" : event.fiat_value ?? "",
      fiat_currency: event.fiat_currency,
      asset_symbol: event.asset_symbol ?? "",
      asset_verified: event.asset_verified ? "true" : "false",
      귀속연도: taxYear,
      거래일시_KST: formatKstDateTime(event.block_timestamp),
      정규화수량: formatTokenAmount(event.raw_amount, event.decimals),
      원화양도가액: proceeds,
      원화취득가액: cost,
      부대비용: override?.incidental_cost ?? "",
      가스비_원: override?.gas_fee ?? "",
      손익: judgment?.hasGain ? String(round(judgment.gain, 2)) : "",
      과세판정: judgment ? distinct(judgment.labels).join(" · ") : isExcluded ? "계산 제외" : "판정 없음",
      판정근거조문: judgment ? distinct(judgment.bases).join(" · ") : "",
      가격출처: override?.price_source ?? "",
      계산엔진여부: judgment ? "계산" : "제외",
      // JSON 통짜 대신 해석된 사실만: 분류를 고쳤거나 금액을 채웠으면 "예".
      사용자수정여부: event.user_override !== null || override !== null ? "예" : "아니오",
      증빙링크: override?.evidence_url ?? "",
      구분: partition,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// P2-D 예외·판단보류 목록
// ─────────────────────────────────────────────────────────────────────────────

export const EXCEPTION_COLUMNS = ["구분", "내용", "관련이벤트", "금액영향_원"] as const;

const LIMITATION_KIND_LABEL: Record<LimitationKind, string> = {
  excluded: "계산 제외",
  zero_basis: "취득가액 0원",
  approximation: "근사 계산",
  not_reflected: "미반영",
  other: "기타 한계",
};

const OPEN_QUESTION_TOPIC_LABEL: Record<string, string> = {
  CAPITAL_GAINS: "매매차익",
  STAKING: "스테이킹·렌딩",
  AIRDROP: "에어드랍",
  CRYPTO_TO_CRYPTO: "크립토→크립토",
  DEFI_LP: "디파이 LP",
  WRAPPING: "랩핑",
  LOSS_OFFSET: "손실 상계",
};

/** 관련 이벤트들의 원화 가액 합. 하나라도 가격 미확인이면 금액을 못 세우므로 "-"로 정직하게 둔다. */
function amountImpact(eventIds: string[], fiatByEvent: Map<string, Decimal | null>): number | string {
  if (eventIds.length === 0) return "-";
  let total = ZERO;
  for (const id of eventIds) {
    const value = fiatByEvent.get(id);
    if (value === undefined || value === null) return "-";
    total = add(total, value);
  }
  return num(total);
}

/**
 * 미분류·가격 미확인·취득가 0원·방향분류 모순·NFT/에어드랍/스테이킹을 금액 영향과 함께 모은다.
 * estimate.limitations(근사·제외·미반영) + openQuestions(판단 보류) + 어디에도 안 잡힌 excludedEventIds.
 */
export function buildExceptions(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): ReportRow[] {
  if (!estimate) return [];
  const fiatByEvent = new Map<string, Decimal | null>(
    events.map((event) => [event.id, event.price_status === "UNKNOWN" ? null : event.fiat_value]),
  );
  const rows: ReportRow[] = [];
  const covered = new Set<string>();

  for (const limitation of estimate.limitations) {
    for (const id of limitation.eventIds) covered.add(id);
    rows.push({
      구분: LIMITATION_KIND_LABEL[limitation.kind],
      내용: limitation.message,
      관련이벤트: limitation.eventIds.join(", "),
      금액영향_원: amountImpact(limitation.eventIds, fiatByEvent),
    });
  }

  for (const question of estimate.openQuestions) {
    for (const id of question.affectedEventIds) covered.add(id);
    const topic = OPEN_QUESTION_TOPIC_LABEL[question.topic] ?? question.topic;
    rows.push({
      구분: `판단보류 · ${topic}`,
      내용: question.reason,
      관련이벤트: question.affectedEventIds.join(", "),
      금액영향_원: amountImpact(question.affectedEventIds, fiatByEvent),
    });
  }

  // 한계·미결 질문 어디에도 잡히지 않은 제외 이벤트는 사유를 모른 채 빠진 것이다 — 그래도 보인다.
  for (const id of estimate.excludedEventIds) {
    if (covered.has(id)) continue;
    rows.push({
      구분: "계산 제외",
      내용: "확인이 필요해 계산에서 제외된 이벤트입니다.",
      관련이벤트: id,
      금액영향_원: amountImpact([id], fiatByEvent),
    });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV 직렬화 — 원장 부속명세(P2-C)를 파일 한 장으로 (엑셀 BOM · RFC4180 이스케이프)
// ─────────────────────────────────────────────────────────────────────────────

function escapeCell(value: string | number): string {
  const cell = String(value);
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** 열 정의와 행을 CSV 문자열로. 열에 없는 키는 버리고, 행에 없는 열은 빈 칸으로 채운다. */
export function serializeCsv(columns: readonly string[], rows: readonly ReportRow[]): string {
  const body = rows.map((row) => columns.map((column) => row[column] ?? ""));
  return `﻿${[columns, ...body].map((line) => line.map(escapeCell).join(",")).join("\r\n")}\r\n`;
}

/** CSV 다운로드 = 원장 부속명세. 시트가 하나뿐인 CSV에는 행 단위 원장이 가장 자연스럽다. */
export function createReportLedgerCsv(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
): string {
  return serializeCsv(LEDGER_COLUMNS, buildLedgerDetail(events, estimate));
}
