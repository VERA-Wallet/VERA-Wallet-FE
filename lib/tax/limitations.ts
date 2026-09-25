import type { TaxExclusionReason } from "@/lib/review";
import { ZERO, abs, add, gte, isPositive, isZero, round } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import type { Limitation, LimitationKind } from "@/lib/tax/types";

/**
 * 계산의 한계를 알리는 문구는 **생산자가 소유한다**.
 *
 * 화면이 한국어 산문을 정규식으로 찍어 분류하면, 문구를 한 글자 고치는 순간
 * 조용히 "영향 없음"으로 강등된다. 그래서 문구를 상수로 고정하고
 * 이 표 하나로만 분류한다. 표에 없는 문구는 숨기지 않고 `other`로 내보인다.
 */
export const LIMITATION_MESSAGE = {
  DUPLICATE_ID: "중복된 이벤트 id는 첫 건만 계산에 넘겼습니다.",
  INTERNAL_TRANSFER: "자기 지갑 간 이체(INTERNAL_TRANSFER)는 처분으로 보지 않았습니다.",
  ESTIMATED_PRICE: "추정가(ESTIMATED)로 평가된 이벤트가 포함되어 있습니다.",
  GAS_FEE: "가스비는 법정통화 환산 정보가 없어 취득원가·양도가액에 반영하지 않았습니다.",
  EXCHANGE_APPROXIMATION: "교환(EXCHANGE) 이벤트는 상대 자산 정보가 없어 피아트 처분으로 근사했습니다.",
} as const;

/** 제외 사유 문구. 사유가 여러 가지라 접두사만 고정한다. */
export const EXCLUSION_SUFFIX = " 상태인 이벤트는 계산에서 제외했습니다.";

/** 사유를 모른 채 id만 아는 제외의 고정 꼬리. */
export const EXCLUDED_ID_SUFFIX = " 확인이 필요해 계산에서 제외했습니다.";

/** 부인된 손실을 대체 취득분 원가에 반영하지 못했다는 경고의 고정 꼬리. */
export const DENIED_ACB_SUFFIX = " 대체 취득분 원가에 더하지 않았습니다. 이후 처분 손익이 과대될 수 있습니다.";

/** 아직 팔지 않은 대체 취득분에 이연 원가가 남아 있다는 경고의 고정 꼬리. */
export const PENDING_ACB_SUFFIX = " 그 자산을 팔 때 반영됩니다.";

/** 원장에 없는 수량을 취득가액 0으로 계산했다는 경고의 고정 꼬리. */
export const ZERO_BASIS_SUFFIX = " 취득가액 0으로 계산했습니다.";

/**
 * 한국 의제취득가액(2026-12-31 시가)을 반영하지 못했다는 근사의 고정 꼬리.
 * 법정 취득가액은 Max(시가, 실제 취득가액)이므로, 실제 취득가액만 쓰면 손익이 과대될 수 있다.
 */
export const DEEMED_COST_SUFFIX = " 의제취득가액(2026-12-31 시가)을 확인하지 못해 실제 취득가액으로 계산했습니다. 손익이 과대될 수 있습니다.";

/** 무상취득분 취득가액 규정이 없어 수령 시 FMV를 원가로 썼다는 근사의 고정 꼬리. */
export const RECEIPT_COST_SUFFIX = " 무상취득분 취득가액 규정이 없어 수령 시 FMV를 취득가액으로 계산했습니다. 0원으로 보면 처분 시 과세분이 커집니다.";

/**
 * 거주자별 총평균법이 부분집계로 계산됐다는 근사의 고정 꼬리.
 * 총평균법은 그 거주자의 모든 출처(거래소·지갑)를 합산해야 하나, 아직 지갑 단위로만 통산해
 * 평균단가의 분모가 실제보다 작을 수 있다 — 예상 부담은 잠정치다.
 */
export const COST_METHOD_SUFFIX = " 거주자별 총평균법은 그 사람의 모든 출처를 합산해야 하나, 아직 지갑 단위로만 통산해 평균단가가 실제와 다를 수 있습니다. 예상 부담은 잠정치입니다.";

/** 거래일 환율이 없어 계산에서 제외했다는 고정 꼬리(앞에는 이벤트 id). */
export const FX_RATE_SUFFIX = " 거래일 환율(ECB 기준)을 확인하지 못해 계산에서 제외했습니다.";

/**
 * 이벤트 통화를 룰셋 통화로 환산했다는 근사의 고정 꼬리(앞에는 "KRW → USD"처럼 통화쌍).
 * 세무 당국이 정한 환율·기준일(고시환율·월평균 등)과 다를 수 있으므로 근사로 분류한다.
 */
export const FX_CONVERSION_SUFFIX = " 금액은 거래일의 ECB 기준환율로 환산했습니다. 세무 당국이 정한 환율·기준일과 다를 수 있습니다.";

/**
 * 답이 얼마나 흔들리는지의 순서.
 *
 * 숫자를 지어내지 않는다. 대신 **답에 어떻게 작용하는가**로만 줄을 세운다.
 * 1) 답에서 빠진 것 → 2) 답을 부풀릴 수 있는 것 → 3) 근사한 것 → 4) 반영하지 않은 것.
 */
export const LIMITATION_ORDER: LimitationKind[] = [
  "excluded",
  "zero_basis",
  "approximation",
  "not_reflected",
  "other",
];

const KIND_OF_MESSAGE = new Map<string, LimitationKind>([
  [LIMITATION_MESSAGE.DUPLICATE_ID, "not_reflected"],
  [LIMITATION_MESSAGE.INTERNAL_TRANSFER, "not_reflected"],
  [LIMITATION_MESSAGE.GAS_FEE, "not_reflected"],
  [LIMITATION_MESSAGE.ESTIMATED_PRICE, "approximation"],
  [LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION, "approximation"],
]);

/** 한 줄의 경고 문구를 종류로 분류한다. */
export function classifyLimitation(message: string): LimitationKind {
  const known = KIND_OF_MESSAGE.get(message);
  if (known) return known;
  if (message.endsWith(ZERO_BASIS_SUFFIX)) return "zero_basis";
  // 법정 취득가액·원가법을 그대로 쓰지 못하고 대체값으로 계산한 줄은 전부 근사다.
  if (
    message.endsWith(DEEMED_COST_SUFFIX) ||
    message.endsWith(RECEIPT_COST_SUFFIX) ||
    message.endsWith(COST_METHOD_SUFFIX) ||
    message.endsWith(FX_CONVERSION_SUFFIX)
  ) {
    return "approximation";
  }
  // 부인 손실의 원가 가산 누락은 "취득가액 0"이 아니라 "반영 안 함"이다.
  // zero_basis로 찍으면 화면 배지가 존재하지 않는 계산 사실을 말한다.
  if (message.endsWith(DENIED_ACB_SUFFIX) || message.endsWith(PENDING_ACB_SUFFIX)) return "not_reflected";
  if (message.endsWith(EXCLUSION_SUFFIX) || message.endsWith(EXCLUDED_ID_SUFFIX) || message.endsWith(FX_RATE_SUFFIX)) return "excluded";
  return "other";
}

/**
 * 문구 목록을 한계 행으로 바꾼다.
 *
 * **notes 전체를 넣으면 안 된다.** notes에는 "1년 초과 보유는 전액 비과세"처럼
 * 규칙이 어떻게 동작하는지를 설명하는 줄이 섞여 있고, 그건 한계가 아니다.
 * 계산이 못 한 일을 아는 생산자(원장·파생)만 이 함수를 부른다.
 */
export function toLimitations(messages: string[]): Limitation[] {
  // 이벤트가 특정되지 않는 문구다. 문장에서 id를 되뜯지 않고 빈 목록으로 못 박는다.
  return messages.map((message) => limitationOf(message, []));
}

/**
 * 한계 행을 만드는 유일한 입구.
 * 생산자가 kind를 직접 적으면 분류 정책이 바뀔 때 같은 문구가 경로에 따라 다른 종류가 된다.
 */
export function limitationOf(message: string, eventIds: string[]): Limitation {
  return { kind: classifyLimitation(message), message, eventIds };
}

/** 영향 순으로 줄을 세운다. 같은 순위 안에서는 들어온 순서를 지킨다. */
export function sortLimitations(rows: Limitation[]): Limitation[] {
  return [...rows].sort((a, b) => LIMITATION_ORDER.indexOf(a.kind) - LIMITATION_ORDER.indexOf(b.kind));
}

/** 화면에 나열할 이벤트 ID 최대 개수. 그 뒤는 "외 N건"으로 접는다. */
const EVENT_ID_PREVIEW_COUNT = 2;

/**
 * 한계 행의 이벤트 ID를 화면용 한 줄로 줄인다.
 *
 * 전부 나열하면 안 된다 — 한 항목이 수천 건일 때 한 줄이 수십만 자가 되어 화면 폭을 터뜨린다.
 * (2026-09-11 룰셋 비교 화면에서 scrollWidth 2,843,588px 관측.) 근거 추적은 거래 탭 필터가 맡는다.
 */
export function summarizeEventIds(eventIds: string[]): string {
  if (eventIds.length === 0) return "";
  const head = eventIds.slice(0, EVENT_ID_PREVIEW_COUNT).join(", ");
  const rest = eventIds.length - EVENT_ID_PREVIEW_COUNT;
  return rest > 0 ? `${head} 외 ${rest}건` : head;
}

/**
 * 문구에서 이벤트 id를 뗀다. 엔진은 "<id>: 확인이 필요해…"처럼 id를 문장 앞에 붙여 보내는데,
 * 사람에게 `42161:0xfb49…:log:199`는 정보가 아니라 소음이다. 추적은 거래 탭이 맡는다.
 */
export function stripEventIds(message: string, eventIds: readonly string[]): string {
  let text = message;
  for (const id of eventIds) text = text.split(id).join("");
  return text.replace(/^[\s:,·]+/, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * 규칙 설명만 남긴다. 원장 경고는 notes와 limitations 양쪽에 같은 문구로 들어오므로(ledger.ts),
 * 한계 목록을 따로 그리는 화면이 notes까지 그대로 실으면 같은 줄이 두 번 서고 id가 붙은 원문이 새어 나온다.
 */
export function ruleNotesOf(notes: readonly string[], limitations: readonly Limitation[]): string[] {
  const messages = new Set(limitations.map((row) => row.message));
  return notes.filter((note) => !messages.has(note));
}

export type LimitationGroup = { kind: LimitationKind; message: string; eventIds: string[] };

/**
 * 같은 종류·같은 문구를 한 줄로 묶고 관련 이벤트를 합친다.
 *
 * 제외 이벤트는 건마다 한 줄씩 오므로, 거래가 많은 지갑은 같은 문장이 수십 장 쌓인다(실지갑 50장 관측).
 * 묶으면 "계산에서 뺌 39건" 한 줄이 된다. 순서는 첫 등장 순 — 엔진이 이미 영향 순으로 준다.
 */
export function groupLimitations(rows: readonly Limitation[]): LimitationGroup[] {
  const groups = new Map<string, LimitationGroup>();
  for (const row of rows) {
    const message = stripEventIds(row.message, row.eventIds);
    const key = `${row.kind}\n${message}`;
    const group = groups.get(key);
    if (group) {
      for (const id of row.eventIds) if (!group.eventIds.includes(id)) group.eventIds.push(id);
    } else {
      groups.set(key, { kind: row.kind, message, eventIds: [...new Set(row.eventIds)] });
    }
  }
  return [...groups.values()];
}

/** 화면이 그리는 한 줄. `title`은 무슨 일이 있었는지, `detail`은 어느 정도인지, `action`은 그래서 무엇을 하면 되는지. */
export type LimitationRow = { kind: LimitationKind; title: string; detail?: string; action?: string; eventIds: string[] };

type Plain = { title: string; detail?: string; action?: string };

const REVIEW_TAB = "확인 필요 탭에서";

/**
 * 엔진 문구는 세무사·리포트용이라 상태값(UNKNOWN, ESTIMATED)과 용어(피아트 처분)를 그대로 쓴다.
 * 세금 화면은 일반 사용자가 보므로 여기서 사람 말로 바꾼다. 키를 상수로 잡아 엔진 문구가 바뀌면 여기가 같이 깨진다.
 * 매핑이 없는 문구는 그대로 보인다 — 지어내지 않는다.
 */
const EXCLUSION_PLAIN: Record<TaxExclusionReason, Plain> = {
  "가격 확인 필요": { title: "거래 당시 가격을 확인하지 못했습니다.", action: `${REVIEW_TAB} 가격을 입력하면 계산에 반영됩니다.` },
  "분류 확인 필요": { title: "어떤 거래인지(매도·이체·수령 등) 아직 정하지 못했습니다.", action: `${REVIEW_TAB} 분류를 지정하면 계산에 반영됩니다.` },
  "수량 확인 필요": { title: "수량을 확인하지 못했습니다.", action: `${REVIEW_TAB} 확인해 주세요.` },
  "방향·분류 불일치": { title: "들어온 거래인지 나간 거래인지와 분류가 서로 맞지 않습니다.", action: `${REVIEW_TAB} 분류를 지정하면 계산에 반영됩니다.` },
};

const MESSAGE_PLAIN: ReadonlyMap<string, Plain> = new Map<string, Plain>([
  [EXCLUDED_ID_SUFFIX.trim(), { title: "확인이 필요하여 계산에서 제외되었습니다.", action: `${REVIEW_TAB} 누락 정보를 확인하고 보완해 주세요.` }],
  [FX_RATE_SUFFIX.trim(), { title: "거래일의 환율을 확인하지 못해 계산에서 제외되었습니다." }],
  [LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION, { title: "교환으로 받은 자산 정보가 없어, 보낸 자산을 매도한 것으로 가정하여 계산했습니다." }],
  [LIMITATION_MESSAGE.ESTIMATED_PRICE, { title: "일부 거래는 추정 가격으로 계산했습니다." }],
  [LIMITATION_MESSAGE.INTERNAL_TRANSFER, { title: "본인 지갑 간 이체는 매도로 처리하지 않았습니다." }],
  [LIMITATION_MESSAGE.GAS_FEE, { title: "네트워크 수수료의 법정통화 환산값을 확인하지 못해 계산에 반영하지 않았습니다." }],
  [LIMITATION_MESSAGE.DUPLICATE_ID, { title: "거래가 중복되어 첫 번째 거래만 계산에 반영했습니다." }],
]);

/** 원장(ledger.ts)이 내는 모양 그대로: "원장에 없는 수량 <수량> <심볼>: 취득가액 0으로…". 수량은 십진 문자열만 받는다. */
const ZERO_BASIS_PATTERN = /^원장에 없는 수량 (\d+(?:\.\d+)?) (\S+):/;

const ZERO_BASIS_PLAIN: Plain = {
  title: "매도 수량에 해당하는 취득 이력을 확인하지 못했습니다.",
  action: "해당 수량의 취득가액을 0원으로 계산하여 이익이 실제보다 크게 산출될 수 있습니다. 취득 이력이 있는 지갑을 연결하고 거래 내역을 확인해 주세요.",
};

/** 1 이상은 소수 둘째 자리, 그 아래는 여섯째 자리까지 — 17자리 수량은 사람에게 정보가 아니다. */
function formatQuantity(value: Decimal): string {
  const rounded = round(value, gte(abs(value), "1") ? 2 : 6);
  if (isZero(rounded) && isPositive(value)) return "0.000001 미만";
  return rounded.includes(".") ? rounded.replace(/\.?0+$/, "") : rounded;
}

function describe(group: LimitationGroup): Plain {
  if (group.message.endsWith(EXCLUSION_SUFFIX)) {
    const reason = group.message.slice(0, -EXCLUSION_SUFFIX.length);
    return (EXCLUSION_PLAIN as Partial<Record<string, Plain>>)[reason] ?? { title: group.message };
  }
  return MESSAGE_PLAIN.get(group.message) ?? { title: group.message };
}

/**
 * 화면용: 묶고, 사람 말로 바꾸고, 취득가액 0원 건은 심볼별 수량 합계 한 줄로 합친다.
 *
 * 취득가액 0원은 처분마다 한 줄(수량이 달라 묶이지 않는다)이라, 실지갑에선 ETH 0.080783951951876…
 * 같은 줄이 다섯 장 섰다. 사용자가 알아야 할 것은 "어느 자산이 얼마나"이지 건별 17자리 수량이 아니다.
 */
export function plainLimitations(rows: readonly Limitation[]): LimitationRow[] {
  const out: LimitationRow[] = [];
  const shortfalls = new Map<string, { quantity: Decimal; count: number }>();
  let zeroBasis: LimitationRow | null = null;
  for (const group of groupLimitations(rows)) {
    const shortfall = group.kind === "zero_basis" ? ZERO_BASIS_PATTERN.exec(group.message) : null;
    if (shortfall === null) {
      out.push({ kind: group.kind, ...describe(group), eventIds: group.eventIds });
      continue;
    }
    const [, quantity, symbol] = shortfall;
    const prev = shortfalls.get(symbol);
    shortfalls.set(symbol, { quantity: add(prev?.quantity ?? ZERO, quantity), count: (prev?.count ?? 0) + Math.max(group.eventIds.length, 1) });
    if (zeroBasis === null) {
      zeroBasis = { kind: "zero_basis", ...ZERO_BASIS_PLAIN, eventIds: [] };
      out.push(zeroBasis);
    }
    for (const id of group.eventIds) if (!zeroBasis.eventIds.includes(id)) zeroBasis.eventIds.push(id);
  }
  if (zeroBasis !== null) {
    zeroBasis.detail = [...shortfalls]
      .map(([symbol, { quantity, count }]) => `${symbol} ${formatQuantity(quantity)}${count > 1 ? ` (${count}건)` : ""}`)
      .join(" · ");
  }
  return out;
}
