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

export function assetLabel(event: Pick<NormalizedEvent, "asset_type" | "chain_id" | "token_id">): string {
  if (event.asset_type === "NATIVE") return NATIVE_SYMBOL[event.chain_id] ?? "NATIVE";
  if (event.asset_type === "ERC20") return "ERC20";
  return event.token_id ? `#${event.token_id}` : event.asset_type;
}

export function chainLabel(chainId: number): string {
  return CHAIN_LABEL[chainId] ?? `chain ${chainId}`;
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

export function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(timestamp));
}


export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}
