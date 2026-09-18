"use client";

import Link from "next/link";
import { useState } from "react";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { shortEventId } from "@/lib/event-id";
import { formatFiat } from "@/lib/format";
import { halfOpenPeriodLabel } from "@/lib/period";
import { limitationBody } from "@/lib/tax/limitations";
import { fresh } from "@/lib/queries/fresh";
import { useRuleSets, useTaxEstimate } from "@/lib/queries/tax";
import type { TaxEventSource } from "@/lib/ports/tax-engine";
import type { RuleSetSummary } from "@/lib/tax/types";
import { add, round, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { canonicalCountryCode } from "@/lib/tax/rulesets";
import { noChargeHeadline, omitsCharge } from "@/lib/tax/status";
import { useTaxYear } from "@/lib/tax/tax-year-context";
import { taxYearWindow } from "@/lib/tax/year-window";
import type {
  ConfirmationStatus,
  JudgmentGroup,
  JudgmentRow,
  LimitationKind,
  ProfileField,
  RuleTopic,
  TaxEstimate,
  TaxpayerProfile,
} from "@/lib/tax/types";

const STATUS_LABEL: Record<ConfirmationStatus, string> = {
  CONFIRMED: "확정·시행중",
  SCHEDULED: "확정·시행예정",
  PARTIAL: "부분확정",
  UNDETERMINED: "미확정",
};

const STATUS_STYLE: Record<ConfirmationStatus, string> = {
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  SCHEDULED: "bg-blue-100 text-blue-800",
  PARTIAL: "bg-amber-100 text-amber-800",
  UNDETERMINED: "bg-zinc-200 text-zinc-700",
};

const TOPIC_LABEL: Record<RuleTopic, string> = {
  CAPITAL_GAINS: "매매차익",
  STAKING: "스테이킹·렌딩",
  AIRDROP: "에어드랍",
  CRYPTO_TO_CRYPTO: "크립토→크립토",
  DEFI_LP: "디파이 LP",
  WRAPPING: "랩핑",
  LOSS_OFFSET: "손실 상계",
};

/**
 * L2 — "왜 이 금액인가".
 * 판정 그룹별로 접어 **건수와 금액**을 보인다. 총액(L1)과 건별 근거(L3) 사이를 잇는 층이다.
 */
type GroupRow = {
  group: JudgmentGroup;
  amountKind: JudgmentRow["amountKind"];
  count: number;
  amount: string;
  label: string;
};

/** 화면 순서는 "답에 가까운 것"부터: 과세 → 소득 → 비과세·상계 → 손실 → 나머지. */
const GROUP_ORDER: JudgmentGroup[] = [
  "taxable", "income", "exempt", "offset", "carry", "ignored", "denied", "deferred", "pending", "acquire",
];

/** 접힌 라벨들이 공통으로 말하던 조정 사유를 한 조각만 남긴다. */
function adjustmentSuffix(labels: string[]): string {
  const reasons = ["상계", "공제", "면세", "할인", "포함률"].filter((word) =>
    labels.every((label) => label.includes(word)),
  );
  return reasons.length > 0 ? ` · ${reasons.join("·")} 적용` : "";
}

function groupJudgments(result: TaxEstimate): GroupRow[] {
  // 금액 종류가 다른 행을 한 숫자로 더하면 의미 없는 합계가 된다.
  // 한국의 `pending`은 손익과 수령 FMV를 함께 담는다 — 둘을 더한 수는 아무것도 아니다.
  const byKey = new Map<string, { events: Set<string>; amounts: string[]; labels: Set<string> }>();
  for (const row of result.judgments) {
    const key = `${row.group}\u001f${row.amountKind}`;
    const bucket = byKey.get(key) ?? { events: new Set(), amounts: [], labels: new Set() };
    bucket.events.add(row.eventId);
    bucket.amounts.push(row.amount);
    bucket.labels.add(row.label);
    byKey.set(key, bucket);
  }
  return [...byKey]
    .map(([key, bucket]) => {
      const [group, amountKind] = key.split("\u001f") as [JudgmentGroup, JudgmentRow["amountKind"]];
      return {
        group,
        amountKind,
        count: bucket.events.size,
        amount: round(sum(bucket.amounts), 2),
        // 라벨이 하나면 룰셋 문구를 그대로 쓴다.
        // 여러 개를 그룹 이름으로만 접으면 "왜 줄었는지"가 사라진다 — 조정 사유는 남긴다.
        label:
          bucket.labels.size === 1
            ? [...bucket.labels][0]!
            : `${GROUP_SHORT_LABEL[group]}${adjustmentSuffix([...bucket.labels])}`,
      };
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

const LIMITATION_LABEL: Record<LimitationKind, string> = {
  excluded: "답에서 빠짐",
  zero_basis: "취득가액 0으로 계산",
  approximation: "근사",
  not_reflected: "반영 안 함",
  other: "그 밖의 한계",
};

/** 카드에 펼쳐 보일 이벤트 id 수. 넘으면 "외 N건"으로 접는다 — 한 한계가 수십 건을 달고 오기도 한다. */
const LIMITATION_ID_PREVIEW = 4;

const LIMITATION_STYLE: Record<LimitationKind, string> = {
  excluded: "bg-amber-100 text-amber-900",
  zero_basis: "bg-red-100 text-red-900",
  approximation: "bg-blue-100 text-blue-900",
  not_reflected: "bg-zinc-100 text-zinc-700",
  other: "bg-zinc-100 text-zinc-700",
};

/**
 * 이 국가가 쓰는 입력만 살린다.
 * 안 쓰는 입력을 화면에서 지우면 사용자는 "왜 안 물어보지"를 자기 실수로 오해한다.
 * 그래서 자리는 남기고 "이 국가에서 쓰지 않음"이라고 말한다.
 */
function ProfileInput({
  field,
  used,
  failed,
  label,
  children,
}: {
  field: ProfileField;
  /** `null`은 "아직 모른다". 모를 때 "쓰지 않음"이라 하면 화면이 거짓을 말한다. */
  used: (field: ProfileField) => boolean | null;
  /** 룰셋 조회 자체가 실패한 상태. 진행 중이라고 말하면 거짓이다. */
  failed: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const state = used(field);
  if (state === true) return <div>{children}</div>;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-400">
      <span>{label}</span>
      <span className="shrink-0">
        {state !== null ? "이 국가에서 쓰지 않음" : failed ? "룰셋을 불러오지 못함" : "룰셋 확인 중"}
      </span>
    </div>
  );
}

/**
 * 룰셋이 선언한 프로필 필드만 남긴다.
 * 선언을 아직 모르면(목록 로딩·실패) 전부 보낸다 — 임의로 빼면 답이 조용히 달라진다.
 */
export function pickDeclared(declared: ProfileField[] | undefined, profile: TaxpayerProfile): Partial<TaxpayerProfile> {
  if (!declared) return profile;
  const picked: Partial<TaxpayerProfile> = {};
  for (const field of declared) Object.assign(picked, { [field]: profile[field] });
  return picked;
}

/**
 * 이 룰셋 메타데이터의 지문.
 *
 * 카탈로그가 재조회돼 확정 상태나 항목이 바뀌면 결과도 다시 받아야 한다.
 * 그러지 않으면 헤더는 옛 결과의 상태를, 아래 패널은 새 카탈로그의 항목을 말한다.
 */
function catalogSignature(ruleset: RuleSetSummary | undefined): string {
  if (!ruleset) return "";
  return [
    ruleset.code,
    ruleset.status,
    // 화면이 결과와 함께 말하는 메타데이터도 지문에 넣는다.
    // 통화·계산방법·국가명이 바뀌었는데 옛 결과를 그대로 쓰면 화면이 옛 문맥을 단정한다.
    ruleset.label,
    ruleset.currency,
    ruleset.method,
    ruleset.cost_basis,
    // 배열 순서는 응답의 사정이지 카탈로그의 정체성이 아니다. 정렬해야 순서만 바뀐 응답이 새 캐시를 만들지 않는다.
    [...ruleset.profileFields].sort().join(","),
    // 확정 상태뿐 아니라 법적 근거·주석이 바뀌어도 화면이 옛 결과 문맥을 말하면 안 된다.
    ruleset.topics.map((topic) => `${topic.topic}:${topic.status}:${topic.basis}:${topic.note ?? ""}`).sort().join(","),
  ].join("|");
}

function StatusBadge({ status }: { status: ConfirmationStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * 거주국 룰셋이 아직 없으면 데모 1순위인 독일로 연다.
 * 화면을 비워두고 사용자가 고르게 하면 "진입 즉시 답"이 아니다.
 */
const FALLBACK_COUNTRY = "DE";

export function TaxSimulator({
  countryCode,
  currentYear = new Date().getFullYear(),
  latestActivityYear,
  walletConnected = true,
}: { countryCode?: string; currentYear?: number; latestActivityYear?: number; walletConnected?: boolean } = {}) {
  // DID가 주는 UK 같은 별칭을 여기서 한 번 표준화한다.
  const [country, setCountry] = useState(() => canonicalCountryCode(countryCode ?? "") ?? FALLBACK_COUNTRY);
  // 연도는 서버가 정한 값 하나만 쓴다. state와 버튼 목록이 서로 다른 시계를 읽으면
  // 자정을 넘긴 순간 선택된 버튼이 사라지고, SSR과 hydration도 갈린다.
  // "올해"로 고정하면 올해 거래가 없는 지갑은 진입하자마자 12개 룰셋이 전부 "계산할 거래 없음"을 말한다.
  // 그건 비교가 아니라 빈 화면이다. 마지막 거래가 있는 해를 알면 거기서 연다.
  // 선택된 연도는 전역 단일 소스(TaxYearProvider)에 둔다 — 여기서 바꾸면 대시보드·거래 상세도 같은 기간을 본다.
  // 프로바이더가 없는 격리 렌더에서는 로컬 상태로 물러나 예전 동작을 그대로 지킨다.
  const [taxYear, setTaxYear] = useTaxYear(latestActivityYear ?? currentYear);
  // 기본은 내 지갑이다. 데모 시나리오는 명시적으로 고를 때만 쓴다.
  // 지갑 미연결이면 낼 지갑 이력이 없으므로 데모 시나리오로 연다.
  const [source, setSource] = useState<TaxEventSource>(walletConnected ? "wallet" : "scenario");
  // 시행 전 룰셋(한국 2027)을 "시행됐다고 가정하고" 볼지. 기본은 사실 — 가정은 사용자가 켠다.
  const [assumeEffective, setAssumeEffective] = useState(false);
  // 슬라이더는 드래그 중 화면만 따라가고(draft), 손을 뗄 때 한 번만 계산에 커밋한다.
  const [marginalRatePercent, setMarginalRatePercent] = useState("35");
  const [marginalRateDraft, setMarginalRateDraft] = useState("35");
  const [filingStatus, setFilingStatus] = useState<"SINGLE" | "JOINT">("SINGLE");
  const [carriedLossesInput, setCarriedLossesInput] = useState("");
  const carriedLosses = carriedLossesInput === "" ? "0" : carriedLossesInput;
  // 빈 문자열을 허용해야 입력값을 지울 수 있다. 엔진에는 항상 유효한 십진 문자열을 넘긴다.
  const [otherIncomeInput, setOtherIncomeInput] = useState("");
  const otherIncome = otherIncomeInput === "" ? "0" : otherIncomeInput;

  const [isBusiness, setIsBusiness] = useState(false);
  const [defiOwnershipTransferred, setDefiOwnershipTransferred] = useState(false);
  // 자산별 2026-12-31 연말 시가(의제취득가액). 자산 키 → 원화 단가 문자열. 출처는 근거 보존용(계산에는 안 들어간다).
  const [yearEndFmv, setYearEndFmv] = useState<Record<string, string>>({});
  const [fmvSource, setFmvSource] = useState<Record<string, string>>({});
  // 유효한 십진 입력만 deemedFmv로 흘려보낸다. 비거나 잘못된 값은 "미입력"과 같게 둔다.
  const deemedFmvEntries = Object.entries(yearEndFmv).filter(
    ([, value]) => /^\d+(?:\.\d+)?$/.test(value.trim()),
  );
  const deemedFmv: Record<string, Decimal> | undefined =
    deemedFmvEntries.length > 0
      ? Object.fromEntries(deemedFmvEntries.map(([asset, value]) => [asset, value.trim()]))
      : undefined;

  const rulesets = useRuleSets();
  // 칩으로 다른 나라를 고르면 더 이상 거주국 결과가 아니다.
  // 거주국을 모르면(prop 없음) 어느 나라도 "거주국"이라 단정하지 않는다.
  const homeCountry = countryCode ? canonicalCountryCode(countryCode) : null;
  const isHomeCountry = homeCountry !== null && country === homeCountry;
  const selected = rulesets.data?.find((ruleset) => ruleset.code === country);
  // 룰셋을 알기 전에 계산하면 첫 요청은 프로필 전체, 둘째 요청은 걸러진 프로필로 나간다.
  // 두 답이 같다는 보장은 계약(profileFields)에 기대는 것이고, 화면은 그 사이 한 번 깜빡인다.
  // 선언을 안 다음에 한 번만 묻는다.
  const estimate = useTaxEstimate({
    country,
    taxYear,
    source,
    // 시행 전 룰셋을 "시행됐다고 가정하고" 보는 중이면 그 사실도 요청에 실린다.
    ...(assumeEffective ? { assumeEffective: true } : {}),
    // 사용자가 입력한 연말 시가(의제취득가액). 없으면 보내지 않아 캐시 키가 흔들리지 않는다.
    // KR 총평균 seed만 소비하며, deemedCostBoundary를 선언하지 않은 타국은 값이 있어도 무시한다(회귀 0).
    ...(deemedFmv ? { deemedFmv } : {}),
    // 화면이 "이 국가에서 쓰지 않음"이라 했으면 실제로도 보내지 않는다.
    // 선언을 표시용 메타데이터로만 두면 보이지 않는 값이 답을 바꿔도 아무도 모른다.
    // `selected`가 없으면 아래 enabled가 false라 이 값은 요청되지 않는다.
    profile: pickDeclared(selected?.profileFields, {
      marginalRatePercent,
      otherIncome,
      filingStatus,
      isBusiness,
      defiOwnershipTransferred,
      carriedLosses,
    }),
  }, selected !== undefined, catalogSignature(selected));
  // 재조회 중이거나 실패했으면 이전 결과를 답으로 쓰지 않는다.
  // 설정을 바꾼 직후 옛 금액이 새 설정의 답인 척하는 것이 이 화면의 가장 큰 거짓이었다.
  const freshEstimate = fresh(estimate, selected === undefined);
  const result = freshEstimate.data;

  // 판정 행이 하나도 없으면 계산에 들어간 거래가 없다는 뜻이다.
  // 제외된 이벤트만 있는 경우도 여기에 걸린다 — 그건 "0원"이 아니라 "셀 것이 없음"이다.
  // 어떤 입력을 쓰는지는 룰셋이 선언한다. 화면이 국가 코드로 다시 판단하면 두 곳이 갈린다.
  // 룰셋을 아직 못 받았으면 "쓰지 않음"이라고 단정할 수 없다.
  const usesField = (field: ProfileField): boolean | null =>
    selected ? selected.profileFields.includes(field) : null;
  // 조회에 실패한 것과 아직 받는 중인 것은 다른 사실이다.
  // 오류가 아니어도 목록이 비었거나 선택한 국가가 없으면 답을 낼 수 없다.
  // 그 상태를 "확인 중"이라 하면 영원히 오지 않을 것을 기다리게 만든다.
  const catalogUnusable = rulesets.data !== undefined && selected === undefined;
  const rulesetsFailed = (rulesets.isError || catalogUnusable) && selected === undefined;
  const sourceLabel = source === "wallet" ? "지갑 이력" : "데모 시나리오";
  const countryLabel = isHomeCountry ? "거주국" : "선택한 국가";
  // `result`가 없는 이유는 셋이다 — 룰셋을 못 찾음 / 계산 실패 / 계산 중.
  // 셋을 뭉뚱그려 "적용하는 중"이라 하면 실패한 것을 진행 중이라고 거짓말한다.
  const headerNote = rulesetsFailed
    ? "적용할 룰셋을 확인하지 못해 아직 계산하지 않았습니다."
    : freshEstimate.state === "error"
      ? `${sourceLabel}에 ${countryLabel} 룰셋을 적용하지 못했습니다.`
      : result === undefined
        ? `${sourceLabel}에 ${countryLabel} 룰셋을 적용하는 중입니다.`
        : `${sourceLabel}에 ${countryLabel} 룰셋을 적용한 결과입니다. 계산 보조용이며 확정 판단이 아닙니다.`;
  // notes에는 규칙 설명과 계산 한계가 섞여 있다. 한계는 전용 패널이 이미 보여준다.
  const limitationMessages = new Set(result?.limitations.map((row) => row.message) ?? []);
  const ruleNotes = (result?.notes ?? []).filter((note) => !limitationMessages.has(note));
  // 취득은 원가 추적 때문에 기간 밖에서도 남는다(engine.ts가 의도적으로 남긴다).
  // 그걸 세면 "이번 기간에 셀 것이 없음"이 영영 걸리지 않는다.
  // 어차피 안 그릴 것을 집계하지 않는다. 순서가 뒤집히면 "셀 것이 없다"면서 옛 취득 그룹을 보인다.
  const hasNothingToCompute =
    result !== undefined && !result.judgments.some((row) => row.inPeriod && row.group !== "acquire");
  const groups = result && !hasNothingToCompute ? groupJudgments(result) : [];
  // 연말 시가를 입력할 대상 자산 — 처분(gain) 판정에 등장하는 자산을 키(asset)로 모은다.
  // 의제취득가액은 처분 원가에 작용하므로 처분 자산이 곧 입력 대상이다. 키는 seed가 소비하는 키와 같다(같은 원장 행에서 왔다).
  const yearEndAssets = [
    ...(result?.judgments ?? [])
      .filter((row) => row.amountKind === "gain")
      .reduce((map, row) => {
        const current = map.get(row.asset);
        map.set(row.asset, {
          symbol: row.symbol,
          quantity: current ? add(current.quantity, row.quantity) : row.quantity,
        });
        return map;
      }, new Map<string, { symbol: string; quantity: Decimal }>())
      .entries(),
  ].map(([asset, info]) => ({ asset, symbol: info.symbol, quantity: info.quantity }));
  // 이 룰셋이 연말 시가(의제취득가액)를 입력으로 요구하는가. 룰셋이 requiredInputs로 선언한다 — 국가 코드로 하드코딩하지 않는다.
  const requiresYearEndFmv = (result?.requiredInputs ?? []).some((input) => input.includes("의제취득가액"));

  // 올해가 아닌 해로 열렸다면 그 이유를 말한다.
  // 말하지 않으면 사용자는 화면이 왜 작년을 보여주는지 모른 채 옛 결과를 올해 답으로 읽는다.
  const openedOnPastYear =
    latestActivityYear !== undefined && latestActivityYear !== currentYear && taxYear === latestActivityYear;
  // 시행일이 아직 오지 않은 룰셋(한국 2027)은 그 해를 미리 고를 수 있어야 한다.
  // 고를 수 없으면 사용자는 "시행되면 얼마인가"를 이 화면에서 끝내 알 수 없다.
  const effectiveTaxYear = selected?.effectiveTaxYear;
  const previewingEffectiveYear =
    effectiveTaxYear !== undefined && effectiveTaxYear > currentYear && taxYear >= effectiveTaxYear;

  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="tax-simulator" className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
            {taxYear === currentYear ? "올해 세금" : `${taxYear}년 세금`}
          </h1>
          {/* 설명은 실제 상태에서 파생한다. 정적 문장으로 두면 데모를 지갑이라 하고,
              아직 계산하지 않은 화면을 "적용한 결과"라고 단정한다. */}
          <p className="mt-2 text-sm text-zinc-500">{headerNote}</p>
          {/* 고지 3줄이 쌓이면 아무것도 읽히지 않는다 — 배지로 접고 전문은 아래에 보존. */}
          {openedOnPastYear || previewingEffectiveYear ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {openedOnPastYear ? (
                <span className="inline-flex rounded-full bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                  {latestActivityYear}년으로 열림
                </span>
              ) : null}
              {previewingEffectiveYear ? (
                <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {effectiveTaxYear}년 시행 기준 미리보기
                </span>
              ) : null}
            </div>
          ) : null}
          {openedOnPastYear || previewingEffectiveYear ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-zinc-400">이 연도로 연 이유</summary>
              {openedOnPastYear ? (
                <p className="mt-1 text-sm text-zinc-500">
                  {currentYear}년에는 계산할 거래가 없어 마지막 거래가 있는 {latestActivityYear}년으로 열었습니다.
                </p>
              ) : null}
              {previewingEffectiveYear ? (
                <p className="mt-1 text-sm text-zinc-500">
                  아직 시행 전인 {effectiveTaxYear}년 기준으로 미리 계산했습니다. 시행일이 지나야 확정된 답이 됩니다.
                </p>
              ) : null}
            </details>
          ) : null}
        </div>
        {/* 배지는 계산 입력의 출처를 말한다. 실 BE 스냅샷(live)으로 계산한 답에 mock 배지를 붙이면 거짓이 된다. */}
        {result?.provenance === "mock" ? <MockProvenanceChip /> : null}
      </header>

      {/* 지갑 미연결 동안 상시 노출한다 — 가정 배너와 같은 원칙: 답 옆에 그 사실이 계속 있어야 한다. */}
      {!walletConnected ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-sm leading-6 text-zinc-600">
            데모 시나리오로 보는 중입니다. 지갑을 연결하면 이 화면이 내 거래로 다시 계산됩니다.
          </p>
          <Link
            href="/connect-wallet"
            className="shrink-0 rounded-lg border border-primary-500 px-2.5 py-1 text-xs font-semibold text-primary-600"
          >
            연결하기
          </Link>
        </div>
      ) : null}

      <section className="mt-6" aria-label="국가 선택">
        {/* 12개 룰셋을 세로로 쌓으면 첫 화면이 칩으로 다 찬다 — 가로 스크롤 스트립으로 접는다. */}
        <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(rulesets.data ?? []).map((ruleset) => (
            <button
              key={ruleset.code}
              type="button"
              aria-pressed={ruleset.code === country}
              className={`shrink-0 snap-start whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${ruleset.code === country ? "border-primary-500 bg-primary-500 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
              onClick={() => setCountry(ruleset.code)}
            >
              {ruleset.label}
              {ruleset.demoPriority ? <span className="ml-1 text-xs opacity-80">{ruleset.demoPriority}순위</span> : null}
            </button>
          ))}
        </div>

        {rulesets.isLoading ? <p className="text-sm text-zinc-500">룰셋을 불러오는 중입니다</p> : null}
        {rulesetsFailed ? (
          // 룰셋을 못 받으면 답도 못 낸다. 오류만 띄우고 나가는 문을 안 주면 막다른 화면이다.
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600">
            <span>
              {rulesets.isError
                ? "룰셋 목록을 불러오지 못했습니다."
                : `이 목록에 ${country} 룰셋이 없습니다.`}{" "}
              룰셋을 알기 전에는 계산하지 않습니다.
            </span>
            <button
              type="button"
              className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-700"
              onClick={() => void rulesets.refetch()}
            >
              다시 시도
            </button>
          </div>
        ) : null}
      </section>


      {freshEstimate.state === "error" ? (
        <p role="alert" className="mt-4 text-sm text-red-600">계산 결과를 불러오지 못했습니다.</p>
      ) : null}
      {freshEstimate.state === "pending" ? (
        <p className="mt-6 text-sm text-zinc-500">계산 결과를 불러오는 중입니다</p>
      ) : null}
      {freshEstimate.state === "disabled" && !rulesetsFailed ? (
        // 요청을 보낸 적이 없다. "불러오는 중"이라 하면 하지 않은 일을 하고 있다고 말하는 것이다.
        <p className="mt-6 text-sm text-zinc-500">적용할 룰셋을 확인하는 중입니다. 아직 계산하지 않았습니다.</p>
      ) : null}

      {result ? (
        <>
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
                  단가·부담 잠정
                </span>
              ) : null}
            </div>
            {/* 과세기간은 화면이 다시 계산하면 안 된다. 영국 4/6~·호주 7/1~ 때문에 역년과 다르다. */}
            <p className="mt-1 text-sm text-zinc-500">과세기간 {halfOpenPeriodLabel(result.period)}</p>
            {/* 가정을 켠 동안에는 그 사실이 답 바로 옆에 계속 있어야 한다.
                켤 때 한 번만 말하고 지우면, 남는 것은 근거 없는 큰 금액뿐이다. */}
            {assumeEffective ? (
              <div className="mt-3 flex items-start justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm leading-6 text-amber-900">
                  시행 가정으로 보는 중입니다. 아래 금액은 {result.taxYear}년 거래에 {result.countryLabel} 시행 규칙을
                  적용했다고 가정한 값이며, 실제 부담이 아닙니다.
                </p>
                <button
                  type="button"
                  aria-pressed={true}
                  className="shrink-0 rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-900"
                  onClick={() => setAssumeEffective(false)}
                >
                  가정 끄기
                </button>
              </div>
            ) : null}
            {result !== undefined && omitsCharge(result.status) ? (
              // 부담을 산출하지 않은 국가는 totals가 전부 0이다. 그대로 카드로 깔면 "낼 게 없다"로 읽힌다 — 이유 자체를 답으로 내보인다.
              <div className="mt-3 rounded-card border border-zinc-300 bg-white p-4 shadow-card">
                <p className="text-sm text-zinc-500">예상 부담 추정</p>
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
                {/* 시행 전이라는 사실을 답으로 내보인 자리에서, 그 가정을 켜는 문도 함께 연다. */}
                {result.status === "SCHEDULED" && !hasNothingToCompute ? (
                  <button
                    type="button"
                    aria-pressed={false}
                    className="mt-3 rounded-lg border border-primary-500 px-3 py-1.5 text-sm font-semibold text-primary-600"
                    onClick={() => setAssumeEffective(true)}
                  >
                    시행 가정으로 보기
                  </button>
                ) : null}
              </div>
            ) : hasNothingToCompute ? (
              // 답이 0원인 것과 셀 것이 없는 것은 다른 사실이다.
              // "₩0"만 크게 띄우면 사용자는 "올해는 낼 게 없구나"로 읽는다.
              <div className="mt-3 rounded-card border border-zinc-300 bg-white p-4 shadow-card">
                <p className="text-sm text-zinc-500">예상 부담 추정</p>
                <p data-testid="estimated-charge" className="mt-1 text-2xl font-bold text-zinc-500">계산할 거래 없음</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  이 과세기간({halfOpenPeriodLabel(result.period)})에 계산에 넣을 거래가 없습니다.
                  거래가 있는데도 비어 있다면 아래 과세연도를 확인해 주세요.
                </p>
              </div>
            ) : (
              <>
                {/* L1 — 답. 사용자가 이 화면에서 가장 먼저 알고 싶은 한 가지다. */}
                <div className="mt-3 rounded-card border border-primary-200 bg-white p-5 shadow-card">
                  <p className="text-sm text-zinc-500">예상 부담 추정</p>
                  <p data-testid="estimated-charge" className="mt-1 text-4xl font-bold tracking-tight text-primary-600">
                    {formatFiat(result.totals.estimatedCharge, result.currency)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">실효 {result.totals.effectiveRatePercent}%</p>
                </div>
                {/* 답을 이루는 세 덩어리. 답보다 작게 둔다. */}
                <dl className="mt-3 grid grid-cols-3 gap-2">
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
                    <div key={item.label} className="rounded-card border border-zinc-200 bg-white p-3 shadow-card">
                      <dt className="text-xs text-zinc-500">{item.label}</dt>
                      <dd className="mt-1 text-sm font-bold text-zinc-900">{formatFiat(item.value, result.currency)}</dd>
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
                다음 기간으로 넘길 손실: {formatFiat(result.lossCarryforward, result.currency)}
                {hasNothingToCompute ? " (이 기간에는 상계할 손익이 없었습니다)" : ""}
              </p>
            ) : null}
            {result.excludedEventIds.length > 0 ? (
              // 제외 집합은 대시보드 "확인 필요"와 같은 집합이다(lib/tax/derive.ts). 고치러 갈 동선을 여기서 연다.
              <Link
                href="/dashboard"
                className="mt-3 flex items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <span>
                  확인이 필요해 계산에서 빠진 이벤트 {result.excludedEventIds.length}건
                  {hasNothingToCompute ? " · 확인하면 이 기간 계산에 들어갈 수 있습니다" : ""}
                </span>
                <span className="shrink-0 font-semibold underline">확인하러 가기</span>
              </Link>
            ) : null}
          </section>

          {/* 셀 것이 없다고 말해놓고 옛 취득 그룹을 금액과 함께 보이면 두 이야기를 한다. */}
          {groups.length > 0 ? (
            <section className="mt-6" aria-label="판정 그룹">
              <h3 className="font-bold text-zinc-900">왜 이 금액인가</h3>
              <p className="mt-1 text-sm text-zinc-500">
                거래 하나하나에 세금을 나눠 붙일 수는 없습니다. 대신 각 거래가 계산에서 어떻게 쓰였는지를 묶어 보여줍니다.
              </p>
              <ul className="mt-2 grid gap-2">
                {groups.map((row) => (
                  <li
                    key={`${row.group}-${row.amountKind}`}
                    data-group={row.group}
                    data-amount-kind={row.amountKind}
                    className="flex items-start justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 shadow-card"
                  >
                    <div className="min-w-0">
                      <JudgmentBadge group={row.group} label={row.label} />
                      <p className="mt-1 text-xs text-zinc-500">
                        {row.count}건 · {AMOUNT_KIND_LABEL[row.amountKind]}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-zinc-900">
                      {formatFiat(row.amount, result.currency)}
                    </p>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="mt-2 flex items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 text-sm text-zinc-700 shadow-card"
              >
                <span>어떤 거래가 어느 그룹인지 보기</span>
                <span className="shrink-0 font-semibold text-primary-600 underline">거래 탭으로</span>
              </Link>
            </section>
          ) : null}

          {/* 셀 것이 없는 기간에는 흔들 답 자체가 없다. 과거 매수의 가스비 경고를
              현재 답의 영향 요인처럼 보이면 거짓이다. 확인 필요한 제외 이벤트는
              위의 배너가 건수·동선과 함께 계속 알린다. */}
          {!hasNothingToCompute && result.limitations.length > 0 ? (
            <section className="mt-6" aria-label="흔들리는 것">
              <h3 className="font-bold text-zinc-900">이 답이 흔들리는 지점</h3>
              <p className="mt-1 text-sm text-zinc-500">
                답에 영향이 큰 순서입니다. 얼마나 달라지는지는 계산하지 않았으므로 금액으로 말하지 않습니다.
              </p>
              <ul className="mt-2 grid gap-2">
                {result.limitations.map((limitation, index) => (
                  <li
                    key={`${limitation.kind}-${index}`}
                    className="rounded-card border border-zinc-200 bg-white p-3 shadow-card"
                  >
                    {/* 배지와 id를 한 줄에 마주 세우면, 줄바꿈 기회가 없는 100자 해시가 배지를 0폭까지
                        밀어 "답/에/서/빠/짐"으로 쪼갠다. 배지는 제 폭을 지키고 id는 아래 칩 줄로 내린다. */}
                    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LIMITATION_STYLE[limitation.kind]}`}>
                      {LIMITATION_LABEL[limitation.kind]}
                    </span>
                    <p className="mt-1.5 text-sm leading-6 text-zinc-700">{limitationBody(limitation)}</p>
                    {limitation.eventIds.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1" aria-label="해당 이벤트">
                        {limitation.eventIds.slice(0, LIMITATION_ID_PREVIEW).map((eventId) => (
                          // 원문은 title에 남긴다 — 줄인 표기로는 거래를 특정할 수 없다.
                          <li key={eventId} title={eventId} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
                            {shortEventId(eventId)}
                          </li>
                        ))}
                        {limitation.eventIds.length > LIMITATION_ID_PREVIEW ? (
                          <li className="px-1 py-0.5 text-[11px] text-zinc-400">외 {limitation.eventIds.length - LIMITATION_ID_PREVIEW}건</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard?tab=review"
                className="mt-2 flex items-center justify-between gap-3 rounded-card border border-zinc-200 bg-white p-3 text-sm text-zinc-700 shadow-card"
              >
                <span>확인 필요 거래에서 바로잡기</span>
                <span className="shrink-0 font-semibold text-primary-600 underline">확인 필요로</span>
              </Link>
            </section>
          ) : null}

          {/* 셀 것이 없다면서 0.00 줄을 늘어놓으면 사용자가 의미를 찾느라 헤맨다. */}
          {!hasNothingToCompute ? (
          <section className="mt-6" aria-label="계산 내역">
            <h3 className="font-bold text-zinc-900">계산 내역</h3>
            <ul className="mt-2 divide-y divide-zinc-100 rounded-card border border-zinc-200 bg-white shadow-card">
              {result.lines.map((line) => (
                <li key={line.key} className="flex items-start justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{line.label}</p>
                    {line.basis ? <p className="mt-0.5 text-xs text-zinc-400">{line.basis}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-zinc-900">
                      {line.unit === "count" ? `${line.amount}건` : formatFiat(line.amount, result.currency)}
                    </p>
                    {line.rate ? <p className="mt-0.5 text-xs text-zinc-500">{line.rate}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          ) : null}

          {selected ? (
            <details className="mt-6 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="확정 상태">
              <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">항목별 확정 상태</summary>
              <ul className="mt-3 grid gap-2">
                {selected.topics.map((topic, index) => (
                  <li key={`${topic.topic}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-800">{TOPIC_LABEL[topic.topic]}</span>
                      <StatusBadge status={topic.status} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{topic.basis}</p>
                    {topic.note ? <p className="mt-1 text-xs text-zinc-400">{topic.note}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}


          {result.openQuestions.length > 0 ? (
            <section className="mt-6" aria-label="판단 필요 항목">
              <h3 className="font-bold text-zinc-900">판단이 필요한 항목</h3>
              <ul className="mt-2 grid gap-2">
                {result.openQuestions.map((question, index) => (
                  <li key={`${question.topic}-${index}`} className="rounded-card border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-amber-900">{TOPIC_LABEL[question.topic]}</span>
                      <StatusBadge status={question.status} />
                    </div>
                    <p className="mt-1 text-sm text-amber-900">{question.reason}</p>
                    {question.benchmark ? (
                      // 확정되면 어떻게 되는지를 접어두면 아무도 보지 않는다. 본문에 둔다.
                      <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs leading-5 text-amber-900">
                        확정되면 → {question.benchmark}
                      </p>
                    ) : null}
                    {question.affectedEventIds.length > 0 ? (
                      <Link
                        href="/dashboard"
                        className="mt-2 inline-flex text-xs font-semibold text-amber-900 underline"
                      >
                        해당 이벤트 {question.affectedEventIds.length}건 보기
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.requiredInputs.length > 0 ? (
            <details className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="추가 입력">
              <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">지갑 데이터 밖에서 필요한 입력</summary>
              <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600">
                {result.requiredInputs.map((input) => <li key={input}>{input}</li>)}
              </ul>
            </details>
          ) : null}


          {ruleNotes.length > 0 ? (
          <details className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 근거">
            <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">계산 근거와 가정</summary>
            <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600">
              {/* 한계는 위 "흔들리는 지점"이 이미 말했다. 여기서 또 말하면
                  같은 문장이 두 곳에 떠서 어느 쪽이 최신인지 알 수 없다. */}
              {ruleNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </details>
          ) : null}

          {/* 연말 시가 입력(의제취득가액) — 룰셋이 요구할 때만(KR). 입력값이 deemedFmv로 estimate에 흘러가 재계산된다.
              448px 셸이므로 표가 아니라 자산별 카드를 세로로 쌓는다. */}
          {requiresYearEndFmv ? (
            <section className="mt-6" aria-label="연말 시가 입력">
              <h3 className="font-bold text-zinc-900">연말 시가 입력 (의제취득가액)</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {result.taxYear >= 2027 || previewingEffectiveYear
                  ? "2027-01-01 전 취득해 계속 보유한 자산은 2026-12-31 시가와 실제 취득가액 중 큰 값을 취득가액으로 씁니다. 자산별 시가를 입력하면 손익이 다시 계산됩니다."
                  : "2026-12-31 시가를 입력해 두면, 시행(2027) 후 계산에서 의제취득가액으로 반영됩니다."}
              </p>
              {yearEndAssets.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">이 기간에 처분한 자산이 없어 입력할 대상이 없습니다.</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {yearEndAssets.map((asset) => (
                    <li key={asset.asset} data-year-end-asset={asset.asset} className="rounded-card border border-zinc-200 bg-white p-3 shadow-card">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-zinc-900">{asset.symbol}</span>
                        <span className="text-xs text-zinc-500">처분 수량 {asset.quantity}</span>
                      </div>
                      <label className="mt-2 block text-sm font-medium text-zinc-700" htmlFor={`fmv-${asset.asset}`}>
                        2026-12-31 시가 (원/단위)
                      </label>
                      <input
                        id={`fmv-${asset.asset}`}
                        inputMode="decimal"
                        placeholder="예: 4000000"
                        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
                        value={yearEndFmv[asset.asset] ?? ""}
                        onChange={(event) => {
                          // 빈 문자열도 허용해야 지울 수 있다. 유효 십진만 상태에 넣는다.
                          if (/^\d*(?:\.\d*)?$/.test(event.target.value)) {
                            setYearEndFmv((prev) => ({ ...prev, [asset.asset]: event.target.value }));
                          }
                        }}
                      />
                      <label className="mt-2 block text-sm font-medium text-zinc-700" htmlFor={`fmv-src-${asset.asset}`}>
                        출처 (선택)
                      </label>
                      <input
                        id={`fmv-src-${asset.asset}`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
                        placeholder="예: 업비트 2026-12-31 종가"
                        value={fmvSource[asset.asset] ?? ""}
                        onChange={(event) => setFmvSource((prev) => ({ ...prev, [asset.asset]: event.target.value }))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* 설정은 답 다음이다. 위에 두면 사용자가 답까지 스크롤해야 한다. */}
        </>
      ) : null}

      <details className="mt-5 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 조건">
        <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">계산 조건 바꾸기</summary>
        <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">이벤트 출처</span>
          {(["scenario", "wallet"] as const).map((option) =>
            // 지갑 미연결 상태에서 "내 지갑 이벤트"는 고를 수 있는 소스가 아니다.
            // 눌러도 소스가 바뀌는 척하지 않고, 실제로 되는 일(지갑 연결)로 보낸다.
            option === "wallet" && !walletConnected ? (
              <Link
                key={option}
                href="/connect-wallet"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-400"
              >
                내 지갑 이벤트 — 연결 필요
              </Link>
            ) : (
              <button
                key={option}
                type="button"
                aria-pressed={source === option}
                className={`rounded-lg border px-3 py-1.5 text-sm ${source === option ? "border-primary-500 text-primary-600" : "border-zinc-300 text-zinc-600"}`}
                onClick={() => setSource(option)}
              >
                {option === "scenario" ? "데모 시나리오" : "내 지갑 이벤트"}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">과세연도</span>
          {taxYearWindow(currentYear, latestActivityYear, effectiveTaxYear).map((year) => (
            <button
              key={year}
              type="button"
              aria-pressed={taxYear === year}
              className={`rounded-lg border px-3 py-1.5 text-sm ${taxYear === year ? "border-primary-500 text-primary-600" : "border-zinc-300 text-zinc-600"}`}
              onClick={() => setTaxYear(year)}
            >
              {year}
              {/* 미래 연도를 아무 표시 없이 끼워 넣으면 사용자는 이미 지난 해로 읽는다. */}
              {year === effectiveTaxYear && year > currentYear ? (
                <span className="ml-1 text-xs text-zinc-500">시행</span>
              ) : null}
            </button>
          ))}
        </div>
        {/* 이 국가가 쓰는 입력만 살린다. 안 쓰는 입력은 숨기지 말고 그렇게 말한다.
            숨기면 사용자는 "왜 안 물어보지?"를 자기 잘못으로 오해한다. */}
        <ProfileInput field="marginalRatePercent" used={usesField} failed={rulesetsFailed} label="한계세율">
          <label className="block text-sm font-medium text-zinc-700" htmlFor="marginal-rate">
            한계세율 {marginalRateDraft}% <span className="text-zinc-400">(지갑 외 소득 반영)</span>
          </label>
          <input
            id="marginal-rate"
            type="range"
            min="0"
            max="55"
            step="1"
            className="mt-2 w-full"
            value={marginalRateDraft}
            // 드래그 중에는 화면 숫자만 따라간다. 매 픽셀 재계산하면 답이 깜빡이고 요청이 쏟아진다.
            onChange={(event) => setMarginalRateDraft(event.target.value)}
            onPointerUp={() => setMarginalRatePercent(marginalRateDraft)}
            onKeyUp={() => setMarginalRatePercent(marginalRateDraft)}
            onBlur={() => setMarginalRatePercent(marginalRateDraft)}
          />
          {marginalRateDraft !== marginalRatePercent ? (
            <p className="mt-1 text-xs text-zinc-500">손을 떼면 {marginalRateDraft}%로 다시 계산합니다.</p>
          ) : null}
        </ProfileInput>

        <ProfileInput field="otherIncome" used={usesField} failed={rulesetsFailed} label="지갑 외 과세소득">
          <label className="block text-sm font-medium text-zinc-700" htmlFor="other-income">지갑 외 과세소득</label>
          <input
            id="other-income"
            inputMode="decimal"
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            value={otherIncomeInput}
            onChange={(event) => {
              if (/^\d*(?:\.\d*)?$/.test(event.target.value)) setOtherIncomeInput(event.target.value);
            }}
          />
        </ProfileInput>

        <ProfileInput field="carriedLosses" used={usesField} failed={rulesetsFailed} label="전년 이월결손금">
          <label className="block text-sm font-medium text-zinc-700" htmlFor="carried-losses">전년 이월결손금</label>
          <input
            id="carried-losses"
            inputMode="decimal"
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            value={carriedLossesInput}
            onChange={(event) => {
              if (/^\d*(?:\.\d*)?$/.test(event.target.value)) setCarriedLossesInput(event.target.value);
            }}
          />
        </ProfileInput>

        <ProfileInput field="filingStatus" used={usesField} failed={rulesetsFailed} label="신고 구분">
          <span className="block text-sm font-medium text-zinc-700">신고 구분</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {(["SINGLE", "JOINT"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filingStatus === option}
                className={`rounded-lg border px-3 py-1.5 text-sm ${filingStatus === option ? "border-primary-500 text-primary-600" : "border-zinc-300 text-zinc-600"}`}
                onClick={() => setFilingStatus(option)}
              >
                {option === "SINGLE" ? "단독" : "부부합산"}
              </button>
            ))}
          </div>
        </ProfileInput>

        <ProfileInput field="isBusiness" used={usesField} failed={rulesetsFailed} label="사업자 구분">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={isBusiness} onChange={(event) => setIsBusiness(event.target.checked)} />
            사업자로 계산
          </label>
        </ProfileInput>

        <ProfileInput field="defiOwnershipTransferred" used={usesField} failed={rulesetsFailed} label="디파이 소유권 이전">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={defiOwnershipTransferred} onChange={(event) => setDefiOwnershipTransferred(event.target.checked)} />
            디파이 예치 시 소유권 이전 인정
          </label>
        </ProfileInput>
        </div>
      </details>
    </main>
  );
}
