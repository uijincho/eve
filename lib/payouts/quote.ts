// Fee and FX quotes. Fee tables are dated records with a source, like tax
// rules, and every quote says whether it is simulated or an estimate.
// Provider fees are separate from tax: quotePayout takes the amount after
// withholding and never computes tax itself.
import type { Truth } from "@/lib/contracts";
import {
  EngineError,
  applyBps,
  convertMinor,
  currencyExponent,
  parseNonNegativeMinor,
  toMinor,
} from "@/lib/engines/money";

import { CACHED_FX, crossRate, withSpread, type FxSnapshot } from "./fx";

export interface FeeSchedule {
  provider: "mock_wire" | "stripe" | "sponsor_packet";
  version: number;
  truth: Truth;
  effectiveFrom: string;
  sourceUrl: string;
  explanation: string;
  /** Flat fee per payout, in USD minor units (converted when sending another currency). */
  fixedUsdMinor: bigint;
  /** Percentage fee on the amount sent. */
  percentBps: number;
  /** Extra percentage when the payout crosses borders. */
  crossBorderBps: number;
  /** Flat intermediary-bank deduction on cross-border wires, USD minor. */
  intermediaryUsdMinor: bigint;
  /** Flat receiving-bank fee on cross-border wires, USD minor. */
  receivingUsdMinor: bigint;
  /** Spread under the reference rate when converting currency. */
  fxSpreadBps: number;
  deliveryDays: [number, number];
}

export const FEE_SCHEDULES: Record<FeeSchedule["provider"], FeeSchedule> = {
  mock_wire: {
    provider: "mock_wire", version: 1, truth: "Simulated", effectiveFrom: "2026-10-24",
    sourceUrl: "internal:mock-wire",
    explanation: "Simulated SWIFT wire: $25 sending fee, $15 intermediary deduction and $10 receiving fee on cross-border wires, 2% FX spread. Illustrates why a $1,000 wire lands as less; not any bank's real tariff.",
    fixedUsdMinor: 2500n, percentBps: 0, crossBorderBps: 0, intermediaryUsdMinor: 1500n, receivingUsdMinor: 1000n,
    fxSpreadBps: 200, deliveryDays: [2, 5],
  },
  stripe: {
    provider: "stripe", version: 1, truth: "Estimate", effectiveFrom: "2026-10-24",
    sourceUrl: "https://stripe.com/connect/pricing",
    explanation: "Stripe Connect published pricing read 2026-10-24 (Canadian page): 0.25% + 0.25 per payout sent; cross-border payouts \"starting at 0.25%\" of volume. The $2 monthly active account fee is not per payout and is excluded. The 1% conversion spread is our assumption, not a published figure. Estimate only.",
    fixedUsdMinor: 25n, percentBps: 25, crossBorderBps: 25, intermediaryUsdMinor: 0n, receivingUsdMinor: 0n,
    fxSpreadBps: 100, deliveryDays: [1, 3],
  },
  sponsor_packet: {
    provider: "sponsor_packet", version: 1, truth: "Estimate", effectiveFrom: "2026-10-24",
    sourceUrl: "internal:sponsor-packet",
    explanation: "The fiscal sponsor pays from its own account; Eve charges nothing and cannot see the sponsor's bank fees. Net assumes no deductions; reconciliation catches the difference.",
    fixedUsdMinor: 0n, percentBps: 0, crossBorderBps: 0, intermediaryUsdMinor: 0n, receivingUsdMinor: 0n,
    fxSpreadBps: 0, deliveryDays: [10, 30],
  },
};

const ALIASES: Record<string, FeeSchedule["provider"]> = {
  simulated: "mock_wire", mock: "mock_wire", mock_wire: "mock_wire", wire: "mock_wire",
  stripe: "stripe", stripe_test: "stripe", sponsor: "sponsor_packet", sponsor_packet: "sponsor_packet",
};

export interface QuotePayoutInput {
  /** Amount to pay out after withholding, in `currency` minor units. */
  amountMinor: string;
  currency: string;
  destinationCurrency: string;
  provider?: string;
  feesPaidBy?: "org" | "recipient";
  /** Recipient's country; cross-border fees apply when it differs from payerCountry. Defaults to cross-border iff currencies differ. */
  destinationCountry?: string;
  payerCountry?: string;
  fx?: FxSnapshot;
}

export interface QuotePayoutResult {
  feeMinor: string;
  netMinor: string;
  destinationNetMinor: string;
  fxRate: string;
  provider: string;
  truth: Truth;
  /** Fee lines in the source currency; they sum to feeMinor. */
  fees: { label: string; amountMinor: string }[];
  /** What the payer sends in total: amount + fees when the org pays, otherwise the amount. */
  payerCostMinor: string;
  midRate: string;
  fxSpreadBps: number;
  fxDate: string;
  fxSource: string;
  deliveryDays: [number, number];
  feeScheduleVersion: number;
  sourceUrl: string;
  warnings: string[];
}

function usdToSource(usdMinor: bigint, currency: string, fx: FxSnapshot): bigint {
  if (currency === "USD" || usdMinor === 0n) return usdMinor;
  return convertMinor(usdMinor, "USD", currency, crossRate("USD", currency, fx));
}

export function quotePayout(input: QuotePayoutInput): QuotePayoutResult {
  const amount = parseNonNegativeMinor(input.amountMinor, "amountMinor");
  if (amount === 0n) throw new EngineError("invalid_input", "cannot quote a zero payout");
  currencyExponent(input.currency);
  currencyExponent(input.destinationCurrency);
  const key = ALIASES[(input.provider ?? "mock_wire").toLowerCase()];
  if (!key) throw new EngineError("invalid_input", `unknown payout provider ${JSON.stringify(input.provider)}`);
  const s = FEE_SCHEDULES[key];
  const fx = input.fx ?? CACHED_FX;
  const feesPaidBy = input.feesPaidBy ?? "org";
  const converts = input.currency !== input.destinationCurrency;
  const crossBorder = input.destinationCountry
    ? input.destinationCountry !== (input.payerCountry ?? "US")
    : converts;

  const fees: { label: string; amount: bigint }[] = [];
  const fixed = usdToSource(s.fixedUsdMinor, input.currency, fx);
  if (fixed || s.percentBps) fees.push({ label: `${s.provider} fee`, amount: fixed + applyBps(amount, s.percentBps) });
  if (crossBorder) {
    if (s.crossBorderBps) fees.push({ label: "Cross-border fee", amount: applyBps(amount, s.crossBorderBps) });
    if (s.intermediaryUsdMinor) fees.push({ label: "Intermediary bank deduction", amount: usdToSource(s.intermediaryUsdMinor, input.currency, fx) });
    if (s.receivingUsdMinor) fees.push({ label: "Receiving bank fee", amount: usdToSource(s.receivingUsdMinor, input.currency, fx) });
  }
  const fee = fees.reduce((a, f) => a + f.amount, 0n);
  const warnings: string[] = [];

  let net = feesPaidBy === "org" ? amount : amount - fee;
  if (net < 0n) {
    warnings.push("Fees exceed the payout amount; the recipient would receive nothing. Choose another provider or have the org pay fees.");
    net = 0n;
  }

  const midRate = crossRate(input.currency, input.destinationCurrency, fx);
  const spreadBps = converts ? s.fxSpreadBps : 0;
  const rate = withSpread(midRate, spreadBps);
  const destinationNet = convertMinor(net, input.currency, input.destinationCurrency, rate);
  if (converts) warnings.push(`FX uses the ${fx.date} reference rate; the rate at payout will differ.`);

  return {
    feeMinor: toMinor(fee),
    netMinor: toMinor(net),
    destinationNetMinor: toMinor(destinationNet),
    fxRate: rate,
    provider: s.provider,
    truth: s.truth,
    fees: fees.map((f) => ({ label: f.label, amountMinor: toMinor(f.amount) })),
    payerCostMinor: toMinor(feesPaidBy === "org" ? amount + fee : amount),
    midRate,
    fxSpreadBps: spreadBps,
    fxDate: fx.date,
    fxSource: fx.source,
    deliveryDays: s.deliveryDays,
    feeScheduleVersion: s.version,
    sourceUrl: s.sourceUrl,
    warnings,
  };
}

/** Quote every provider and rank by what the recipient receives, then by delivery time. */
export function compareQuotes(input: Omit<QuotePayoutInput, "provider">, providers: string[] = ["stripe", "mock_wire", "sponsor_packet"]) {
  return providers
    .map((provider) => quotePayout({ ...input, provider }))
    .sort((a, b) => {
      const d = BigInt(b.destinationNetMinor) - BigInt(a.destinationNetMinor);
      if (d !== 0n) return d > 0n ? 1 : -1;
      const c = BigInt(a.payerCostMinor) - BigInt(b.payerCostMinor);
      if (c !== 0n) return c > 0n ? 1 : -1;
      return a.deliveryDays[1] - b.deliveryDays[1];
    });
}
