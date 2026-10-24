// Narrow adapter to the deterministic engines (lib/engines, owned by the
// engine worker). Every backend service calls engines only through this file.
//
// INTEGRATION: when lib/engines/index.ts lands, replace the fallback block
// below with:
//   export { computeTax, checkClaim, quotePayout, recommendFulfillment, startingRules } from "@/lib/engines";
// and keep the type exports (or re-export the engine's own types).
//
// The fallback is deliberately minimal and labeled; it exists so the backend
// and seed run before the engine merges. It reads rates from the passed rule
// rather than hardcoding tax policy.

import type { Award, Check, Claim, EventRecord, Organization, Person, TaxRule, Truth } from "@/lib/contracts";

export interface TaxInput {
  payerCountry: string; payeeCountry: string; paymentType: string; grossMinor: bigint;
  hasValidForm: boolean; hasTin: boolean; year: number; ytdMinor: bigint; rule?: TaxRule;
}
export interface TaxResult {
  withholdingMinor: bigint; netMinor: bigint; rateBps: number; ruleId: string; ruleVersion: number;
  ruleVerified: boolean; reportingForm: string; reportable: boolean; hold: boolean; reason: string;
}
export interface ClaimCheckInput {
  /** Contract claim plus `nameOnReceipt` (passenger/payer name) and `requiresReview` from extraction. */
  claim: Claim & { nameOnReceipt?: string | null; requiresReview?: boolean };
  person: Person; event: EventRecord; org: Organization; existingClaims: Claim[];
}
export interface ClaimCheckResult { checks: Check[]; status: Claim["status"]; reason: string }
export interface QuoteInput { amountMinor: bigint; currency: string; destinationCurrency: string; provider?: string; feesPaidBy?: "org" | "recipient" }
export interface QuoteResult { feeMinor: bigint; netMinor: bigint; destinationNetMinor: bigint; fxRate: string; provider: string; truth: Truth }
export interface FulfillmentResult { recommendation: string; shippingMinor: bigint; localMinor: bigint }

// ---------------------------------------------------------------- fallback

const US = "US";

function pickRule(rules: TaxRule[], input: Omit<TaxInput, "rule">): TaxRule | undefined {
  const payee = input.payeeCountry === US ? US : "*";
  return rules.find((r) => r.payerCountry === input.payerCountry && (r.payeeCountry === input.payeeCountry || r.payeeCountry === payee) && r.paymentType === input.paymentType)
    ?? rules.find((r) => r.payerCountry === input.payerCountry && r.payeeCountry === payee && r.paymentType === "prize");
}

export function computeTax(input: TaxInput): TaxResult {
  const rule = input.rule ?? pickRule(startingRules, input);
  if (!rule) {
    return { withholdingMinor: 0n, netMinor: input.grossMinor, rateBps: 0, ruleId: "none", ruleVersion: 0, ruleVerified: false, reportingForm: "", reportable: false, hold: true, reason: "No tax rule covers this payment; held for review." };
  }
  const reimbursement = input.paymentType === "reimbursement";
  let rateBps = rule.rateBps;
  if (rule.payeeCountry === US && !reimbursement && !input.hasTin) rateBps = 2400; // backup withholding without TIN
  const withholdingMinor = (input.grossMinor * BigInt(rateBps)) / 10000n;
  const threshold = BigInt(rule.thresholdMinor);
  const reportable = !reimbursement && (rule.payeeCountry !== US || input.ytdMinor + input.grossMinor >= threshold);
  const hold = !reimbursement && !input.hasValidForm;
  return {
    withholdingMinor, netMinor: input.grossMinor - withholdingMinor, rateBps, ruleId: rule.id, ruleVersion: rule.version,
    ruleVerified: rule.verified, reportingForm: rule.reportingForm, reportable, hold,
    reason: hold ? `A valid ${rule.form} is required before payment.` : rule.explanation,
  };
}

const DAY = 86_400_000;

export function checkClaim({ claim, person, event, org, existingClaims }: ClaimCheckInput): ClaimCheckResult {
  const usd = BigInt(claim.usdMinor);
  const cap = BigInt(event.travelCapMinor);
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");
  const checks: Check[] = [];
  const add = (code: string, label: string, passed: boolean, detail: string) => checks.push({ code, label, passed, detail });
  add("adult", "Recipient is an adult", person.adult, person.adult ? "Verified 18+ at event start." : "Recipient is under 18 at the event start date.");
  add("receipt", "Receipt attached", Boolean(claim.documentId || claim.receiptHash), claim.documentId || claim.receiptHash ? "Receipt on file." : "No receipt attached.");
  const dup = claim.receiptHash ? existingClaims.find((c) => c.id !== claim.id && c.receiptHash === claim.receiptHash && c.status !== "rejected") : undefined;
  add("duplicate", "Not a duplicate", !dup, dup ? `Same receipt as ${dup.id}.` : "No matching receipt.");
  if (claim.nameOnReceipt) {
    const match = norm(claim.nameOnReceipt) === norm(person.name);
    add("name", "Name matches profile", match, match ? "Name matches." : `Receipt name "${claim.nameOnReceipt}" differs from profile.`);
  }
  if (claim.type === "travel") {
    const travel = claim.travelDate ? Date.parse(claim.travelDate) : NaN;
    const okDates = Number.isFinite(travel) && travel >= Date.parse(event.startsAt) - 3 * DAY && travel <= Date.parse(event.endsAt) + 3 * DAY;
    add("dates", "Travel dates fit the event", okDates, okDates ? "Within the event window." : "Travel date is outside the event window.");
    const economy = !event.economyOnly || !claim.cabin || /economy/i.test(claim.cabin) && !/premium/i.test(claim.cabin);
    add("cabin", "Economy cabin", economy, economy ? "Economy." : `Cabin is ${claim.cabin}.`);
    add("cap", "Under travel cap", usd <= cap, `${usd} of ${cap} USD minor after FX (${claim.fxRate}, ${claim.fxSource}).`);
  } else {
    const banned = /alcohol|bar|liquor|wine|beer/i.test(`${claim.category} ${claim.merchant} ${claim.description}`);
    add("policy", "Allowed category", !banned, banned ? "Alcohol is not reimbursable." : `Category ${claim.category}.`);
  }
  const late = Date.parse(claim.createdAt) > Date.parse(event.endsAt) + 30 * DAY;
  add("deadline", "Submitted within 30 days", !late, late ? "Submitted after the 30-day deadline." : "On time.");
  if (claim.requiresReview) add("extraction", "Receipt read clearly", false, "Receipt extraction requires human review.");
  const failed = checks.filter((c) => !c.passed);
  if (failed.length) {
    const hard = failed.some((c) => c.code === "duplicate" || c.code === "adult");
    return { checks, status: hard ? "rejected" : "escalated", reason: failed.map((c) => c.detail).join(" ") };
  }
  if (usd > BigInt(org.agentLimitMinor)) return { checks, status: "escalated", reason: "All checks passed; above the auto-approve limit, so an organizer must approve." };
  return { checks, status: "approved", reason: "All checks passed within the auto-approve limit." };
}

export function quotePayout(input: QuoteInput): QuoteResult {
  const crossCurrency = input.currency !== input.destinationCurrency;
  // Simulated provider: 0.25% + 25c, plus a labeled flat FX table. Not real pricing.
  const feeMinor = input.amountMinor === 0n ? 0n : (input.amountMinor * 25n) / 10000n + 25n;
  const rates: Record<string, string> = { USD: "1", CAD: "1.37220000", EUR: "0.92150000", GBP: "0.79010000", INR: "83.90000000", BRL: "5.42000000", MXN: "18.10000000", JPY: "151.20000000", DEU: "0.92150000", NGN: "1580.00000000", AUD: "1.52000000", SGD: "1.35000000", KRW: "1370.00000000" };
  const fxRate = crossCurrency ? rates[input.destinationCurrency] ?? "1" : "1";
  const netMinor = input.feesPaidBy === "recipient" ? input.amountMinor - feeMinor : input.amountMinor;
  const [whole, frac = ""] = fxRate.split(".");
  const scaled = BigInt(whole + frac.padEnd(8, "0"));
  const destinationNetMinor = (netMinor * scaled) / 100_000_000n;
  return { feeMinor, netMinor, destinationNetMinor, fxRate, provider: input.provider ?? "simulated", truth: "Simulated" };
}

export function recommendFulfillment(award: Pick<Award, "kind" | "amountMinor">, person: Pick<Person, "country">): FulfillmentResult {
  const value = BigInt(award.amountMinor);
  if (award.kind === "cash") return { recommendation: "Cash prize: pay to the winner's bank account.", shippingMinor: 0n, localMinor: 0n };
  if (person.country === US) return { recommendation: "Ship the item domestically.", shippingMinor: 2500n, localMinor: value };
  const shippingMinor = 6500n + value / 5n; // shipping plus estimated duty
  return {
    recommendation: shippingMinor * 100n > value * 15n
      ? "Offer the cash equivalent: duty and shipping exceed 15% of value, and withholding cannot come out of an item."
      : "Buy locally in the winner's country.",
    shippingMinor, localMinor: value + value / 20n,
  };
}

export const startingRules: TaxRule[] = [
  { id: "us-us-prize", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "prize", rateBps: 0, thresholdMinor: "200000", form: "W-9", reportingForm: "1099-MISC", verified: true, sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-misc", explanation: "US person with a valid W-9: no withholding; 1099-MISC box 3 at $2,000 for 2026.", effectiveFrom: "2026-01-01" },
  { id: "us-us-stipend", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "stipend", rateBps: 0, thresholdMinor: "200000", form: "W-9", reportingForm: "1099-NEC", verified: true, sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-nec", explanation: "US person stipend: no withholding with a valid TIN; 1099-NEC at $2,000.", effectiveFrom: "2026-01-01" },
  { id: "us-foreign-prize", version: 2, payerCountry: "US", payeeCountry: "*", paymentType: "prize", rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S", verified: true, sourceUrl: "https://www.irs.gov/individuals/international-taxpayers/nra-withholding", explanation: "US payer, non-US individual, prize: 30% default withholding; 1042-S per payee.", effectiveFrom: "2026-01-01" },
  { id: "us-foreign-stipend", version: 1, payerCountry: "US", payeeCountry: "*", paymentType: "stipend", rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S", verified: true, sourceUrl: "https://www.irs.gov/individuals/international-taxpayers/nra-withholding", explanation: "US payer, non-US individual, stipend: 30% default withholding.", effectiveFrom: "2026-01-01" },
  { id: "us-any-reimbursement", version: 1, payerCountry: "US", payeeCountry: "*", paymentType: "reimbursement", rateBps: 0, thresholdMinor: "0", form: "profile", reportingForm: "", verified: false, sourceUrl: "https://www.irs.gov/publications/p463", explanation: "Substantiated travel reimbursement under an accountable plan: no withholding by default (advisor review).", effectiveFrom: "2026-01-01" },
  { id: "us-us-reimbursement", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "reimbursement", rateBps: 0, thresholdMinor: "0", form: "profile", reportingForm: "", verified: false, sourceUrl: "https://www.irs.gov/publications/p463", explanation: "Substantiated travel reimbursement under an accountable plan: no withholding by default (advisor review).", effectiveFrom: "2026-01-01" },
];
