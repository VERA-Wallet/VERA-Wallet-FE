"use client";

import Link from "next/link";

import { useReportContext } from "@/components/report/report-context";
import { ReportSubPage } from "@/components/report/report-sub-page";
import type { ProfileField } from "@/lib/tax/types";
import { taxYearWindow } from "@/lib/tax/year-window";

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
  /** 계산 기준 조회 자체가 실패한 상태. 진행 중이라고 말하면 거짓이다. */
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
        {state !== null ? "해당 국가 미적용" : failed ? "계산 기준 조회 실패" : "계산 기준 확인 중"}
      </span>
    </div>
  );
}

/**
 * 계산 설정 — 이 답이 서 있는 입력들.
 *
 * 메인에서는 전부 접혀 있었다. 이 화면은 그 주제 자체이므로 펼쳐 둔다.
 * 여기서 바꾼 값은 같은 프로바이더의 estimate 하나로 흘러가므로, 메인으로 돌아가면
 * 예상 부담과 내려받기 파일이 그 값으로 계산돼 있다.
 *
 * 과세연도 버튼은 메인의 귀속연도 칩과 같은 전역 소스(TaxYearProvider)를 쓴다 — 두 자리가
 * 각자 연도를 갖는 것이 아니라, 같은 값을 두 곳에서 바꿀 수 있는 것이다.
 */
export function ReportSettings() {
  const {
    result,
    rulesetsFailed,
    usesField,
    requiresYearEndFmv,
    yearEndAssets,
    yearEndFmv,
    setYearEndFmv,
    fmvSource,
    setFmvSource,
    previewingEffectiveYear,
    currentYear,
    latestActivityYear,
    effectiveTaxYear,
    taxYear,
    setTaxYear,
    source,
    setSource,
    walletConnected,
    marginalRateDraft,
    setMarginalRateDraft,
    marginalRatePercent,
    commitMarginalRate,
    otherIncomeInput,
    setOtherIncomeInput,
    carriedLossesInput,
    setCarriedLossesInput,
    filingStatus,
    setFilingStatus,
    isBusiness,
    setIsBusiness,
    defiOwnershipTransferred,
    setDefiOwnershipTransferred,
  } = useReportContext();

  return (
    <ReportSubPage
      surface="report-settings"
      title="계산 설정"
      lede="설정을 변경하면 예상 세금과 내려받기 자료에 반영됩니다."
    >
      <section className="mt-6 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 조건">
        <h2 className="font-bold text-zinc-900">계산 조건</h2>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">거래 자료</span>
            {(["scenario", "wallet"] as const).map((option) =>
              // 지갑 미연결 상태에서 "내 지갑 이벤트"는 고를 수 있는 소스가 아니다.
              // 눌러도 소스가 바뀌는 척하지 않고, 실제로 되는 일(지갑 연결)로 보낸다.
              option === "wallet" && !walletConnected ? (
                <Link
                  key={option}
                  href="/connect-wallet"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-400"
                >
                  연결 지갑 거래 · 연결 필요
                </Link>
              ) : (
                <button
                  key={option}
                  type="button"
                  aria-pressed={source === option}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${source === option ? "border-primary-500 text-primary-600" : "border-zinc-300 text-zinc-600"}`}
                  onClick={() => setSource(option)}
                >
                  {option === "scenario" ? "예제 데이터" : "연결 지갑 거래"}
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
              onPointerUp={commitMarginalRate}
              onKeyUp={commitMarginalRate}
              onBlur={commitMarginalRate}
            />
            {marginalRateDraft !== marginalRatePercent ? (
              <p className="mt-1 text-xs text-zinc-500">조절을 마치면 {marginalRateDraft}%를 적용하여 다시 계산합니다.</p>
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
      </section>

      {result && result.requiredInputs.length > 0 ? (
        <section className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="추가 입력">
          <h2 className="font-bold text-zinc-900">추가 확인 정보</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600">
            {result.requiredInputs.map((input) => <li key={input}>{input}</li>)}
          </ul>
        </section>
      ) : null}

      {/* 연말 시가 입력(의제취득가액) — 룰셋이 요구할 때만(KR). 입력값이 deemedFmv로 estimate에 흘러가 재계산된다.
          448px 셸이므로 표가 아니라 자산별 카드를 세로로 쌓는다. */}
      {result && requiresYearEndFmv ? (
        <section className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="연말 시가 입력">
          <h2 className="font-bold text-zinc-900">연말 시가 입력 (의제취득가액)</h2>
          <p className="mt-2 text-sm text-zinc-500">
            {result.taxYear >= 2027 || previewingEffectiveYear
              ? "2027-01-01 전 취득해 계속 보유한 자산은 2026-12-31 시가와 실제 취득가액 중 큰 금액을 취득가액으로 적용합니다. 자산별 시가를 입력하면 손익이 다시 계산됩니다."
              : "2026-12-31 시가를 입력해 두면, 시행(2027) 후 계산에서 의제취득가액으로 반영됩니다."}
          </p>
          {yearEndAssets.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">이 기간에 처분한 자산이 없어 입력할 대상이 없습니다.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3">
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

      {/* 계산 방식·통화·근거 조문 — 리포트가 어떤 전제로 만들어졌는지. 값은 estimate에서만 읽는다. */}
      {result ? (
        <section className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="계산 설정">
          <h2 className="font-bold text-zinc-900">계산 설정</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="text-zinc-500">계산 방식</dt>
              <dd className="text-right font-medium text-zinc-900">{result.method}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="text-zinc-500">통화·국가</dt>
              <dd className="text-right font-medium text-zinc-900">{result.currency} · {result.countryLabel}</dd>
            </div>
            {(() => {
              // 근거 조문은 룰셋이 lines에 실어 준 basis에서만 모은다. 없으면 그 줄 자체를 생략한다.
              const bases = [...new Set(result.lines.map((line) => line.basis).filter((basis): basis is string => Boolean(basis)))];
              return bases.length > 0 ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-zinc-500">근거 조문</dt>
                  <dd className="text-right font-medium text-zinc-900">{bases.join(" · ")}</dd>
                </div>
              ) : null;
            })()}
          </dl>
        </section>
      ) : null}
    </ReportSubPage>
  );
}
