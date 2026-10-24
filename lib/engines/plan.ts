// One call from "pay this person this gross" to every number on a Payout:
// tax first (rule-sourced), then the provider quote on the amount after
// withholding. Tax and provider fees stay separate computations.
import type { Payout, TaxRule } from "@/lib/contracts";
import { computeTax, type ComputeTaxResult } from "@/lib/tax";
import { quotePayout, type QuotePayoutResult } from "@/lib/payouts/quote";
import type { FxSnapshot } from "@/lib/payouts/fx";

export interface PlanPayoutInput {
  payerCountry: string;
  payeeCountry: string;
  paymentType: string;
  grossMinor: string;
  currency: string;
  destinationCurrency: string;
  hasValidForm: boolean;
  hasTin: boolean;
  year: number;
  ytdMinor: string;
  provider?: string;
  feesPaidBy?: "org" | "recipient";
  treatyClaim?: boolean;
  rules?: readonly TaxRule[];
  fx?: FxSnapshot;
}

export type PayoutAmounts = Pick<
  Payout,
  | "grossMinor" | "withholdingMinor" | "feeMinor" | "netMinor" | "currency" | "destinationCurrency"
  | "destinationNetMinor" | "fxRate" | "provider" | "truth" | "reason" | "ruleId" | "ruleVersion" | "ruleVerified"
> & { status: "held" | "proposed" };

export interface PlanPayoutResult {
  payout: PayoutAmounts;
  tax: ComputeTaxResult;
  /** Absent when nothing is left to send (zero net or item prize). */
  quote?: QuotePayoutResult;
}

export function planPayout(input: PlanPayoutInput): PlanPayoutResult {
  const tax = computeTax({ ...input });
  const afterTax = BigInt(tax.netMinor);
  // Item prizes send no cash; the withholding is paid by the org on top.
  const sendsCash = input.paymentType !== "item_prize" && afterTax > 0n;
  const quote = sendsCash
    ? quotePayout({
      amountMinor: tax.netMinor, currency: input.currency, destinationCurrency: input.destinationCurrency,
      provider: input.provider, feesPaidBy: input.feesPaidBy, destinationCountry: input.payeeCountry,
      payerCountry: input.payerCountry, fx: input.fx,
    })
    : undefined;
  const reason = [tax.reason, ...(quote?.warnings ?? [])].join(" ");
  return {
    tax,
    quote,
    payout: {
      grossMinor: input.grossMinor,
      withholdingMinor: tax.withholdingMinor,
      feeMinor: quote?.feeMinor ?? "0",
      netMinor: quote?.netMinor ?? (sendsCash ? tax.netMinor : "0"),
      currency: input.currency,
      destinationCurrency: input.destinationCurrency,
      destinationNetMinor: quote?.destinationNetMinor ?? "0",
      fxRate: quote?.fxRate ?? "1",
      provider: quote?.provider ?? (input.provider ?? "mock_wire"),
      truth: !tax.ruleVerified && tax.hold ? "Unverified rule" : quote?.truth ?? "Simulated",
      reason,
      ruleId: tax.ruleId,
      ruleVersion: tax.ruleVersion,
      ruleVerified: tax.ruleVerified,
      status: tax.hold ? "held" : "proposed",
    },
  };
}
