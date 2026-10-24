// FX reference rates. A cached table with a dated source keeps quotes
// deterministic offline; fetchReferenceRates() refreshes it from Frankfurter
// (ECB reference rates) when the network is available.
import { EngineError, formatDecimal, parseRate, type Decimal } from "@/lib/engines/money";

export interface FxSnapshot {
  base: "USD";
  /** ECB reference date the rates are for. */
  date: string;
  source: string;
  /** Units of the quote currency per 1 USD, as decimal strings. */
  rates: Record<string, string>;
}

/** Fetched from https://api.frankfurter.dev/v1/latest?base=USD on 2026-10-24 (ECB rates for 2026-10-23). */
export const CACHED_FX: FxSnapshot = {
  base: "USD",
  date: "2026-10-23",
  source: "Frankfurter / ECB reference rates (cached)",
  rates: {
    USD: "1", AUD: "1.424", BRL: "5.0465", CAD: "1.3995", CHF: "0.82435", CNY: "6.6702",
    EUR: "0.89342", GBP: "0.74804", INR: "94.94", JPY: "156.8", KRW: "1324.45", MXN: "18.7823",
  },
};

/**
 * Rate from `from` to `to` (units of `to` per 1 unit of `from`), derived from
 * USD-based reference rates and rounded to 8 places like numeric(18,8).
 */
export function crossRate(from: string, to: string, snapshot: FxSnapshot = CACHED_FX): string {
  if (from === to) return "1";
  const f = snapshot.rates[from];
  const t = snapshot.rates[to];
  if (!f || !t) throw new EngineError("invalid_currency", `no reference rate for ${!f ? from : to} on ${snapshot.date}`);
  const a = parseRate(f);
  const b = parseRate(t);
  // t / f, exactly, then rounded to 8 decimal places.
  const num = b.num * 10n ** BigInt(a.scale);
  const den = a.num * 10n ** BigInt(b.scale);
  const scaled: Decimal = { num: (num * 10n ** 10n) / den, scale: 10 };
  return formatDecimal(scaled, 8);
}

/** Apply a spread against the recipient: rate × (1 − spreadBps/10,000), 8 places. */
export function withSpread(rate: string, spreadBps: number): string {
  if (spreadBps === 0) return rate;
  const d = parseRate(rate);
  return formatDecimal({ num: d.num * BigInt(10_000 - spreadBps), scale: d.scale + 4 }, 8);
}

/** Server-only: refresh from Frankfurter. Falls back to the cached snapshot on any failure. */
export async function fetchReferenceRates(fetchImpl: typeof fetch = fetch): Promise<FxSnapshot> {
  try {
    const res = await fetchImpl("https://api.frankfurter.dev/v1/latest?base=USD", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return CACHED_FX;
    const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
    if (!body.date || !body.rates) return CACHED_FX;
    // JSON numbers here are short decimal literals; String() reproduces them exactly.
    const rates: Record<string, string> = { USD: "1" };
    for (const [k, v] of Object.entries(body.rates)) {
      const text = String(v);
      if (/^[A-Z]{3}$/.test(k) && /^\d+(\.\d{1,12})?$/.test(text)) rates[k] = text;
    }
    return { base: "USD", date: body.date, source: "Frankfurter / ECB reference rates", rates };
  } catch {
    return CACHED_FX;
  }
}
