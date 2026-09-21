import { ZERO, add, clampPositive, isNegative, isPositive, isZero, min, percentOf, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { finalizeEstimate } from "@/lib/tax/estimate";
import { COST_METHOD_SUFFIX, DEEMED_COST_SUFFIX, RECEIPT_COST_SUFFIX, limitationOf } from "@/lib/tax/limitations";
import type { GainRow, IncomeRow, JudgmentVerdict, Limitation, RuleSetDefinition, TaxEvent } from "@/lib/tax/types";

/**
 * 한국 — 가상자산 양도·대여 기타소득(분리과세).
 *
 * 과세 대상은 **양도 또는 대여**로 발생하는 소득뿐이다(소득세법 제21조제1항제27호).
 * 스테이킹·에어드랍처럼 양도도 대여도 아닌 수령분은 명문 규정이 없어 계산에 넣지 않고 판정을 보류한다.
 * 시행일(2027-01-01) 전 과세기간은 "규칙 미확정"이 아니라 **과세 대상 아님**이다 — 둘을 구분한다.
 */

/** 2027-01-01 이후 양도·대여분부터 과세한다. */
const EFFECTIVE_TAX_YEAR = 2027;
/** 의제취득가액 기준 시각 — 2026-12-31 24시(= 2027-01-01 0시)의 시가. */
const DEEMED_COST_BOUNDARY = "2027-01-01T00:00:00.000Z";
/** 기본공제(과세최저한) 연 250만원. */
const BASIC_DEDUCTION = "2500000";
/** 분리과세 세율. */
const RATE = "20";
/** 개인지방소득세 — 소득세분의 10%(합계 실효 22%). */
const LOCAL_SURTAX_RATE = "10";

const BASIS_TRANSFER = "소득세법 제21조제1항제27호 (양도·대여 기타소득)";
const BASIS_COST = "소득세법 제37조제1항제3호 · 시행령 제88조제1항 (거주자별 총평균법)";
const BASIS_CHARGE = "소득세법 제64조의3제2항 (기본공제 250만원 · 세율 20%)";
const BASIS_EFFECTIVE = "소득세법 부칙 (2027.1.1 이후 양도·대여분부터 적용)";
const BASIS_SWAP = "소득세법 시행령 제88조제3항 (기축가상자산 가액 × 교환비율)";
const BASIS_DEEMED = "소득세법 제37조제5항 · 시행령 제88조제2항 (의제취득가액)";
/** 수령분은 조문이 없다. 없는 근거를 지어내지 않고 없다는 사실을 근거로 쓴다. */
const BASIS_RECEIPT = "양도·대여 외 수령분(스테이킹·에어드랍) 과세 규정 부재";

const NOT_YET_EFFECTIVE: JudgmentVerdict = {
  group: "exempt",
  label: "과세 대상 아님 · 2027 시행 전",
  basis: BASIS_EFFECTIVE,
};

/**
 * 이 과세기간에 시행 후 규칙을 적용하는가.
 * `assumeEffective`는 화면이 "시행됐다고 가정하고 보기"를 켰다는 뜻이다 —
 * 계산은 시행 후와 완전히 같고, 가정이라는 사실은 결과가 `notes`로, 화면이 배너로 계속 말한다.
 */
function applies(taxYear: number, assumeEffective: boolean): boolean {
  return taxYear >= EFFECTIVE_TAX_YEAR || assumeEffective;
}

/** 법이 열거한 과세 대상은 양도와 대여뿐이다. */
function isTaxableIncome(row: IncomeRow): boolean {
  return row.incomeKind === "LENDING";
}

/**
 * 시행 경계(2027-01-01) 전에 취득해 **계속 보유한** 자산 목록.
 *
 * 총평균법은 취득일을 특정하지 않아 처분 행(acquiredAt=null)으로는 의제취득가액 대상을 알 수 없다.
 * 대신 원본 이벤트로 경계 전 순보유(취득·수령 − 처분)를 자산별로 세어, 보유분이 남은 자산을 신호로 쓴다.
 * 이 자산에 2026-12-31 시가가 입력되면 seed가 Max(시가, 실제)를 반영하고, 미입력이면 정직한 한계를 낸다.
 */
function assetsHeldBeforeBoundary(events: TaxEvent[]): string[] {
  const boundary = Date.parse(DEEMED_COST_BOUNDARY);
  const net = new Map<string, Decimal>();
  const bump = (asset: string, qty: Decimal) => net.set(asset, add(net.get(asset) ?? ZERO, qty));
  for (const event of events) {
    if (Date.parse(event.at) >= boundary) continue;
    if (event.kind === "ACQUIRE" || event.kind === "INCOME") bump(event.asset, event.quantity);
    else if (event.kind === "DISPOSE") {
      bump(event.asset, sub(ZERO, event.quantity));
      // 과세 교환의 수취분도 seed의 acquisitionSchedule과 같게 취득으로 센다.
      if (event.receives) bump(event.receives.asset, event.receives.quantity);
    }
  }
  return [...net.entries()].filter(([, qty]) => isPositive(qty)).map(([asset]) => asset);
}

export const korea: RuleSetDefinition = {
  code: "KR",
  label: "한국",
  currency: "KRW",
  cost_basis: "resident_total_average",
  badge_label: "KR 기타소득 20% · 2027 시행",
  demoPriority: null,
  // 법률은 확정됐고 시행일만 남았다.
  status: "SCHEDULED",
  effectiveTaxYear: EFFECTIVE_TAX_YEAR,
  profileFields: [],
  // 시행 후에는 연 250만원 기본공제가 과세분을 줄인다. 시행 전에는 조정이라 부를 것이 없다.
  aggregateAdjustment: ({ taxYear, assumeEffective }) =>
    applies(taxYear, assumeEffective ?? false) ? "allowance" : "none",
  ledger: {
    // 시행령 제88조제1항: 거주자별 총평균법. 그 사람의 전체(주소·지갑 무관)를 통산해
    // 자산별 단일 평균단가를 낸다 — GLOBAL scope가 인별 통산을 뜻한다.
    method: "PERIOD_AVERAGE",
    scope: "GLOBAL",
    cryptoToCryptoTaxable: true,
    carryHoldingPeriod: false,
    // 취득·양도 부대비용은 필요경비로 인정된다.
    feeDeductible: true,
    zeroBasisIncomeKinds: [],
    // 경계 전 보유분은 Max(2026-12-31 시가, 실제 취득단가)로 의제한다. 시가가 입력된 자산만 반영.
    deemedCostBoundary: DEEMED_COST_BOUNDARY,
  },
  topics: [
    { topic: "CAPITAL_GAINS", status: "SCHEDULED", basis: BASIS_TRANSFER, note: "2027.1.1 이후 양도·대여분부터 기타소득 분리과세 20%" },
    { topic: "CRYPTO_TO_CRYPTO", status: "SCHEDULED", basis: BASIS_SWAP, note: "교환도 양도. 기축가상자산 가액에 교환비율 적용" },
    { topic: "LOSS_OFFSET", status: "PARTIAL", basis: BASIS_TRANSFER, note: "연간 손익 통산은 확정, 이월공제 규정은 부재" },
    { topic: "STAKING", status: "UNDETERMINED", basis: BASIS_RECEIPT },
    { topic: "AIRDROP", status: "UNDETERMINED", basis: BASIS_RECEIPT },
    { topic: "DEFI_LP", status: "UNDETERMINED", basis: "명문 규정 부재" },
    { topic: "WRAPPING", status: "UNDETERMINED", basis: "명문 규정 부재" },
  ],
  judgeGain(row: GainRow, context, estimate): JudgmentVerdict {
    if (!applies(context.taxYear, context.assumeEffective)) return NOT_YET_EFFECTIVE;
    if (isNegative(row.gain)) {
      return { group: "carry", label: "손실 · 연간 통산(이월 불가)", basis: BASIS_TRANSFER };
    }
    // 기본공제·통산은 연간 집계에만 존재한다. 건별로 배분할 법정 규칙이 없으므로 집계 결과에서 파생한다.
    if (isPositive(row.gain) && isZero(estimate.totals.taxableGains)) {
      return isZero(estimate.totals.exemptGains)
        ? { group: "offset", label: "과세분 없음 · 연간 손익 통산", basis: BASIS_TRANSFER }
        : { group: "exempt", label: "비과세 · 기본공제 250만원 내", basis: BASIS_CHARGE };
    }
    return { group: "taxable", label: "과세 · 기타소득 20%", basis: BASIS_CHARGE };
  },
  judgeIncome(row: IncomeRow, context): JudgmentVerdict {
    if (!applies(context.taxYear, context.assumeEffective)) return NOT_YET_EFFECTIVE;
    return isTaxableIncome(row)
      ? { group: "income", label: "소득 · 대여 대가 과세", basis: BASIS_TRANSFER }
      : { group: "pending", label: "판정 보류 · 명문 규정 부재", basis: BASIS_RECEIPT };
  },

  compute({ ledger, events, deemedCost, taxYear, excludedEventIds, assumeEffective }) {
    const netGains = sum(ledger.gains.map((row) => row.gain));
    const lendingRows = ledger.income.filter(isTaxableIncome);
    const pendingRows = ledger.income.filter((row) => !isTaxableIncome(row));
    const lendingIncome = sum(lendingRows.map((row) => row.amount));
    const pendingIncome = sum(pendingRows.map((row) => row.amount));
    const counts = [
      { key: "disposal_count", label: "처분 건수", amount: String(ledger.gains.length), unit: "count" as const },
      { key: "income_count", label: "수령 건수", amount: String(ledger.income.length), unit: "count" as const },
    ];
    const receiptQuestion = {
      topic: "STAKING" as const,
      status: "UNDETERMINED" as const,
      reason: "스테이킹·에어드랍 수령분은 양도·대여가 아니어서 과세 규정이 없습니다(수령 시 과세인지 매도 시 일괄 과세인지 미확정).",
      affectedEventIds: pendingRows.map((row) => row.eventId),
      benchmark: "수령 시 과세면 독일·미국 모델, 매도 시 일괄 과세면 포르투갈 장기면세 모델을 이식합니다.",
    };
    const carryQuestion = {
      topic: "LOSS_OFFSET" as const,
      status: "PARTIAL" as const,
      reason: "연간 손익 통산은 확정됐지만 이월공제 규정이 없어 남은 손실을 다음 해로 넘기지 않았습니다.",
      affectedEventIds: [],
      benchmark: "이월이 허용되면 포르투갈·독일의 이월 구조를 그대로 씁니다.",
    };
    const requiredInputs = [
      "2026-12-31 24시 기준 가상자산별 시가 (의제취득가액)",
    ];

    if (!applies(taxYear, assumeEffective)) {
      // 시행 전이다. 규칙을 몰라서가 아니라 과세 대상이 아니어서 부담이 0이다 — 그 둘을 같은 말로 쓰지 않는다.
      return finalizeEstimate({
        country: "KR",
        countryLabel: "한국",
        currency: "KRW",
        taxYear,
        method: `원장 집계만 수행 (${EFFECTIVE_TAX_YEAR}년 시행 전)`,
        status: "SCHEDULED",
        taxableGains: ZERO,
        exemptGains: clampPositive(netGains),
        incomeTotal: ZERO,
        taxableBase: ZERO,
        estimatedCharge: ZERO,
        lines: [
          { key: "ledger_gains", label: "원장 기준 처분 손익 (과세 대상 아님)", amount: netGains, basis: BASIS_EFFECTIVE },
          { key: "ledger_income", label: "원장 기준 수령분 FMV (과세 대상 아님)", amount: add(lendingIncome, pendingIncome), basis: BASIS_EFFECTIVE },
          ...counts,
        ],
        notes: [
          `가상자산 양도·대여 소득은 ${EFFECTIVE_TAX_YEAR}-01-01 이후 발생분부터 과세되므로 ${taxYear}년 발생분은 과세 대상이 아닙니다.`,
          "시행 후에는 연간 손익을 통산해 250만원을 공제한 뒤 20%(지방소득세 포함 22%)로 분리과세합니다.",
          `${EFFECTIVE_TAX_YEAR}-01-01 전에 취득해 계속 보유한 분의 취득가액은 2026-12-31 시가와 실제 취득가액 중 큰 금액이 됩니다.`,
          ...ledger.warnings,
        ],
        limitations: ledger.limitations,
        openQuestions: [
          {
            topic: "CAPITAL_GAINS",
            status: "SCHEDULED",
            reason: `시행일(${EFFECTIVE_TAX_YEAR}-01-01) 전이라 부담을 산출하지 않았습니다. 같은 원장에 시행 후 규칙이 그대로 적용됩니다.`,
            affectedEventIds: ledger.gains.map((row) => row.eventId),
          },
          receiptQuestion,
          carryQuestion,
        ],
        requiredInputs,
        excludedEventIds,
      });
    }

    // 시행 후 규칙을 시행 전 과세기간에 적용했는가. 결과가 그 사실을 스스로 말해야 한다.
    const assumed = taxYear < EFFECTIVE_TAX_YEAR;
    // 총수입금액(양도·대여) − 필요경비는 원장이 이미 반영했다. 여기서는 연간 통산·공제·세율만 적용한다.
    const grossIncome = add(netGains, lendingIncome);
    const deduction = min(clampPositive(grossIncome), BASIC_DEDUCTION);
    const taxBase = clampPositive(sub(grossIncome, BASIC_DEDUCTION));
    const incomeTax = percentOf(taxBase, RATE);
    const localTax = percentOf(incomeTax, LOCAL_SURTAX_RATE);
    // 과세표준 중 양도손익 몫. 공제는 소득금액 전체에서 빠지므로 양도차익을 넘지 않게 자른다.
    const taxableGains = min(taxBase, clampPositive(netGains));
    const exemptGains = sub(clampPositive(netGains), taxableGains);

    // 의제취득가액 신호는 처분 행(acquiredAt=null)이 아니라 seed 계층과 같은 원본 이벤트에서 온다.
    const heldPreAssets = assetsHeldBeforeBoundary(events);
    // 경계 전 보유분이 있는데 그 자산 시가가 미입력이면 seed가 실제 취득단가를 그대로 써 손익이 과대될 수 있다.
    const missingFmvAssets = heldPreAssets.filter((asset) => deemedCost?.(asset) === undefined);
    const deemedRows = ledger.gains.filter((row) => missingFmvAssets.includes(row.asset));
    // MUST FIX 4: 원장은 조회 연도 기간말까지 누적 취득을 매년 다시 평균낸다(engine.ts). 시행 첫해(2027)만 정확하고,
    // 그 이후 연도는 의제 opening이 다년에 걸쳐 재희석된다 — 연도별 종료 풀을 잇는 재풀링은 후속 과제다.
    const multiYearRepool = taxYear > EFFECTIVE_TAX_YEAR && heldPreAssets.length > 0;
    const limitations: Limitation[] = [
      ...ledger.limitations,
      // 없는 대상에 대해 "반영하지 못했다"고 말하면, 흔들리지 않는 답을 흔들린다고 하는 것이다.
      ...(deemedRows.length > 0
        ? [limitationOf(`시행일 전 취득분을 소비한 처분 ${deemedRows.length}건.${DEEMED_COST_SUFFIX}`, [])]
        : []),
      ...(pendingRows.length > 0
        ? [limitationOf(`판정 보류 수령분 ${pendingRows.length}건.${RECEIPT_COST_SUFFIX}`, [])]
        : []),
      // 구현 E: 다중 출처 통산 전이라 총평균 분모가 상시 부분집계다. 예상 부담을 0으로 억제하지 않고
      // (억제하면 marginalContributions가 0으로 붕괴되고 화면이 부담 자체를 감춘다) 잠정치로 표기한다.
      limitationOf(`취득가액 통산.${COST_METHOD_SUFFIX}`, []),
    ];

    return finalizeEstimate({
      country: "KR",
      countryLabel: "한국",
      currency: "KRW",
      // 세율·공제는 확정이지만 의제취득가액 시가와 필요경비 의제 비율은 시행령 위임이 남아 있다.
      // 가정 계산도 같은 상태로 낸다 — SCHEDULED로 내리면 화면이 부담을 감춰 가정 자체가 보이지 않는다.
      status: "PARTIAL",
      taxYear,
      method: assumed
        ? `거주자별 총평균법 · ${EFFECTIVE_TAX_YEAR} 시행 가정`
        : "거주자별 총평균법",
      taxableGains,
      exemptGains,
      incomeTotal: lendingIncome,
      taxableBase: taxBase,
      estimatedCharge: add(incomeTax, localTax),
      // 이월공제 규정이 없다. 남은 손실을 넘기면 없는 제도를 있는 것처럼 말하게 된다.
      lossCarryforward: ZERO,
      lines: [
        { key: "net_gains", label: "양도·교환 손익 (연간 통산)", amount: netGains, basis: BASIS_COST },
        { key: "lending_income", label: "대여 대가", amount: lendingIncome, basis: BASIS_TRANSFER },
        { key: "pending_income", label: "판정 보류 수령분 (계산 제외)", amount: pendingIncome, basis: BASIS_RECEIPT },
        { key: "basic_deduction", label: "기본공제 (과세최저한)", amount: deduction, rate: "연 250만원", basis: BASIS_CHARGE },
        { key: "tax_base", label: "과세표준", amount: taxBase, basis: BASIS_CHARGE },
        { key: "income_tax", label: "소득세 (분리과세)", amount: incomeTax, rate: `${RATE}%`, basis: BASIS_CHARGE },
        { key: "local_tax", label: "개인지방소득세", amount: localTax, rate: `소득세분의 ${LOCAL_SURTAX_RATE}%`, basis: "지방세법 (개인지방소득세)" },
        ...counts,
      ],
      notes: [
        // 가정이라는 사실이 결과 안에도 있어야 한다. 화면 배너만 믿으면 내보내기·API 응답에서 사라진다.
        ...(assumed
          ? [
              `${taxYear}년은 아직 시행 전입니다. 아래는 ${EFFECTIVE_TAX_YEAR}-01-01 시행 규칙을 그대로 적용했다고 가정한 값이며, 실제 부담은 0원입니다.`,
            ]
          : []),
        "양도·대여 소득만 과세 대상입니다. 스테이킹·에어드랍 수령분은 규정이 없어 총수입금액에 넣지 않았습니다.",
        "연간 손익을 통산해 250만원을 공제한 뒤 20%를 적용하고, 개인지방소득세 10%를 더했습니다(합계 22%).",
        "손실 이월공제 규정이 없어 통산 후 남은 손실은 다음 해로 넘기지 않았습니다.",
        // 구현 E: 다중 출처 통산은 후속 과제다. 총평균 분모가 부분집계라 예상 부담은 잠정치임을 결과 안에서 말한다.
        "여러 출처(거래소·지갑)를 아직 통산하지 못해 거주자별 총평균 분모가 부분집계입니다. 예상 부담은 잠정치이며 실제와 다를 수 있습니다.",
        "다음연도 5월 1일~31일 종합소득세 신고기간에 분리과세 기타소득으로 신고합니다. (소득세법 제70조제2항)",
        // 경계 전 보유분이 실제로 있으면 "대상 없음"을 말하지 않는다. 시가 입력 여부로만 갈린다.
        missingFmvAssets.length > 0
          ? `${EFFECTIVE_TAX_YEAR}-01-01 전 취득해 계속 보유한 분이 있어 의제취득가액(2026-12-31 시가와 실제 취득가액 중 큰 금액)을 적용해야 하나, 시가가 입력되지 않아 실제 취득가액으로 계산했습니다.`
          : heldPreAssets.length > 0
            ? `${EFFECTIVE_TAX_YEAR}-01-01 전 취득해 계속 보유한 분에 의제취득가액(2026-12-31 시가와 실제 취득가액 중 큰 금액)을 반영했습니다.`
            : `${EFFECTIVE_TAX_YEAR}-01-01 전 취득해 계속 보유한 분이 없어 의제취득가액을 적용할 대상이 없습니다.`,
        // MUST FIX 4: 시행 첫해(2027)만 정확하다. 이후 연도는 누적 평균을 매년 재산정해 의제 opening이 재희석됨을 명시한다.
        ...(multiYearRepool
          ? [
              `${taxYear}년은 시행 첫 과세연도(${EFFECTIVE_TAX_YEAR}) 이후입니다. 현재 계산은 조회 연도 기간말까지 누적 취득을 매년 다시 평균내며, 의제취득가액 opening이 다년에 걸쳐 재희석됩니다. 연도별 종료 풀을 다음 해로 잇는 재풀링은 후속 과제입니다.`,
            ]
          : []),
        ...ledger.warnings,
      ],
      limitations,
      openQuestions: [
        // 시가가 입력되면 seed가 이미 Max(시가, 실제)를 반영하므로 이 미결 질문은 사라진다.
        ...(missingFmvAssets.length > 0
          ? [
              {
                topic: "CAPITAL_GAINS" as const,
                status: "PARTIAL" as const,
                reason: `${BASIS_DEEMED}. 기준이 되는 2026-12-31 시가(시가고시가상자산사업자 공시가 평균)를 지갑 데이터만으로는 알 수 없습니다.`,
                affectedEventIds: deemedRows.map((row) => row.eventId),
                benchmark: "시가가 입력되면 취득가액을 Max(시가, 실제 취득가액)로 올려 손익이 줄어듭니다.",
              },
            ]
          : []),
        {
          topic: "CRYPTO_TO_CRYPTO",
          status: "PARTIAL",
          reason: "교환 대가는 기축가상자산 가액에 교환비율을 적용해야 하나, 목 가격원은 기축가상자산 시세를 구분하지 않습니다.",
          affectedEventIds: ledger.gains.filter((row) => row.trigger === "CRYPTO").map((row) => row.eventId),
        },
        // MUST FIX 4: 다년 재풀링 미구현을 미결 질문으로 남긴다(현재 동작은 시행 첫해 기준으로만 정확).
        ...(multiYearRepool
          ? [
              {
                topic: "CAPITAL_GAINS" as const,
                status: "PARTIAL" as const,
                reason: `누적 총평균을 과세연도마다 재산정하므로 ${EFFECTIVE_TAX_YEAR} 이후 연도는 의제취득가액 opening이 재희석됩니다. 연도별 종료 풀을 다음 해로 잇는 재풀링은 아직 구현되지 않았습니다.`,
                affectedEventIds: ledger.gains.map((row) => row.eventId),
              },
            ]
          : []),
        receiptQuestion,
        carryQuestion,
      ],
      requiredInputs,
      excludedEventIds,
    });
  },
};
