import { add, div, isZero, lt, mul, sub, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import type {
  AdjustmentContext,
  AggregateAdjustment,
  GainRow,
  IncomeKind,
  IncomeRow,
  JudgmentRow,
  JudgmentVerdict,
  RuleContext,
  RuleSetDefinition,
  RuleTopic,
  TaxEstimate,
} from "@/lib/tax/types";

/**
 * 건별 판정 조립.
 *
 * 부담액은 과세기간 단위로만 존재한다(손실 상계·면세한계·누진구간이 전부 기간 집계에 걸려 있고,
 * 처분 1건이 lot 매칭으로 여러 손익 행으로 쪼개지기도 한다). 그래서 거래 목록에 붙일 수 있는 것은
 * 부담액이 아니라 "이 손익이 계산에서 어떻게 쓰였는지"라는 판정뿐이다.
 *
 * 판정은 반드시 해당 룰셋의 `compute` 결과에서 파생한다. 조건을 재작성하면 화면과 계산이
 * 서로 다른 이야기를 하게 된다(장기 손실·연간 floor·부인 손실이 실제로 그렇게 갈렸다).
 */

const INCOME_TOPIC: Record<IncomeKind, RuleTopic> = {
  STAKING: "STAKING",
  LENDING: "STAKING",
  AIRDROP: "AIRDROP",
  AIRDROP_INITIAL: "AIRDROP",
  MINING: "STAKING",
  DEFI_REWARD: "DEFI_LP",
};

function topicBasis(ruleset: RuleSetDefinition, topic: RuleTopic, fallback: string): string {
  return ruleset.topics.find((rule) => rule.topic === topic)?.basis ?? fallback;
}

/** 수령 종류에 맞는 근거 조문. 종류를 모르면 스테이킹 조문으로 떨어진다. */
function incomeBasis(ruleset: RuleSetDefinition, incomeKind?: IncomeKind): string {
  const fallback = topicBasis(ruleset, "STAKING", `${ruleset.label} 수령 소득 규정`);
  return incomeKind ? topicBasis(ruleset, INCOME_TOPIC[incomeKind], fallback) : fallback;
}

/** 소득 판정 기본값. 수령 종류에 맞는 topic 근거를 고른다. */
export function defaultIncomeVerdict(row: IncomeRow, ruleset: RuleSetDefinition): JudgmentVerdict {
  return { group: "income", label: "소득 · 과세", basis: incomeBasis(ruleset, row.incomeKind) };
}

/** 집계에서 과세분이 줄어든 이유를 사람이 읽는 말로. */
const ADJUSTMENT_NOTE: Record<AggregateAdjustment, string> = {
  offset: "집계에서 일부 상계됨",
  inclusion: "법정 포함률만 과세",
  discount: "보유기간 할인 적용",
  allowance: "연간 공제 적용",
  floor: "면세 기준 적용",
  ignored: "손실은 상계 불가라 무시됨",
  none: "집계 조정 없음",
};

/** 조정 방식은 과세연도·프로필로 갈릴 수 있다. */
export function resolveAdjustment(ruleset: RuleSetDefinition, context: AdjustmentContext): AggregateAdjustment {
  return typeof ruleset.aggregateAdjustment === "function"
    ? ruleset.aggregateAdjustment(context)
    : ruleset.aggregateAdjustment;
}

/** 룰셋이 이미 같은 사실을 말했으면 덧쓰지 않는다. */
const ADJUSTMENT_WORD_RE = /상계|공제|면세|할인|포함률/;

type Draft = Omit<JudgmentRow, "lots"> & { lots: number };

/**
 * 룰셋이 금액을 재정의했으면 그 값을 쓴다.
 * 재정의는 **이벤트 단위** 금액이므로, 한 처분이 여러 lot 행으로 쪼개졌을 때는
 * 행 수량 비율로 나눠 담아 합계가 원래 이벤트 금액과 같게 만든다.
 */
function applyVerdict(
  fallback: Decimal,
  verdict: JudgmentVerdict,
  row: GainRow,
  siblings: GainRow[],
): JudgmentVerdict & { amount: Decimal } {
  const { amount, ...rest } = verdict;
  if (amount === undefined) return { ...rest, amount: fallback };
  if (siblings.length <= 1) return { ...rest, amount };

  const total = sum(siblings.map((item) => item.quantity));
  // 객체 동일성 대신 위치로 마지막을 판단한다. 마지막 행이 잔차를 흡수해 합계를 보존한다.
  const index = siblings.indexOf(row);
  const isLast = index === siblings.length - 1;
  const shareOf = (item: GainRow) =>
    isZero(total) ? div(amount, String(siblings.length)) : mul(amount, div(item.quantity, total));
  if (!isLast) return { ...rest, amount: shareOf(row) };
  const allocated = sum(siblings.slice(0, -1).map(shareOf));
  return { ...rest, amount: sub(amount, allocated) };
}

/**
 * 같은 이벤트라도 판정 그룹이 갈리면 행을 나눈다.
 * FIFO가 한 매도를 여러 lot으로 쪼개면 과세분과 비과세분이 섞일 수 있고, 그때 한 줄로 뭉개면 거짓이 된다.
 */
function collapse(drafts: Draft[]): JudgmentRow[] {
  const merged = new Map<string, Draft>();
  for (const draft of drafts) {
    const key = `${draft.eventId}::${draft.leg}::${draft.group}::${draft.label}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...draft });
      continue;
    }
    current.amount = add(current.amount, draft.amount);
    // 수량도 반드시 합친다 — 첫 lot 수량만 남기면 "0.25 매도"가 실제 1.0인데도 0.25로 보인다.
    current.quantity = add(current.quantity, draft.quantity);
    current.lots += draft.lots;
    // 근거 4줄도 함께 더한다. 첫 lot 것만 남기면 금액과 근거가 어긋난다.
    if (current.breakdown && draft.breakdown) {
      current.breakdown = {
        proceeds: add(current.breakdown.proceeds, draft.breakdown.proceeds),
        cost: add(current.breakdown.cost, draft.breakdown.cost),
        fee: add(current.breakdown.fee, draft.breakdown.fee),
      };
    }
    if (current.holdingDays !== draft.holdingDays) current.holdingDays = null;
    if (current.acquiredAt !== draft.acquiredAt) current.acquiredAt = null;
    current.inPeriod = current.inPeriod || draft.inPeriod;
  }
  return [...merged.values()];
}

export function buildJudgments(
  ruleset: RuleSetDefinition,
  context: RuleContext,
  estimate: TaxEstimate,
): JudgmentRow[] {
  const { ledger, period } = context;
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const inPeriod = (at: string) => {
    const ms = Date.parse(at);
    return ms >= fromMs && ms < toMs;
  };
  const drafts: Draft[] = [];

  const acquireBasis = topicBasis(ruleset, "CAPITAL_GAINS", `${ruleset.label} 취득원가 규정`);
  const acquireLabel = ruleset.ledger.feeDeductible ? "취득 · 원가 기록" : "취득 · 수수료 불인정";
  // 원장에 소득 행이 없는 수령분(호주 initial allocation 등 zero-basis)은 여기서만 드러난다.
  const incomeEventIds = new Set(ledger.income.map((row) => row.eventId));

  for (const item of ledger.acquisitions) {
    if (item.origin === "INCOME" && incomeEventIds.has(item.sourceEventId)) continue;
    const zeroBasisReceipt = item.zeroBasis;
    const swapIn = item.origin === "SWAP_IN";
    drafts.push({
      eventId: item.sourceEventId,
      at: item.at,
      asset: item.asset,
      symbol: item.symbol,
      quantity: item.quantity,
      amount: item.cost,
      amountKind: "cost",
      holdingDays: null,
      acquiredAt: item.at,
      lots: 1,
      // 과세 교환의 수취분은 처분 이벤트에 딸린 반대편 leg이다.
      leg: swapIn ? "receive" : "single",
      inPeriod: inPeriod(item.at),
      group: "acquire",
      // 과세 교환(cryptoToCryptoTaxable)의 수취분은 처분 시가로 잡은 **새** 취득원가다.
      // "원가 승계"라 하면 비과세 이연 교환처럼 읽힌다 — 원장은 SWAP_IN을 과세일 때만 만든다.
      label: swapIn
        ? "교환 수취 · 새 취득원가"
        : zeroBasisReceipt
          ? "수령 · 비과세, 원가 0"
          : item.origin === "INCOME"
            ? "수령 · 원가 기록"
            : acquireLabel,
      basis: swapIn
        ? topicBasis(ruleset, "CRYPTO_TO_CRYPTO", `${ruleset.label} 교환 규정`)
        : item.origin === "INCOME"
          ? incomeBasis(ruleset, item.incomeKind)
          : acquireBasis,
    });
  }

  // 룰셋이 이벤트 단위 금액을 재정의하면(프랑스 포트폴리오 안분) 행마다 그대로 복사할 수 없다.
  // 한 처분이 여러 lot을 소비하면 collapse가 같은 금액을 n번 더해 총액이 부풀기 때문이다.
  const gainsByEvent = new Map<string, GainRow[]>();
  for (const row of ledger.gains) {
    gainsByEvent.set(row.eventId, [...(gainsByEvent.get(row.eventId) ?? []), row]);
  }

  for (const row of ledger.gains) {
    const verdict = ruleset.judgeGain(row, context, estimate);
    const siblings = gainsByEvent.get(row.eventId) ?? [row];
    drafts.push({
      eventId: row.eventId,
      at: row.at,
      asset: row.asset,
      symbol: row.symbol,
      quantity: row.quantity,
      amountKind: "gain",
      holdingDays: row.holdingDays,
      acquiredAt: row.acquiredAt,
      lots: 1,
      leg: row.trigger === "CRYPTO" ? "dispose" : "single",
      inPeriod: inPeriod(row.at),
      // 금액만 보이고 어떻게 나왔는지 숨기면 사용자가 검증할 수 없다.
      breakdown: { proceeds: row.proceeds, cost: row.cost, fee: row.fee },
      ...applyVerdict(row.gain, verdict, row, siblings),
    });
    // 룰셋이 금액을 재정의하거나(프랑스 포트폴리오 공식) 분할 배분되면
    // 원장 4줄과 최종 금액이 어긋난다. 맞지 않는 근거를 보이면 화면이 자기모순이므로 뗀다.
    const draft = drafts[drafts.length - 1];
    if (
      draft.breakdown &&
      sub(sub(draft.breakdown.proceeds, draft.breakdown.cost), draft.breakdown.fee) !== draft.amount
    ) {
      delete draft.breakdown;
    }
  }

  for (const row of ledger.income) {
    drafts.push({
      eventId: row.eventId,
      at: row.at,
      asset: row.asset,
      symbol: row.symbol,
      quantity: row.quantity,
      amount: row.amount,
      amountKind: "fmv",
      holdingDays: null,
      acquiredAt: row.at,
      lots: 1,
      leg: "single",
      inPeriod: inPeriod(row.at),
      ...(ruleset.judgeIncome?.(row, context, estimate) ?? defaultIncomeVerdict(row, ruleset)),
    });
  }

  const deferredBasis = topicBasis(ruleset, "CRYPTO_TO_CRYPTO", `${ruleset.label} 교환 규정`);
  for (const item of ledger.deferred) {
    drafts.push({
      eventId: item.eventId,
      at: item.at,
      asset: item.asset,
      symbol: item.symbol,
      quantity: item.quantity,
      amount: item.carriedCost,
      amountKind: "carried_cost",
      holdingDays: null,
      acquiredAt: null,
      lots: 1,
      leg: "receive",
      inPeriod: inPeriod(item.at),
      group: "deferred",
      label: "과세 이연 · 처분 아님",
      basis: deferredBasis,
    });
  }

  // 안전망: 행 금액을 그대로 "과세"라고 하면, 집계에서 상계·공제로 줄어든 만큼이
  // 전부 과세된 것처럼 읽힌다. 이유(연간공제 GB·IT, 손익 상계 DE·PT·ES·FR, 포함률 CA,
  // 할인 AU, floor FR)는 룰셋이 lines·notes로 설명하고, 여기서는 **모순만** 막는다.
  // 룰셋별로 흩어 놓으면 12곳이 갈린다 — 한 곳에서 12개 전부를 덮는다.
  const taxableDrafts = drafts.filter((draft) => draft.group === "taxable");
  const taxableSum = sum(taxableDrafts.map((draft) => draft.amount));
  const noTaxableGains = isZero(estimate.totals.taxableGains);
  // 행 합계보다 집계 과세분이 작으면 그 차이만큼 상계·공제된 것이다.
  const reduced = !noTaxableGains && lt(estimate.totals.taxableGains, taxableSum);
  const adjustment = resolveAdjustment(ruleset, { taxYear: context.taxYear, profile: context.profile });
  const guarded = drafts.map((draft) => {
    if (draft.group !== "taxable") return draft;
    if (noTaxableGains) {
      return { ...draft, group: "offset" as const, label: "과세분 없음 · 집계에서 상계·공제 적용" };
    }
    // 원인은 룰셋이 선언한다 — 숫자만 보고 "상계"라 하면
    // 손실이 없는데도 법정 포함률(CA)·보유기간 할인(AU)을 상계라고 거짓 설명한다.
    if (reduced && !ADJUSTMENT_WORD_RE.test(draft.label)) {
      return { ...draft, label: `${draft.label} · ${ADJUSTMENT_NOTE[adjustment]}` };
    }
    return draft;
  });

  return collapse(guarded).sort((left, right) => {
    const delta = Date.parse(left.at) - Date.parse(right.at);
    if (delta !== 0) return delta;
    const byEvent = left.eventId.localeCompare(right.eventId);
    return byEvent !== 0 ? byEvent : left.group.localeCompare(right.group);
  });
}

