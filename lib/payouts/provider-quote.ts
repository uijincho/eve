// Adapts the JSON quote engine to the PayoutProvider Quote shape.
import { formatDecimal } from "@/lib/engines/money";

import type { PayoutProviderId, Quote } from "./index";
import { quotePayout } from "./quote";

/** Reference rates are daily; treat a quote as valid for 30 minutes. */
export const QUOTE_TTL_MS = 30 * 60 * 1000;

export function toProviderQuote(
  provider: Extract<PayoutProviderId, "mock_wire" | "stripe" | "sponsor_packet">,
  amountMinor: bigint,
  fromCcy: string,
  toCcy: string,
  country: string,
  now: number,
): Quote {
  const q = quotePayout({
    amountMinor: amountMinor.toString(), currency: fromCcy, destinationCurrency: toCcy,
    provider, feesPaidBy: "recipient", destinationCountry: country,
  });
  const fee = (label: string) => q.fees.find((f) => f.label === label);
  const intermediary = fee("Intermediary bank deduction");
  const receiving = fee("Receiving bank fee");
  const providerFee = BigInt(q.feeMinor) - BigInt(intermediary?.amountMinor ?? "0") - BigInt(receiving?.amountMinor ?? "0");
  return {
    id: `${provider}_q_${now}_${amountMinor}_${fromCcy}${toCcy}`,
    provider,
    sendAmount: { amountMinor, currency: fromCcy },
    providerFee: { amountMinor: providerFee, currency: fromCcy },
    intermediaryFee: intermediary ? { amountMinor: BigInt(intermediary.amountMinor), currency: fromCcy } : null,
    receivingFee: receiving ? { amountMinor: BigInt(receiving.amountMinor), currency: fromCcy } : null,
    fxRate: q.fxRate,
    fxSpread: q.fxSpreadBps ? formatDecimal({ num: BigInt(q.fxSpreadBps), scale: 4 }) : null,
    netReceived: { amountMinor: BigInt(q.destinationNetMinor), currency: toCcy },
    deliveryTime: { minBusinessDays: q.deliveryDays[0], maxBusinessDays: q.deliveryDays[1] },
    isEstimate: true,
    expiresAt: fromCcy === toCcy ? null : new Date(now + QUOTE_TTL_MS),
  };
}
