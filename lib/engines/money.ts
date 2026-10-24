// Exact money arithmetic. Amounts are bigint minor units internally and
// canonical integer strings at the JSON boundary. Rates are decimal strings
// parsed into exact rationals. Nothing in this file touches a float.

export class EngineError extends Error {
  constructor(
    readonly code:
      | "invalid_money"
      | "negative_money"
      | "money_overflow"
      | "invalid_currency"
      | "invalid_rate"
      | "invalid_input",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * Largest magnitude we accept: 10^15 minor units ($10 trillion in cents).
 * Well inside Postgres bigint (9.2e18), so sums of thousands of amounts and
 * intermediate products in rate math cannot overflow storage.
 */
export const MAX_MINOR = 10n ** 15n;

const INTEGER = /^-?(0|[1-9]\d*)$/;

/** Parse a canonical minor-unit string ("12345", "-50", "0"). Rejects "", "1.5", "1e3", " 5", "007", null. */
export function parseMinor(value: unknown, field = "amount"): bigint {
  if (typeof value === "bigint") return checkRange(value, field);
  if (typeof value !== "string" || !INTEGER.test(value)) {
    throw new EngineError("invalid_money", `${field} must be an integer minor-unit string, got ${JSON.stringify(value)}`);
  }
  if (value === "-0") throw new EngineError("invalid_money", `${field} must not be "-0"`);
  return checkRange(BigInt(value), field);
}

/** Parse and require amount >= 0. */
export function parseNonNegativeMinor(value: unknown, field = "amount"): bigint {
  const n = parseMinor(value, field);
  if (n < 0n) throw new EngineError("negative_money", `${field} must not be negative`);
  return n;
}

export function checkRange(n: bigint, field = "amount"): bigint {
  if (n > MAX_MINOR || n < -MAX_MINOR) {
    throw new EngineError("money_overflow", `${field} exceeds the supported range of ±${MAX_MINOR} minor units`);
  }
  return n;
}

export function toMinor(n: bigint): string {
  return checkRange(n).toString();
}

export function sumMinor(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) total = checkRange(total + v, "sum");
  return total;
}

/** ISO 4217 minor-unit exponents that differ from 2. Unknown codes are rejected, not guessed. */
const EXPONENTS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};
const TWO_DIGIT = new Set([
  "USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "CNY", "HKD", "SGD", "INR",
  "MXN", "BRL", "ARS", "COP", "PEN", "ZAR", "NGN", "KES", "GHS", "EGP", "MAD",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "TRY", "ILS", "AED", "SAR",
  "QAR", "THB", "MYR", "IDR", "PHP", "PKR", "BDT", "LKR", "TWD", "UAH",
]);

export function currencyExponent(currency: string): number {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new EngineError("invalid_currency", `currency must be an ISO 4217 code, got ${JSON.stringify(currency)}`);
  }
  if (currency in EXPONENTS) return EXPONENTS[currency];
  if (TWO_DIGIT.has(currency)) return 2;
  throw new EngineError("invalid_currency", `currency ${currency} is not supported by the engine`);
}

/** An exact non-negative decimal as numerator / 10^scale. */
export interface Decimal {
  num: bigint;
  scale: number;
}

const DECIMAL = /^(0|[1-9]\d{0,11})(\.\d{1,12})?$/;

/** Parse a positive decimal rate such as "1.3995" or "0.005". Rejects floats-as-numbers, exponents, signs. */
export function parseRate(value: unknown, field = "rate", { allowZero = false } = {}): Decimal {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new EngineError("invalid_rate", `${field} must be a decimal string, got ${JSON.stringify(value)}`);
  }
  const [whole, frac = ""] = value.split(".");
  const digits = frac.replace(/^\./, "");
  const dec = { num: BigInt(whole + digits), scale: digits.length };
  if (!allowZero && dec.num === 0n) throw new EngineError("invalid_rate", `${field} must be greater than zero`);
  return dec;
}

export function formatDecimal(d: Decimal, maxScale = 8): string {
  const r = d.scale > maxScale ? divRound(d.num, 10n ** BigInt(d.scale - maxScale)) : d.num * 10n ** BigInt(Math.max(0, maxScale - d.scale));
  const s = r.toString().padStart(maxScale + 1, "0");
  const whole = s.slice(0, s.length - maxScale);
  const frac = s.slice(s.length - maxScale).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Integer division rounded half away from zero. This is the engine's single
 * rounding mode for cents; it is deterministic and documented in tests.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new EngineError("invalid_input", "division by zero");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -q : q;
}

export function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new EngineError("invalid_input", "denominator must be positive");
  if (numerator <= 0n) return -((-numerator) / denominator);
  return (numerator + denominator - 1n) / denominator;
}

/** amount × bps / 10,000, rounded half up to the minor unit. */
export function applyBps(amount: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) {
    throw new EngineError("invalid_rate", `basis points must be an integer in [0, 10000], got ${bps}`);
  }
  return divRound(amount * BigInt(bps), 10_000n);
}

/** amount × bps / 10,000 for ratios that may exceed 100% (price indexes), rounded half up. */
export function scaleBps(amount: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 1_000_000) {
    throw new EngineError("invalid_rate", `ratio basis points must be an integer in [0, 1000000], got ${bps}`);
  }
  return checkRange(divRound(amount * BigInt(bps), 10_000n));
}

/** amount × decimal, rounded half up. */
export function mulDecimal(amount: bigint, d: Decimal): bigint {
  return checkRange(divRound(amount * d.num, 10n ** BigInt(d.scale)));
}

/**
 * Convert minor units between currencies at `rate` (units of `to` per one unit
 * of `from`), adjusting for differing minor-unit exponents (USD 2, JPY 0, KWD 3).
 */
export function convertMinor(amountMinor: bigint, from: string, to: string, rate: string | Decimal): bigint {
  const d = typeof rate === "string" ? parseRate(rate) : rate;
  const shift = currencyExponent(to) - currencyExponent(from);
  if (from === to) {
    if (d.num !== 10n ** BigInt(d.scale)) throw new EngineError("invalid_rate", "same-currency conversion must use rate 1");
    return amountMinor;
  }
  let num = amountMinor * d.num;
  let den = 10n ** BigInt(d.scale);
  if (shift > 0) num *= 10n ** BigInt(shift);
  else if (shift < 0) den *= 10n ** BigInt(-shift);
  return checkRange(divRound(num, den), "converted amount");
}

/**
 * Split `total` across weights with the largest-remainder method so the parts
 * always sum to the total exactly. Ties go to the earlier index, so the result
 * is deterministic for a given member order.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) throw new EngineError("invalid_input", "allocation needs at least one weight");
  if (weights.some((w) => w < 0n)) throw new EngineError("invalid_input", "weights must be non-negative");
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) throw new EngineError("invalid_input", "weights must not all be zero");
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const parts = weights.map((w) => (abs * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (abs * w) % weightSum }));
  let left = abs - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of remainders) {
    if (left === 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return negative ? parts.map((p) => -p) : parts;
}
