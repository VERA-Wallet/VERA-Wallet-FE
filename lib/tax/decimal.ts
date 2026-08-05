/**
 * 세무 계산 전용 고정소수점 decimal.
 * 레포 관례상 모든 금액은 `^-?\d+(\.\d+)?$` 문자열이며, 부동소수 연산은 금지한다.
 * 내부적으로 10^18 스케일 BigInt로 환산해 계산하고 다시 정규화된 문자열로 되돌린다.
 */
const SCALE = 18;
const BIG_TEN = BigInt(10);
const BIG_TWO = BigInt(2);
const ZERO_UNITS = BigInt(0);
const ONE = BIG_TEN ** BigInt(SCALE);
const PATTERN = /^-?\d+(?:\.\d+)?$/;

export type Decimal = string;

export const ZERO: Decimal = "0";
export const ONE_DECIMAL: Decimal = "1";

export function toUnits(value: Decimal): bigint {
  if (!PATTERN.test(value)) throw new Error(`invalid decimal string: ${value}`);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  // 18자리를 넘는 소수부는 절사한다(토큰 최소단위보다 작은 잔여는 세무상 의미가 없다).
  const units = BigInt(`${whole}${fraction.padEnd(SCALE, "0").slice(0, SCALE)}`);
  return negative ? -units : units;
}

export function fromUnits(units: bigint): Decimal {
  const negative = units < ZERO_UNITS;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, "0");
  const fraction = digits.slice(-SCALE).replace(/0+$/, "");
  const text = fraction ? `${digits.slice(0, -SCALE)}.${fraction}` : digits.slice(0, -SCALE);
  return negative && toUnitsIsNonZero(units) ? `-${text}` : text;
}

function toUnitsIsNonZero(units: bigint): boolean {
  return units !== ZERO_UNITS;
}

export function add(a: Decimal, b: Decimal): Decimal {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function sub(a: Decimal, b: Decimal): Decimal {
  return fromUnits(toUnits(a) - toUnits(b));
}

export function mul(a: Decimal, b: Decimal): Decimal {
  return fromUnits((toUnits(a) * toUnits(b)) / ONE);
}

export function div(a: Decimal, b: Decimal): Decimal {
  const divisor = toUnits(b);
  if (divisor === ZERO_UNITS) throw new Error("division by zero");
  return fromUnits((toUnits(a) * ONE) / divisor);
}

export function neg(value: Decimal): Decimal {
  return fromUnits(-toUnits(value));
}

export function abs(value: Decimal): Decimal {
  const units = toUnits(value);
  return fromUnits(units < ZERO_UNITS ? -units : units);
}

export function cmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const left = toUnits(a);
  const right = toUnits(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export const lt = (a: Decimal, b: Decimal) => cmp(a, b) < 0;
export const lte = (a: Decimal, b: Decimal) => cmp(a, b) <= 0;
export const gt = (a: Decimal, b: Decimal) => cmp(a, b) > 0;
export const gte = (a: Decimal, b: Decimal) => cmp(a, b) >= 0;
export const isZero = (value: Decimal) => toUnits(value) === ZERO_UNITS;
export const isNegative = (value: Decimal) => toUnits(value) < ZERO_UNITS;
export const isPositive = (value: Decimal) => toUnits(value) > ZERO_UNITS;

export function max(a: Decimal, b: Decimal): Decimal {
  return gte(a, b) ? a : b;
}

export function min(a: Decimal, b: Decimal): Decimal {
  return lte(a, b) ? a : b;
}

export function sum(values: Decimal[]): Decimal {
  return fromUnits(values.reduce((total, value) => total + toUnits(value), ZERO_UNITS));
}

/** 음수를 0으로 잘라낸다(면세한계·공제 계산에서 반복 사용). */
export function clampPositive(value: Decimal): Decimal {
  return isNegative(value) ? ZERO : value;
}

/** value * (percent / 100). 세율표는 퍼센트 단위로 선언하고 계산 시점에 환산한다. */
export function percentOf(value: Decimal, percent: Decimal): Decimal {
  return div(mul(value, percent), "100");
}

/** 반올림(half-up, 0에서 멀어지는 방향). 표시·최종 산출액 확정에만 사용한다. */
export function round(value: Decimal, dp = 2): Decimal {
  if (dp < 0 || dp > SCALE) throw new Error(`unsupported precision: ${dp}`);
  const units = toUnits(value);
  const factor = BIG_TEN ** BigInt(SCALE - dp);
  const negative = units < ZERO_UNITS;
  const magnitude = negative ? -units : units;
  const rounded = ((magnitude + factor / BIG_TWO) / factor) * factor;
  return fromUnits(negative ? -rounded : rounded);
}

/** 고정 소수 자릿수 표기(후행 0 유지). CSV·xlsx 내보내기 관례와 맞춘다. */
export function toFixed(value: Decimal, dp = 2): string {
  const rounded = round(value, dp);
  if (dp === 0) return rounded.split(".")[0];
  const [whole, fraction = ""] = rounded.split(".");
  return `${whole}.${fraction.padEnd(dp, "0")}`;
}

/** 두 ISO 시각 사이의 보유일수(내림). 보유기간 분기(365일/12개월)의 단일 기준점. */
export function holdingDays(acquiredAt: string, disposedAt: string): number {
  const from = Date.parse(acquiredAt);
  const to = Date.parse(disposedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) throw new Error("invalid timestamp");
  return Math.floor((to - from) / 86_400_000);
}
