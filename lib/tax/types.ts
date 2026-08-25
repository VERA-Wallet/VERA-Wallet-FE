import type { Decimal } from "@/lib/tax/decimal";

/** PDF PART 1 기준 룰셋 보유 국가 + 벤치마크 대상인 KR. */
export type CountryCode = "DE" | "US" | "IN" | "PT" | "GB" | "AU" | "FR" | "IT" | "ES" | "CA" | "JP" | "KR";

/**
 * 법적 확정 상태.
 * CONFIRMED   확정·시행중
 * SCHEDULED   확정·시행예정 (개정 확정, 시행일 도래 전)
 * PARTIAL     부분확정 (체계는 있으나 산정 지침 미비)
 * UNDETERMINED 미확정 (명문 규정 부재)
 *
 * 추정 결과(`TaxEstimate.status`)에 실린 `SCHEDULED`는 **이 과세기간이 시행일 전**이라는 뜻이며,
 * 그때 totals는 전부 0이다. 규칙을 몰라서 0인 `UNDETERMINED`와 구분한다(`lib/tax/status.ts`).
 */
export type ConfirmationStatus = "CONFIRMED" | "SCHEDULED" | "PARTIAL" | "UNDETERMINED";

export type RuleTopic =
  | "CAPITAL_GAINS"
  | "STAKING"
  | "AIRDROP"
  | "CRYPTO_TO_CRYPTO"
  | "DEFI_LP"
  | "WRAPPING"
  | "LOSS_OFFSET";

export type TopicRule = {
  topic: RuleTopic;
  status: ConfirmationStatus;
  /** 1차 법령·행정해석 근거. 화면과 감사 로그에 그대로 노출한다. */
  basis: string;
  note?: string;
};

export type IncomeKind = "STAKING" | "LENDING" | "AIRDROP" | "AIRDROP_INITIAL" | "MINING" | "DEFI_REWARD";

/** 처분 트리거. 크립토→크립토 과세 여부가 국가별로 갈리므로 원인을 보존한다. */
export type DisposalTrigger = "FIAT" | "GOODS" | "CRYPTO";

export type TaxEventBase = {
  id: string;
  /** RFC 3339 UTC. */
  at: string;
  wallet: string;
  /** `${chainId}:${contract|native}` 형태의 자산 키. */
  asset: string;
  symbol: string;
  quantity: Decimal;
};

export type AcquireEvent = TaxEventBase & {
  kind: "ACQUIRE";
  /** 취득가액(수수료 제외). */
  cost: Decimal;
  fee: Decimal;
};

export type DisposeEvent = TaxEventBase & {
  kind: "DISPOSE";
  proceeds: Decimal;
  fee: Decimal;
  trigger: DisposalTrigger;
  /** trigger === "CRYPTO"인 경우 교환으로 취득한 자산. */
  receives?: { asset: string; symbol: string; quantity: Decimal };
  /**
   * 사용자가 직접 정한 취득가액(원가). 미지정 시 원장 lot 매칭이 원가를 정한다.
   *
   * derive가 value_override(취득가액 직접 입력) 또는 50% 필요경비 의제에서 채운다.
   * 지정되면 원장은 lot 매칭 대신 이 값을 처분 원가로 써서 "취득가 0원"(원장 미보유분) 경고를 없앤다.
   */
  cost?: Decimal;
};

export type IncomeEvent = TaxEventBase & {
  kind: "INCOME";
  /** 수령 시점 FMV. 이중과세 방지 불변식에 따라 동시에 새 lot의 취득가액이 된다. */
  fmv: Decimal;
  incomeKind: IncomeKind;
};

export type TaxEvent = AcquireEvent | DisposeEvent | IncomeEvent;

/** 지갑 데이터만으로 결정할 수 없는 입력(한계세율·사업자 판정 등). */
export type TaxpayerProfile = {
  /** 지갑 외 소득까지 반영한 한계세율(%). 종합과세 국가에서 사용. */
  marginalRatePercent: Decimal;
  /** 지갑 외 과세소득. 누진구간 판정에 사용. */
  otherIncome: Decimal;
  filingStatus: "SINGLE" | "JOINT";
  /** 사업자 판정(캐나다·호주·일본·프랑스는 사용자 선언 전제). */
  isBusiness: boolean;
  /** 디파이 예치 시 beneficial ownership 이전 여부(영국·호주 판단 입력). */
  defiOwnershipTransferred: boolean;
  /** 전년 이월결손금. */
  carriedLosses: Decimal;
};

export type TaxLine = {
  key: string;
  label: string;
  amount: Decimal;
  /**
   * amount의 단위. 기본은 금액(화면이 통화 기호를 붙인다).
   * "count"는 건수라서 통화 기호를 붙이면 "처분 건수 ₩5" 같은 거짓이 된다.
   */
  unit?: "money" | "count";
  /** "28%", "30% + cess 4%" 같은 적용 세율 표기. */
  rate?: string;
  basis?: string;
};

/**
 * 계산이 흔들리는 지점의 종류.
 * `excluded` 답에서 빠짐 / `zero_basis` 취득가액 0으로 계산(답을 부풀릴 수 있음) /
 * `approximation` 근사 / `not_reflected` 반영 안 함 / `other` 분류되지 않은 문구.
 */
export type LimitationKind = "excluded" | "zero_basis" | "approximation" | "not_reflected" | "other";

export type Limitation = {
  kind: LimitationKind;
  message: string;
  /** 문구에 이벤트 id가 붙어 있을 때만 채운다. 없으면 빈 목록이며, 지어내지 않는다. */
  eventIds: string[];
};

export type OpenQuestion = {
  topic: RuleTopic;
  status: ConfirmationStatus;
  reason: string;
  affectedEventIds: string[];
  /**
   * 이 항목이 어느 쪽으로 확정되면 어느 나라 모델을 이식하는지.
   * 산문 notes에 묻어두면 접힌 목록 안에서 아무도 못 본다.
   */
  benchmark?: string;
};

export type EstimateTotals = {
  /** 과세 대상 양도차익(손실 상계 후). */
  taxableGains: Decimal;
  /** 보유기간 요건 등으로 과세 대상에서 제외된 차익. */
  exemptGains: Decimal;
  /** 수령 시 인식한 소득 합계. */
  incomeTotal: Decimal;
  /** 세율을 곱하기 직전의 과세표준. */
  taxableBase: Decimal;
  /** 예상 부담 추정치. */
  estimatedCharge: Decimal;
  /** estimatedCharge / (taxableGains + incomeTotal) * 100. */
  effectiveRatePercent: Decimal;
};

export type TaxEstimate = {
  country: CountryCode;
  countryLabel: string;
  currency: string;
  taxYear: number;
  /** 적용한 취득원가 산정 방식 라벨. */
  method: string;
  status: ConfirmationStatus;
  lines: TaxLine[];
  totals: EstimateTotals;
  lossCarryforward: Decimal;
  notes: string[];
  /** notes를 영향 순으로 분류한 것. 화면이 산문을 정규식으로 뜯지 않게 한다. */
  limitations: Limitation[];
  openQuestions: OpenQuestion[];
  /** 지갑 데이터 밖에서 받아야 하는 입력 목록. */
  requiredInputs: string[];
  /** 가격 미확인 등으로 계산에서 제외한 이벤트. */
  excludedEventIds: string[];
  provenance: "mock";
  /** 적용된 과세기간 [from, to). 영국 4/6~·호주 7/1~ 때문에 화면이 재계산하면 안 된다. */
  period: { from: string; to: string };
  /**
   * 건별 판정. 거래 목록이 부담액 대신 도장을 찍기 위한 유일한 소스.
   * `at` 오름차순 정렬. 계산에서 제외된 이벤트는 여기에 없고 `excludedEventIds`로만 표현된다.
   */
  judgments: JudgmentRow[];
  /**
   * 이벤트를 하나 뺐을 때 총 부담이 얼마나 줄어드는지(양수 = 그만큼 세금을 만든 이벤트).
   * O(n)회 재계산이라 요청 시(`includeMarginal`)에만 채운다.
   */
  marginalContributions?: Record<string, Decimal>;
};

/** 원장(lot) 처리 정책. 룰셋마다 선언하고 엔진이 동일하게 해석한다. */
export type LedgerPolicy = {
  method: "FIFO" | "LIFO" | "MOVING_AVERAGE" | "PERIOD_AVERAGE" | "SECTION_104";
  /** WALLET = 지갑별 관리(독일·미국 2025~·포르투갈), GLOBAL = 전체 합산. */
  scope: "WALLET" | "GLOBAL";
  /** 크립토→크립토 교환 과세 여부. */
  cryptoToCryptoTaxable: boolean;
  /** 비과세 교환 시 보유기간 승계 여부. */
  carryHoldingPeriod: boolean;
  /** 수수료를 취득가액·양도가액에서 차감할 수 있는지(인도는 불인정). */
  feeDeductible: boolean;
  /** 취득가액 0으로 처리할 소득 유형(호주 initial allocation 에어드랍). */
  zeroBasisIncomeKinds: IncomeKind[];
  /**
   * 거주자별 총평균법(KR)의 의제취득가액 경계 시각(RFC 3339).
   *
   * 선언한 룰셋만 총평균 seed를 2-세그먼트로 만든다: 경계 전 취득해 계속 보유한 분은
   * Max(2026-12-31 시가, 실제 취득단가)로, 경계 후 취득분은 실제 원가로 합쳐 단일 평균단가를 낸다.
   * 미선언 룰셋(JP 등)은 resolver가 주어져도 기존 총평균 seed를 그대로 쓴다 — 타국 회귀 0.
   */
  deemedCostBoundary?: string;
};

/**
 * 자산 키 → 2026-12-31 간주취득가액(시가) 해석기. 미확인 자산은 undefined.
 * seed 계층까지 전달만 하는 통로이며, 소비 여부는 룰셋별 원장 로직이 결정한다.
 */
export type DeemedCostResolver = (asset: string) => Decimal | undefined;

export type GainRow = {
  eventId: string;
  at: string;
  asset: string;
  symbol: string;
  quantity: Decimal;
  proceeds: Decimal;
  cost: Decimal;
  fee: Decimal;
  gain: Decimal;
  /** 평균법 원장은 취득일이 특정되지 않아 null. */
  holdingDays: number | null;
  acquiredAt: string | null;
  trigger: DisposalTrigger;
};

export type IncomeRow = {
  eventId: string;
  at: string;
  asset: string;
  symbol: string;
  /** 수령 수량. 거래 목록이 "ETH 0.4 스테이킹 수령"을 그리는 데 쓴다. */
  quantity: Decimal;
  amount: Decimal;
  incomeKind: IncomeKind;
};

export type AcquisitionRow = {
  /** 원장 lot 식별용 id. 과세 교환 수취분은 합성 id를 쓴다. */
  eventId: string;
  /** 이 취득을 만든 사용자 이벤트 id. 거래 목록이 원 거래로 묶을 때 쓴다. */
  sourceEventId: string;
  at: string;
  asset: string;
  symbol: string;
  quantity: Decimal;
  /** 원장에 적재된 취득가액(룰셋의 feeDeductible·zeroBasis 정책 반영 후). */
  cost: Decimal;
  /** ACQUIRE(매수) / INCOME(수령 시 새 lot) / 과세 교환의 수취분 중 무엇인지. */
  origin: "ACQUIRE" | "INCOME" | "SWAP_IN";
  /** 룰셋이 취득원가 0으로 처리하는 수령분(호주 initial allocation 등)인가. */
  zeroBasis: boolean;
  /** origin이 INCOME일 때의 수령 종류. 기간 밖 수령도 올바른 근거 조문을 쓰게 한다. */
  incomeKind?: IncomeKind;
};

export type LedgerResult = {
  gains: GainRow[];
  income: IncomeRow[];
  /** 취득으로 lot을 만든 모든 행. 거래 목록에서 매수도 "취득 · 원가 기록"으로 보여야 하므로 방출한다. */
  acquisitions: AcquisitionRow[];
  /** 비과세 교환으로 이연된 처분. lot 매칭 단위라 한 이벤트가 여러 행을 만들 수 있다. */
  deferred: { eventId: string; at: string; asset: string; symbol: string; quantity: Decimal; carriedCost: Decimal }[];
  warnings: string[];
  /** 위 경고를 종류로 분류한 것. 화면이 산문을 정규식으로 뜯지 않게 한다. */
  limitations: Limitation[];
};

/**
 * 건별 판정 그룹.
 * 부담액은 과세기간에만 존재하므로 건별에는 "이 손익이 계산에서 어떻게 쓰였는지"만 붙인다.
 */
export type JudgmentGroup =
  | "acquire"
  | "income"
  | "taxable"
  | "exempt"
  | "carry"
  /** 법으로 상계가 금지된 손실(인도 §115BBH(2)). */
  | "ignored"
  /** 규정상 부인되어 원가로 이연되는 손실(캐나다 superficial loss). */
  | "denied"
  /** 과세 이연 — 처분으로 보지 않음. */
  | "deferred"
  /** 법정 면세가 아니라 기간 집계의 상계·공제로 과세분이 남지 않음. */
  | "offset"
  /** 규칙이 확정되지 않아 판정을 내릴 수 없음(한국). 법적 금지와 구분한다. */
  | "pending";

export type JudgmentVerdict = {
  group: JudgmentGroup;
  /**
   * 룰셋이 원장 손익과 다른 금액을 써야 할 때의 재정의(프랑스 포트폴리오 안분 등).
   * 미지정 시 원장 행 금액을 그대로 쓴다.
   */
  amount?: Decimal;
  /** 화면에 찍히는 도장 문구. */
  label: string;
  /** 법령·행정해석 근거. 화면과 감사 로그에 그대로 노출한다. */
  basis: string;
};

/** 거래 목록 행에 그대로 대응하는 건별 판정. amount는 부담액이 아니다. */
export type JudgmentRow = JudgmentVerdict & {
  eventId: string;
  at: string;
  asset: string;
  symbol: string;
  quantity: Decimal;
  amount: Decimal;
  /** amount가 무엇인지 — 처분은 손익, 취득은 취득가액, 소득은 수령 FMV, 이연은 승계 원가. */
  amountKind: "gain" | "cost" | "fmv" | "carried_cost";
  /** 보유일수. 한 이벤트 안에서 lot마다 다르면 null. */
  holdingDays: number | null;
  acquiredAt: string | null;
  /** 이 행을 만든 원장 lot 수. 1보다 크면 한 처분이 여러 취득분을 소비했다는 뜻이다. */
  lots: number;
  /**
   * 교환의 어느 쪽인가. `dispose`=내보낸 자산, `receive`=받은 자산.
   * 단순 매수·매도·수령은 `single`. 한 이벤트가 여러 행을 갖는 이유를 화면이 알 수 있어야 한다.
   */
  leg: "single" | "dispose" | "receive";
  /** 이번 과세기간에 속하는가. 원가 추적용으로 실린 기간 밖 취득은 false. */
  inPeriod: boolean;
  /**
   * 손익이 어떻게 나왔는지의 근거(양도가액 − 취득가액 − 수수료 = 손익).
   * `amountKind`가 `gain`인 행에만 있다 — 금액만 보이고 근거를 숨기면 사용자가 검증할 수 없다.
   */
  breakdown?: { proceeds: Decimal; cost: Decimal; fee: Decimal };
};

export type RuleContext = {
  /** 과세기간 끝까지의 이벤트. **모든 compute는 이것만 읽는다.** */
  events: TaxEvent[];
  /**
   * 과세기간이 끝난 뒤 30일 안의 이벤트.
   *
   * 영국 재매수(30일)와 캐나다 superficial loss(전후 각 30일)는 기간 경계를 넘는 사실을 봐야 한다.
   * 이걸 `events`에 섞으면 일본 기간평균·프랑스 자체 집계처럼 **다른 나라 계산이 오염된다** —
   * 그 규칙이 필요한 룰셋만 명시적으로 읽게 둔다.
   */
  lookaheadEvents: TaxEvent[];
  ledger: LedgerResult;
  profile: TaxpayerProfile;
  taxYear: number;
  /** 과세기간 [from, to). 영국(4/6~)·호주(7/1~)처럼 역년과 다른 국가가 있어 명시한다. */
  period: { from: string; to: string };
  excludedEventIds: string[];
  /**
   * 자산별 2026-12-31 의제취득가액(시가) 해석기. 미확인 자산은 undefined.
   *
   * seed 계층은 이미 이 값을 소비한다(2-세그먼트 원가). compute까지 전달하는 이유는
   * 룰셋이 "경계 전 보유분은 있는데 시가는 미입력"인 상태를 감지해 정직한 한계·미결 질문을
   * 내기 위함이다 — 그 신호가 없으면 화면이 존재하는 보유분을 "대상 없음"으로 거짓 안내한다.
   */
  deemedCost?: DeemedCostResolver;
  /**
   * "시행됐다고 가정하고" 계산하는가.
   *
   * 시행일이 미래인 룰셋(한국 2027-01-01)은 현재 과세기간에 부담이 존재하지 않는다.
   * 그 사실을 지우지 않으면서 "시행되면 이렇게 보인다"를 볼 수 있어야 하므로,
   * 가정 여부를 **입력으로** 받는다. 켠 쪽(화면)이 그 사실을 계속 말할 책임을 진다.
   */
  assumeEffective: boolean;
};

/** 화면이 입력 칸을 그릴 때 쓰는 프로필 필드 키. */
export type ProfileField = keyof TaxpayerProfile;

/**
 * 행 금액보다 집계 과세분이 작아지는 이유.
 *
 * 숫자만 보고 "상계·공제"라고 단정하면, 손실이 하나도 없는데도 법정 포함률(CA 50%)이나
 * 보유기간 할인(AU 50%)을 상계라고 거짓 설명하게 된다. 원인은 룰셋이 선언한다.
 */
export type AggregateAdjustment = "offset" | "inclusion" | "discount" | "allowance" | "floor" | "ignored" | "none";

/** 조정 방식이 과세연도·프로필·시행 가정으로 갈릴 때 참조하는 입력. */
export type AdjustmentContext = { taxYear: number; profile: TaxpayerProfile; assumeEffective?: boolean };

export type RuleSetDefinition = {
  code: CountryCode;
  label: string;
  currency: string;
  /** 기존 `/api/rulesets` 계약 유지용 필드. */
  cost_basis: string;
  badge_label: string;
  /** PDF PART 2 데모 구현 추천 순위. null = 벤치마크 대상. */
  demoPriority: 1 | 2 | 3 | null;
  status: ConfirmationStatus;
  /**
   * 이 룰셋이 처음 적용되는 과세연도. 미선언 = 이미 시행 중.
   *
   * 시행일이 미래면 화면은 그 해를 **미리 고를 수 있어야** 한다.
   * 선택 창을 시계로만 만들면(올해-3 ~ 올해) 한국 사용자는 2027년 계산을 영영 볼 수 없다.
   */
  effectiveTaxYear?: number;
  /**
   * 이 룰셋이 실제로 계산에 쓰는 프로필 필드.
   *
   * `requiredInputs`는 사람이 읽는 산문이라 화면이 입력 칸과 짝지을 수 없다.
   * 여기 선언과 실제 민감도가 어긋나면 tests/unit/profile-fields.test.ts가 잡는다.
   */
  profileFields: ProfileField[];
  /**
   * 이 룰셋이 집계 단계에서 과세분을 줄이는 방식.
   * 화면이 원인을 정확히 말할 수 있게 룰셋이 직접 선언한다.
   * 과세연도나 프로필로 갈리면 함수로 선언한다(인도는 상계 자체가 금지, 한국은 계산 없음).
   */
  aggregateAdjustment: AggregateAdjustment | ((context: AdjustmentContext) => AggregateAdjustment);
  ledger: LedgerPolicy;
  topics: TopicRule[];
  /** 역년과 다른 과세기간을 쓰는 국가만 선언한다. 미선언 시 역년. */
  taxPeriod?: (taxYear: number) => { from: string; to: string };
  /**
   * 손익 행에 판정을 붙인다. 모든 룰셋이 반드시 선언한다.
   * `estimate`는 이 룰셋의 `compute` 결과다 — 판정이 집계 결과(면세한계·floor·상계)에서
   * 파생되어야 화면과 계산이 같은 이야기를 한다. 조건을 다시 쓰지 말고 이 값을 참조한다.
   */
  judgeGain(row: GainRow, context: RuleContext, estimate: TaxEstimate): JudgmentVerdict;
  /** 소득 행 판정. 미선언 시 `defaultIncomeVerdict`. */
  judgeIncome?(row: IncomeRow, context: RuleContext, estimate: TaxEstimate): JudgmentVerdict;
  compute(context: RuleContext): TaxEstimate;
};

export type RuleSetSummary = Omit<
  RuleSetDefinition,
  "compute" | "ledger" | "taxPeriod" | "judgeGain" | "judgeIncome" | "aggregateAdjustment"
> & {
  method: string;
  /** 기본 조건에서 해석한 조정 방식. 함수 선언은 직렬화할 수 없다. */
  aggregateAdjustment: AggregateAdjustment;
};
