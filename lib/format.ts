import { assetFlow } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

const NATIVE_SYMBOL: Record<number, string> = {
  1: "ETH",
  10: "ETH",
  137: "POL",
  8453: "ETH",
  42161: "ETH",
};

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 체인 원시 단위(raw_amount)를 decimals로 나눠 사람이 읽는 수량으로 바꾼다.
 * 자릿수 이동을 문자열로 처리해 uint256 범위에서도 부동소수 오차가 생기지 않는다.
 */
export function formatTokenAmount(rawAmount: string, decimals: number): string {
  const negative = rawAmount.startsWith("-");
  const unsigned = negative ? rawAmount.slice(1) : rawAmount;
  if (!/^\d+(?:\.\d+)?$/.test(unsigned)) return rawAmount;

  const [integerDigits, fractionDigits = ""] = unsigned.split(".");
  const shift = fractionDigits.length + decimals;
  const padded = `${integerDigits}${fractionDigits}`.padStart(shift + 1, "0");
  const integerPart = padded.slice(0, padded.length - shift).replace(/^0+(?=\d)/, "");
  const rawFraction = shift > 0 ? padded.slice(padded.length - shift) : "";

  // 0.000000123 처럼 앞자리가 0인 값은 유효숫자가 사라지지 않도록 선행 0을 세어 자리수를 늘린다.
  const leadingZeros = integerPart === "0" ? (rawFraction.match(/^0*/)?.[0].length ?? 0) : 0;
  const fraction = rawFraction.slice(0, leadingZeros + 6).replace(/0+$/, "");

  const sign = negative && (integerPart !== "0" || fraction !== "") ? "-" : "";
  return `${sign}${group(integerPart)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * 목록·상세가 자산을 부르는 이름.
 *
 * 심볼을 알면 그것을 쓴다. 모르면 지어내지 않고 자산 타입으로 대체한다 —
 * "ERC20"·"#102"는 이름이 아니라 **이름을 모른다는 표시**다.
 * NFT는 심볼만으로 개체가 특정되지 않으므로 컬렉션 심볼과 토큰 번호를 함께 둔다.
 */
export function assetLabel(
  event: Pick<NormalizedEvent, "asset_type" | "chain_id" | "token_id" | "asset_symbol">,
): string {
  const symbol = event.asset_symbol;
  if (event.asset_type === "NATIVE") return symbol ?? NATIVE_SYMBOL[event.chain_id] ?? "NATIVE";
  if (event.token_id) return symbol ? `${symbol} #${event.token_id}` : `#${event.token_id}`;
  return symbol ?? event.asset_type;
}

/**
 * 방향까지 담은 수량 표기. 나간 자산은 `-`, 들어온 자산은 `+`.
 *
 * 색만으로 구분하면 색을 구분하지 못하는 사용자에게는 아무 정보가 아니다 — 부호를 함께 둔다.
 * 어느 쪽도 아닌 건(자기 지갑 간 이체·미확정)은 부호를 붙이지 않는다. 붙이면 처분이라고 단정하는 셈이다.
 */
export function formatSignedTokenAmount(event: NormalizedEvent): string {
  const amount = formatTokenAmount(event.raw_amount, event.decimals);
  const flow = assetFlow(event);
  return flow === "in" ? `+${amount}` : flow === "out" ? `-${amount}` : amount;
}

export function chainLabel(chainId: number): string {
  return CHAIN_LABEL[chainId] ?? `chain ${chainId}`;
}

/**
 * 체인의 기축 통화 심볼. 가스비는 `gas_fee_native`라 자산 타입과 무관하게
 * 체인만으로 단위가 정해진다 — `assetLabel`은 NATIVE 자산일 때만 이 값을 준다.
 */
export function nativeSymbol(chainId: number): string {
  return NATIVE_SYMBOL[chainId] ?? "NATIVE";
}

/**
 * 통화 금액 표기의 단일 규칙.
 *
 * 규칙은 둘뿐이다:
 * 1. **값을 숨기지 않는다.** 자릿수는 통화 관례를 따르되(EUR 2, KRW 0),
 *    관례보다 잔여 소수가 더 있으면 그만큼 더 보인다(최대 2).
 *    ₩13,130.5를 ₩13,131로 반올림해 보이면 화면이 계산과 다른 말을 한다.
 * 2. **값을 바꾸지 않는다.** Decimal 문자열을 `Number`로 태우면 2^53을 넘는 금액이
 *    다른 금액으로 표시된다. 자릿수만 Intl에서 배워 오고, 숫자는 문자열로 조립한다.
 *
 * 대시보드와 세금 탭이 서로 다른 자릿수로 같은 금액을 그리던 것을 이 함수로 합쳤다.
 */
export function formatFiat(value: string | null, currency: string): string {
  if (value === null) return "—";
  const parsed = parseDecimal(value);
  if (!parsed) return `${value} ${currency}`;
  try {
    const digits = Math.max(currencyDigits(currency), significantFractionDigits(parsed.fraction));
    const scaled = roundToDigits(parsed.integer, parsed.fraction, digits);
    return assemble(currency, parsed.negative, scaled.integer, scaled.fraction);
  } catch {
    return `${value} ${currency}`;
  }
}

type ParsedDecimal = { negative: boolean; integer: string; fraction: string };

function parseDecimal(value: string): ParsedDecimal | null {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  return { negative: match[1] === "-", integer, fraction: match[3] ?? "" };
}

/**
 * 값을 **전혀 반올림하지 않는** 통화 표기.
 *
 * 손익 4줄(양도가액 − 취득가액 − 수수료 = 손익)처럼 화면의 산술이 맞아떨어져야 하는 곳에 쓴다.
 * lot 분할은 소수 셋째 자리 이하를 만들 수 있는데, 각 줄을 독립 반올림하면
 * €0.01 − €0.00 − €0.00 = €0.00 같은 표시 모순이 생긴다.
 */
export function formatFiatExact(value: string | null, currency: string): string {
  if (value === null) return "—";
  const parsed = parseDecimal(value);
  if (!parsed) return `${value} ${currency}`;
  try {
    const fraction = parsed.fraction.replace(/0+$/, "");
    const digits = Math.max(currencyDigits(currency), fraction.length);
    const scaled = { integer: parsed.integer, fraction: fraction.padEnd(digits, "0") };
    return assemble(currency, parsed.negative, scaled.integer, scaled.fraction);
  } catch {
    return `${value} ${currency}`;
  }
}

/** 그 통화가 관례로 쓰는 소수 자릿수. 알 수 없으면 2. */
function currencyDigits(currency: string): number {
  const resolved = new Intl.NumberFormat("ko-KR", { style: "currency", currency }).resolvedOptions();
  return resolved.maximumFractionDigits ?? 2;
}

/** 후행 0을 뺀 유효 소수 자릿수(최대 2). */
function significantFractionDigits(fraction: string): number {
  return Math.min(fraction.replace(/0+$/, "").length, 2);
}

/** 소수를 `digits`자리로 맞춘다. 잘라낼 자리가 5 이상이면 올린다(정수부로 자리올림 포함). */
function roundToDigits(integer: string, fraction: string, digits: number): { integer: string; fraction: string } {
  if (fraction.length <= digits) return { integer, fraction: fraction.padEnd(digits, "0") };
  const kept = `${integer}${fraction.slice(0, digits)}`;
  const carried = fraction.charCodeAt(digits) >= 53 ? incrementDigits(kept) : kept;
  const cut = carried.length - digits;
  return { integer: carried.slice(0, cut) || "0", fraction: carried.slice(cut) };
}

/** 자리별 +1 표. 숫자를 `Number`로 되돌리지 않기 위해 표로 둔다. */
const NEXT_DIGIT: Record<string, string> = {
  "0": "1", "1": "2", "2": "3", "3": "4", "4": "5",
  "5": "6", "6": "7", "7": "8", "8": "9",
};

/** 숫자 문자열에 1을 더한다. 자리올림이 넘치면 길이가 하나 늘어난다. */
function incrementDigits(digits: string): string {
  const out = [...digits];
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const next = NEXT_DIGIT[out[index]];
    if (next === undefined) {
      out[index] = "0";
      continue;
    }
    out[index] = next;
    return out.join("");
  }
  return `1${out.join("")}`;
}

/**
 * 통화 기호 위치·구분자는 Intl에서 배우고, 숫자 자체는 우리가 만든 문자열을 쓴다.
 * 견본(1234.5)을 formatToParts로 뜯어 자리만 갈아 끼운다.
 */
function assemble(currency: string, negative: boolean, integer: string, fraction: string): string {
  const formatter = new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
  });
  const parts = formatter.formatToParts(negative ? -1234.5 : 1234.5);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const number = groupDigits(integer, group) + (fraction ? `${decimal}${fraction}` : "");

  let emitted = false;
  return parts
    .map((part) => {
      if (part.type === "currency" || part.type === "literal" || part.type === "minusSign") return part.value;
      if (emitted) return "";
      emitted = true;
      return number;
    })
    .join("");
}

function groupDigits(integer: string, group: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/**
 * 날짜 표기의 단일 규칙 — **항상 UTC**.
 *
 * 계산은 전부 UTC다: `taxYearFor`는 `getUTCFullYear`, `isoDay`는 ISO 접두사,
 * 룰셋의 보유기간 판정은 `getUTC*`를 쓴다. 표시만 로컬 시간대로 두면
 * `2025-12-31T20:00Z` 거래가 KST 화면에서 `2026. 1. 1.`로 보이는데
 * 엔진은 2025년으로 계산한다 — 과세연도 경계에서 화면이 계산과 다른 말을 한다.
 *
 * 시간대를 못 박은 대가로 화면은 그 사실을 한 번 밝혀야 한다(`UTC_NOTICE`).
 */
export function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(timestamp));
}

/**
 * 한 시각을 **UTC와 KST(한국시간)로 함께** 찍는다 — 한국 신고용.
 *
 * `formatDate`(날짜 단위 UTC 고정)는 그대로 둔다: 목록 머리글·귀속연도 판정은 엔진과 같은 UTC 날짜여야 한다.
 * 정확한 "언제"가 중요한 자리(거래 시각·앵커 기록 시각)에서만 이 함수로 시각까지 병기한다.
 *
 * 두 시간대를 명시해 못 박으므로 브라우저 시간대와 무관하게 같은 문자열을 낸다 —
 * `toLocaleString`은 실행 환경의 로컬 TZ를 써서 같은 거래가 브라우저마다 다른 시각으로 흔들렸다(export의 drift 원인).
 */
export function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  const render = (timeZone: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  return `${render("UTC")} UTC · ${render("Asia/Seoul")} KST`;
}

/**
 * 거래 시각을 **KST(한국시간) 단독으로** 찍는다 — 한국 신고 근거자료의 거래일시 칸.
 *
 * 근거자료 표의 한 칸에는 두 시간대를 병기할 수 없다(엑셀 셀 하나에 UTC·KST를 함께 넣으면 정렬·필터가 깨진다).
 * `formatDateTime`과 같은 방식으로 시간대를 명시해 못 박으므로 브라우저 로컬 TZ와 무관하게 같은 문자열을 낸다.
 * `YYYY-MM-DD HH:mm KST` 형태라 셀에서 문자열 정렬이 곧 시간 정렬이 된다.
 */
export function formatKstDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  // en-CA 로케일은 날짜를 YYYY-MM-DD로 낸다. 24시 표기의 `24:00`만 `00:00`으로 정규화한다.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")} KST`;
}

/**
 * 날짜 시간대 고지. 목록 날짜는 UTC(엔진과 같은 귀속연도 판정)이고, 정확한 시각은 KST를 함께 표기한다.
 * 문구가 두 벌이면 화면마다 다른 약속을 하게 되므로 한 곳에 못 박는다.
 */
export const UTC_NOTICE = "목록 날짜는 UTC 기준이며, 거래 시각은 KST(한국시간)를 함께 표기합니다.";

/** 체인별 익스플로러 트랜잭션 URL. 없는 체인은 링크를 걸지 않는다(죽은 링크를 만들지 않는다). */
const EXPLORER_TX_URL: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  137: "https://polygonscan.com/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
};

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = EXPLORER_TX_URL[chainId];
  return base ? `${base}${txHash}` : null;
}


export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}
