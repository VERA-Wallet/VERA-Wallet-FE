"use client";

import { useState } from "react";

import { fresh } from "@/lib/queries/fresh";
import { useRuleSets, useTaxEstimate } from "@/lib/queries/tax";
import type { TaxEventSource } from "@/lib/ports/tax-engine";
import type { Decimal } from "@/lib/tax/decimal";
import { add } from "@/lib/tax/decimal";
import { canonicalCountryCode } from "@/lib/tax/rulesets";
import { useTaxYear } from "@/lib/tax/tax-year-context";
import type { ProfileField, RuleSetSummary, TaxpayerProfile } from "@/lib/tax/types";

/**
 * 리포트 화면(`/export`)의 추정 입력을 한 곳에 모은다.
 *
 * 예전에는 세금 화면이 프로필·연말 시가·시행 가정을 실은 추정을, 내보내기 화면이 나라·연도·시행 가정만
 * 실은 추정을 각각 냈다. 두 화면이 하나가 되면 **같은 화면이 두 금액을 말할 수 있다** —
 * 리포트 카드와 "왜 이 금액인가"가 서로 다른 계산에서 나오기 때문이다.
 * 그래서 입력도 결과도 여기 하나뿐이다. 연말 시가를 입력하면 리포트 카드·근거가 함께 바뀐다.
 */

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

/**
 * 거주국 룰셋이 아직 없으면 데모 1순위인 독일로 연다.
 * 화면을 비워두고 사용자가 고르게 하면 "진입 즉시 답"이 아니다.
 */
export const FALLBACK_COUNTRY = "DE";

export type ReportInputsOptions = {
  countryCode?: string;
  currentYear?: number;
  latestActivityYear?: number;
  walletConnected?: boolean;
};

export function useReportInputs({
  countryCode,
  currentYear = new Date().getFullYear(),
  latestActivityYear,
  walletConnected = true,
}: ReportInputsOptions) {
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
  // 시행 전 룰셋(한국 2027)을 "시행됐다고 가정하고" 볼지.
  // `null`은 "사용자가 아직 고르지 않음"이다 — 그때는 시행 예정 룰셋의 시행 전 연도에서 가정을 켠 채로 연다.
  // 시행 전이라는 사실만 보이면 화면이 계산 결과 없이 0원 하나로 끝나기 때문이다(2026-09-17 사용자 결정).
  // 끄는 문은 그대로 남는다 — 끄면 그 해의 사실(부담 0원)로 돌아간다.
  const [assumeEffectiveChoice, setAssumeEffectiveChoice] = useState<boolean | null>(null);
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
  // 시행일이 아직 오지 않은 룰셋(한국 2027)은 그 해를 미리 고를 수 있어야 한다.
  // 고를 수 없으면 사용자는 "시행되면 얼마인가"를 이 화면에서 끝내 알 수 없다.
  const effectiveTaxYear = selected?.effectiveTaxYear;
  // 고른 해가 시행 전일 때만 "가정"이 성립한다. 시행 후를 보면 그건 가정이 아니라 규칙이다.
  const canAssumeEffective = effectiveTaxYear !== undefined && taxYear < effectiveTaxYear;
  const assumeEffective = canAssumeEffective && (assumeEffectiveChoice ?? true);

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
  // 판정 행이 하나도 없으면 계산에 들어간 거래가 없다는 뜻이다.
  // 제외된 이벤트만 있는 경우도 여기에 걸린다 — 그건 "0원"이 아니라 "셀 것이 없음"이다.
  // 취득은 원가 추적 때문에 기간 밖에서도 남는다(engine.ts가 의도적으로 남긴다).
  // 그걸 세면 "이번 기간에 셀 것이 없음"이 영영 걸리지 않는다.
  const hasNothingToCompute =
    result !== undefined && !result.judgments.some((row) => row.inPeriod && row.group !== "acquire");
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
  const previewingEffectiveYear =
    effectiveTaxYear !== undefined && effectiveTaxYear > currentYear && taxYear >= effectiveTaxYear;

  return {
    countryCode,
    currentYear,
    latestActivityYear,
    walletConnected,
    country,
    setCountry,
    homeCountry,
    isHomeCountry,
    taxYear,
    setTaxYear,
    source,
    setSource,
    assumeEffective,
    canAssumeEffective,
    setAssumeEffective: setAssumeEffectiveChoice,
    marginalRatePercent,
    marginalRateDraft,
    setMarginalRateDraft,
    commitMarginalRate: () => setMarginalRatePercent(marginalRateDraft),
    filingStatus,
    setFilingStatus,
    carriedLossesInput,
    setCarriedLossesInput,
    otherIncomeInput,
    setOtherIncomeInput,
    isBusiness,
    setIsBusiness,
    defiOwnershipTransferred,
    setDefiOwnershipTransferred,
    yearEndFmv,
    setYearEndFmv,
    fmvSource,
    setFmvSource,
    rulesets,
    selected,
    rulesetsFailed,
    usesField,
    freshEstimate,
    result,
    headerNote,
    ruleNotes,
    hasNothingToCompute,
    yearEndAssets,
    requiresYearEndFmv,
    effectiveTaxYear,
    openedOnPastYear,
    previewingEffectiveYear,
  };
}

export type ReportInputs = ReturnType<typeof useReportInputs>;
