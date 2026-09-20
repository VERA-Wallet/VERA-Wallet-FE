import type { Decimal } from "@/lib/tax/decimal";
import { formatFiat } from "@/lib/format";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * 보고서 표시 헬퍼 — 종이(`report-html.ts`)와 앱 화면(`report-view.tsx`)이 **같은 값을 같은 글자로** 보이게 한다.
 *
 * 값은 건드리지 않는다. 자리수를 끊고 꼬리 0을 정리할 뿐이며, 읽을 수 없는 값은 그럴듯한 금액으로 바꾸지 않는다.
 * 두 문서가 각자 포매터를 들고 있으면 같은 estimate를 두고 화면과 PDF가 다른 숫자처럼 읽힌다.
 */

/**
 * 시트용 `number`를 다시 Decimal 문자열로 되돌린다.
 * 지수 표기(`1e+21`)는 금액 포매터가 읽지 못하므로 그때는 포기하고 원문을 그대로 보인다 —
 * 읽을 수 없는 값을 그럴듯한 금액으로 바꿔 적지 않는다.
 */
export function decimalOf(value: number): Decimal | null {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return null;
  return value.toFixed(2);
}

/** 요약 행의 칸 하나를 금액으로. 숫자가 아닌 칸(세율·신뢰도)은 글자 그대로 둔다. */
export function cellText(value: string | number | undefined, currency: string): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  const decimal = decimalOf(value);
  return decimal === null ? String(value) : formatFiat(decimal, currency);
}

/** 수량은 통화가 아니다 — 꼬리 0을 떼어 `1.5 ETH`처럼 읽히게 한다. */
export function quantityText(value: string | number | undefined): string {
  if (value === undefined) return "—";
  const raw = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  const trimmed = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  return Number(trimmed) === 0 ? "0" : trimmed;
}

/**
 * 통화 기호 없이 천 단위로만 끊는다. 자산별 명세는 금액 칸이 여섯이라 기호까지 넣으면 A4 본문 폭(184mm)을
 * 넘겨 마지막 칸이 잘린다. 한국 서식 관례대로 단위를 표 머리에 한 번 적고 칸에서는 뺀다.
 * 값은 건드리지 않는다 — 자리수만 끊고 꼬리 0만 정리한다.
 */
export function groupedAmount(value: Decimal): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) return value;
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1] === "-" ? "−" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** 자산별 명세의 금액 칸 글자(기호 없음). 숫자가 아니면 그대로, 읽을 수 없으면 원문 그대로. */
export function groupedCellText(value: string | number | undefined): string {
  if (typeof value !== "number") return String(value ?? "—");
  const decimal = decimalOf(value);
  return decimal === null ? String(value) : groupedAmount(decimal);
}

/** 금액 단위 표기. 원화는 "원", 나머지는 통화 코드 그대로. */
export function unitLabel(currency: string): string {
  return currency === "KRW" ? "원" : currency;
}

export const STATUS_BADGE: Record<TaxEstimate["status"], { label: string; tone: "ok" | "warn" }> = {
  CONFIRMED: { label: "확정·시행중", tone: "ok" },
  SCHEDULED: { label: "확정·시행예정", tone: "ok" },
  PARTIAL: { label: "잠정·부분확정", tone: "warn" },
  UNDETERMINED: { label: "미확정", tone: "warn" },
};

/** 작성 시각을 KST로 못 박는다. 브라우저 시간대에 따라 같은 문서가 다른 시각을 말하면 안 된다. */
export function generatedAtText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")} KST`;
}

/**
 * 보고서에 싣는 예외 행의 상한. 미반영·판단보류는 지갑에 따라 수백 줄이 되는데, 그걸 다 실으면
 * 요약 보고서가 아니라 목록이 된다. 넘치는 만큼은 세지 못한 척하지 않고 건수로 밝히고 파일로 넘긴다.
 */
export const EXCEPTION_ROW_LIMIT = 40;

/** 관련 이벤트 id 칸(쉼표 구분)에서 건수를 센다. 빈 칸은 0건이다. */
export function relatedEventIds(raw: string | number | undefined): string[] {
  return String(raw ?? "").split(",").map((id) => id.trim()).filter((id) => id.length > 0);
}
