// Ship, buy local, or cash for item prizes. The country table below is a
// declared simulation: round-number duty, tax and shipping estimates for
// demo countries, not a tariff schedule. Every recommendation carries
// truth "Simulated" so the UI labels it.
import type { Award, Person, Truth } from "@/lib/contracts";
import { formatMoney } from "@/lib/design/money";

import { EngineError, applyBps, parseNonNegativeMinor, scaleBps, toMinor } from "./money";

export interface CountryShipping {
  country: string;
  /** A carrier will take consumer electronics with lithium batteries to this country. */
  carrierAvailable: boolean;
  /** Import duty plus VAT/GST estimate on the declared value, in basis points. */
  dutyAndTaxBps: number;
  /** Value below which no duty is charged, USD minor. */
  deMinimisUsdMinor: bigint;
  /** Flat shipping estimate, USD minor. */
  shippingUsdMinor: bigint;
  /** Local retail price as basis points of the US price (e.g. 11000 = 10% higher), or null if not sold locally. */
  localPriceBps: number | null;
  transitDays: number;
}

export const SIMULATED_COUNTRY_TABLE: Record<string, CountryShipping> = {
  US: { country: "US", carrierAvailable: true, dutyAndTaxBps: 0, deMinimisUsdMinor: 0n, shippingUsdMinor: 2500n, localPriceBps: 10_000, transitDays: 3 },
  CA: { country: "CA", carrierAvailable: true, dutyAndTaxBps: 1_300, deMinimisUsdMinor: 11_000n, shippingUsdMinor: 6_500n, localPriceBps: 10_400, transitDays: 6 },
  MX: { country: "MX", carrierAvailable: true, dutyAndTaxBps: 1_900, deMinimisUsdMinor: 5_000n, shippingUsdMinor: 7_500n, localPriceBps: 11_800, transitDays: 8 },
  GB: { country: "GB", carrierAvailable: true, dutyAndTaxBps: 2_000, deMinimisUsdMinor: 0n, shippingUsdMinor: 8_500n, localPriceBps: 10_600, transitDays: 7 },
  DE: { country: "DE", carrierAvailable: true, dutyAndTaxBps: 1_900, deMinimisUsdMinor: 0n, shippingUsdMinor: 8_500n, localPriceBps: 10_700, transitDays: 7 },
  IN: { country: "IN", carrierAvailable: true, dutyAndTaxBps: 3_800, deMinimisUsdMinor: 0n, shippingUsdMinor: 9_500n, localPriceBps: 11_500, transitDays: 12 },
  BR: { country: "BR", carrierAvailable: true, dutyAndTaxBps: 6_000, deMinimisUsdMinor: 0n, shippingUsdMinor: 11_000n, localPriceBps: 14_000, transitDays: 18 },
  JP: { country: "JP", carrierAvailable: true, dutyAndTaxBps: 1_000, deMinimisUsdMinor: 7_000n, shippingUsdMinor: 9_000n, localPriceBps: 9_800, transitDays: 6 },
  NG: { country: "NG", carrierAvailable: false, dutyAndTaxBps: 3_500, deMinimisUsdMinor: 0n, shippingUsdMinor: 15_000n, localPriceBps: null, transitDays: 25 },
  AU: { country: "AU", carrierAvailable: true, dutyAndTaxBps: 1_000, deMinimisUsdMinor: 0n, shippingUsdMinor: 10_000n, localPriceBps: 10_500, transitDays: 9 },
};

export interface FulfillmentPolicy {
  /** Prefer local or cash when duty plus shipping exceeds this share of value. */
  maxLandedCostBps: number;
  /** Buy locally only when the local price is within this share of the US price. */
  maxLocalPremiumBps: number;
  /** Shipping slower than this is considered too slow. */
  maxTransitDays: number;
}

export const DEFAULT_FULFILLMENT_POLICY: FulfillmentPolicy = {
  maxLandedCostBps: 1_500,
  maxLocalPremiumBps: 11_000,
  maxTransitDays: 14,
};

export interface FulfillmentResult {
  recommendation: string;
  shippingMinor: string;
  localMinor: string;
  choice: "ship" | "local" | "cash";
  /** Duty and tax estimate on shipping, USD minor. */
  dutyMinor: string;
  truth: Truth;
  reasons: string[];
}

export function recommendFulfillment(
  award: Award,
  person: Person,
  policy: FulfillmentPolicy = DEFAULT_FULFILLMENT_POLICY,
): FulfillmentResult {
  const value = parseNonNegativeMinor(award.amountMinor, "award.amountMinor");
  if (award.currency !== "USD") {
    throw new EngineError("invalid_currency", "fulfillment estimates are in USD; convert the item value first");
  }
  const country = person.country.toUpperCase();
  const fmvNote = "Fair market value is reportable either way, so a tax form is still required.";

  if (award.kind === "cash") {
    return {
      recommendation: "Cash prize: pay out after the tax form and withholding.",
      shippingMinor: "0", localMinor: "0", dutyMinor: "0", choice: "cash", truth: "Simulated",
      reasons: ["The prize is already cash."],
    };
  }

  const row = SIMULATED_COUNTRY_TABLE[country];
  if (!row) {
    return {
      recommendation: `Cash equivalent: no shipping data for ${country}, so offer cash at fair market value. ${fmvNote}`,
      shippingMinor: "0", localMinor: "0", dutyMinor: "0", choice: "cash", truth: "Simulated",
      reasons: [`${country} is not in the simulated shipping table.`],
    };
  }

  const duty = value > row.deMinimisUsdMinor ? applyBps(value, row.dutyAndTaxBps) : 0n;
  const shipping = row.shippingUsdMinor + duty;
  const local = row.localPriceBps === null ? null : scaleBps(value, row.localPriceBps);
  const reasons: string[] = [];

  const shipBlocked = !row.carrierAvailable;
  const tooSlow = row.transitDays > policy.maxTransitDays;
  const tooCostly = value > 0n && shipping * 10_000n > value * BigInt(policy.maxLandedCostBps);
  if (shipBlocked) reasons.push(`No carrier takes battery electronics to ${country}.`);
  if (tooSlow) reasons.push(`Transit about ${row.transitDays} days.`);
  if (tooCostly) reasons.push(`Estimated shipping plus duty is ${formatMoney(shipping, "USD", { explicitUsd: true })} on a ${formatMoney(value, "USD", { explicitUsd: true })} item, over ${policy.maxLandedCostBps / 100}% of its value.`);

  const localOk = local !== null && local * 10_000n <= value * BigInt(policy.maxLocalPremiumBps);
  let choice: FulfillmentResult["choice"];
  if (country === "US" || (!shipBlocked && !tooSlow && !tooCostly)) {
    choice = "ship";
    reasons.push(country === "US" ? "Domestic winner." : "Ships cleanly with modest duty.");
  } else if (localOk) {
    choice = "local";
    reasons.push(`Estimated local price is ${formatMoney(local!)} in USD, with local warranty coverage.`);
  } else {
    choice = "cash";
    reasons.push(local === null ? `No local retail estimate for ${country}.` : `Estimated local price of ${formatMoney(local)} in USD is more than ${(policy.maxLocalPremiumBps - 10_000) / 100}% above US retail.`);
  }

  if (country !== "US") {
    reasons.push("When withholding applies to an item, the organization covers the tax on top of its value. For cash, the tax comes out of the payout.");
  }

  const label = { ship: "Ship the item", local: "Buy it locally", cash: "Offer the cash equivalent" }[choice];
  return {
    recommendation: `${label}. ${reasons.join(" ")} ${fmvNote}`,
    shippingMinor: toMinor(shipping),
    localMinor: local === null ? "0" : toMinor(local),
    dutyMinor: toMinor(duty),
    choice,
    truth: "Simulated",
    reasons,
  };
}
