// Tax engine: rule selection, withholding, form-specific thresholds, W-8
// validity, gross-up and year-to-date aggregates.
//
// Rates, thresholds, and forms come from versioned rule records (with
// effective dates and a source link), never from the model or hardcoded
// math. This is plain, tested code; the LLM only picks which facts apply.
import type { TaxRule } from "@/lib/contracts";
import { formatMoney } from "@/lib/design/money";
import {
  EngineError,
  applyBps,
  divCeil,
  parseNonNegativeMinor,
  sumMinor,
  toMinor,
} from "@/lib/engines/money";

import { startingRules } from "./rules";

export { startingRules, SOURCE_URLS } from "./rules";

export type PaymentType = "cash_prize" | "item_prize" | "stipend" | "reimbursement";
export const PAYMENT_TYPES: readonly PaymentType[] = ["cash_prize", "item_prize", "stipend", "reimbursement"];

export interface ComputeTaxInput {
  payerCountry: string;
  payeeCountry: string;
  paymentType: string;
  grossMinor: string;
  hasValidForm: boolean;
  hasTin: boolean;
  year: number;
  /** Year-to-date gross already paid to this payee on the same reporting form (see aggregateYtdByForm). */
  ytdMinor: string;
  /** Use this rule instead of selecting one. */
  rule?: TaxRule;
  /** Rules to select from; defaults to startingRules. Pass the DB rule table here. */
  rules?: readonly TaxRule[];
  /** The payee claimed a treaty benefit on W-8BEN line 10. */
  treatyClaim?: boolean;
}

export interface ComputeTaxResult {
  withholdingMinor: string;
  netMinor: string;
  rateBps: number;
  ruleId: string;
  ruleVersion: number;
  ruleVerified: boolean;
  reportingForm: string;
  reportable: boolean;
  hold: boolean;
  reason: string;
  /** Every rule that contributed, e.g. the prize rule plus backup withholding. */
  appliedRuleIds: string[];
  /** For a treaty claim: what the verified default rule would withhold, shown side by side. */
  defaultComparison?: { ruleId: string; rateBps: number; withholdingMinor: string; netMinor: string };
  /** For item prizes with withholding: the cash the org must add so tax is paid on top of the item. */
  grossUp?: { grossMinor: string; withholdingMinor: string };
}

function isPaymentType(t: string): t is PaymentType {
  return (PAYMENT_TYPES as readonly string[]).includes(t);
}

function payeeMatches(rulePayee: string, payee: string): number {
  if (rulePayee === payee) return 3;
  if (rulePayee.startsWith("NON") && rulePayee.length === 5) return payee !== rulePayee.slice(3) ? 2 : 0;
  if (rulePayee === "*") return 1;
  return 0;
}

function effectiveInYear(rule: TaxRule, year: number): boolean {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return rule.effectiveFrom <= end && (!rule.effectiveTo || rule.effectiveTo >= start);
}

/**
 * Pick the most specific rule effective in `year` for a payer/payee/payment
 * type. Specific country beats NONxx beats "*"; within that, the highest
 * version wins. Returns undefined when nothing applies.
 */
export function selectRule(
  rules: readonly TaxRule[],
  q: { payerCountry: string; payeeCountry: string; paymentType: string; year: number },
): TaxRule | undefined {
  let best: { rule: TaxRule; score: number } | undefined;
  for (const rule of rules) {
    if (rule.payerCountry !== q.payerCountry || rule.paymentType !== q.paymentType) continue;
    if (!effectiveInYear(rule, q.year)) continue;
    const score = payeeMatches(rule.payeeCountry, q.payeeCountry);
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && rule.version > best.rule.version)) {
      best = { rule, score };
    }
  }
  return best?.rule;
}

/** "1099-MISC box 3" → "1099-MISC". Thresholds aggregate per form, never across forms. */
export function formFamily(reportingForm: string): string {
  const m = /^(1099-[A-Z]+|1042-S|T4A|NR4|FTB Form 592)/.exec(reportingForm);
  return m ? m[1] : reportingForm;
}

/**
 * Whether a year's same-form total reaches a reporting threshold, as each
 * form's source words it. US 1099 boxes say "$2,000 or more" (>=). CRA's T4A
 * page says "more than $500" (>), so exactly $500 does not need a slip. The
 * CRA rules stay unverified; this only follows their documented wording.
 * Zero thresholds (any amount) are handled by the caller.
 */
export function thresholdReached(reportingForm: string, totalMinor: bigint, thresholdMinor: bigint): boolean {
  return formFamily(reportingForm) === "T4A" ? totalMinor > thresholdMinor : totalMinor >= thresholdMinor;
}

/**
 * Smallest gross G such that G − round(G × rate) ≥ net. Used when tax must
 * be paid on top of a non-cash prize or when the org promises a net amount.
 */
export function grossUp(netMinor: string | bigint, rateBps: number): { grossMinor: string; withholdingMinor: string } {
  const net = typeof netMinor === "bigint" ? netMinor : parseNonNegativeMinor(netMinor, "netMinor");
  if (rateBps >= 10_000) throw new EngineError("invalid_rate", "cannot gross up at a rate of 100% or more");
  let gross = divCeil(net * 10_000n, BigInt(10_000 - rateBps));
  while (gross > 0n && gross - 1n - applyBps(gross - 1n, rateBps) >= net) gross -= 1n;
  while (gross - applyBps(gross, rateBps) < net) gross += 1n;
  return { grossMinor: toMinor(gross), withholdingMinor: toMinor(applyBps(gross, rateBps)) };
}

function computeAt(gross: bigint, rateBps: number) {
  const withholding = applyBps(gross, rateBps);
  return { withholding, net: gross - withholding };
}

export function computeTax(input: ComputeTaxInput): ComputeTaxResult {
  const gross = parseNonNegativeMinor(input.grossMinor, "grossMinor");
  const ytd = parseNonNegativeMinor(input.ytdMinor, "ytdMinor");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new EngineError("invalid_input", `year must be a calendar year, got ${input.year}`);
  }
  const rules = input.rules ?? startingRules;
  const paymentType = input.paymentType;
  const q = { payerCountry: input.payerCountry, payeeCountry: input.payeeCountry, year: input.year };

  const defaultRule = selectRule(rules, { ...q, paymentType });
  const treatyRule = input.treatyClaim && isPaymentType(paymentType)
    ? selectRule(rules, { ...q, paymentType: `${paymentType}:treaty` })
    : undefined;
  const rule = input.rule ?? treatyRule ?? defaultRule;

  if (!rule) {
    return {
      withholdingMinor: "0", netMinor: toMinor(gross), rateBps: 0, ruleId: "none", ruleVersion: 0,
      ruleVerified: false, reportingForm: "Unknown", reportable: false, hold: true, appliedRuleIds: [],
      reason: `No tax rule covers ${input.payerCountry} payer → ${input.payeeCountry} payee for ${paymentType} in ${input.year}. Held for review.`,
    };
  }

  const reasons: string[] = [];
  const applied = [rule.id];
  let rateBps = rule.rateBps;

  const threshold = parseNonNegativeMinor(rule.thresholdMinor, `${rule.id}.thresholdMinor`);
  const aggregate = ytd + gross;
  const reportable = !/^None/i.test(rule.reportingForm) && (threshold === 0n ? aggregate > 0n : thresholdReached(rule.reportingForm, aggregate, threshold));

  // Backup withholding: a US payee with a W-9 but no TIN, on a reportable payment.
  if (input.payeeCountry === "US" && !input.hasTin && paymentType !== "reimbursement" && rateBps === 0) {
    const backup = selectRule(rules, { ...q, paymentType: "backup" });
    if (backup) {
      const backupThreshold = parseNonNegativeMinor(backup.thresholdMinor, `${backup.id}.thresholdMinor`);
      if (aggregate >= backupThreshold) {
        rateBps = backup.rateBps;
        applied.push(backup.id);
        reasons.push(`No TIN on file and the ${formFamily(rule.reportingForm)} total reaches the threshold, so backup withholding applies at ${rateBps / 100}% (${backup.id} v${backup.version}).`);
      } else {
        reasons.push(`No TIN on file; backup withholding (${backup.id}) starts once the ${formFamily(rule.reportingForm)} total reaches the threshold.`);
      }
    }
  }

  const { withholding, net } = computeAt(gross, rateBps);
  let hold = false;

  if (gross === 0n) {
    hold = true;
    reasons.unshift("Gross amount is zero; nothing to pay.");
  }
  if (!input.hasValidForm) {
    hold = true;
    reasons.unshift(`A valid ${rule.form} is missing or expired. Payment is held, not defaulted.`);
  }
  if (!rule.verified && paymentType !== "reimbursement") {
    hold = true;
    reasons.push(`Rule ${rule.id} v${rule.version} is unverified; a person must review it before payment.`);
  }

  if (rateBps > 0) reasons.push(`Withholding ${rateBps / 100}% under ${rule.id} v${rule.version}.`);
  else if (rule.verified) reasons.push(`No withholding under ${rule.id} v${rule.version}.`);
  reasons.push(
    reportable
      ? `Reportable on ${rule.reportingForm}.`
      : /^None/i.test(rule.reportingForm)
        ? "Not reported by default (advisor review flagged)."
        : `Below the ${rule.reportingForm} threshold for ${input.year} so far.`,
  );

  const result: ComputeTaxResult = {
    withholdingMinor: toMinor(withholding),
    netMinor: toMinor(net),
    rateBps,
    ruleId: rule.id,
    ruleVersion: rule.version,
    ruleVerified: rule.verified,
    reportingForm: rule.reportingForm,
    reportable,
    hold,
    reason: reasons.join(" "),
    appliedRuleIds: applied,
  };

  if (rule !== defaultRule && defaultRule) {
    const d = computeAt(gross, defaultRule.rateBps);
    result.defaultComparison = {
      ruleId: defaultRule.id, rateBps: defaultRule.rateBps,
      withholdingMinor: toMinor(d.withholding), netMinor: toMinor(d.net),
    };
  }
  if (paymentType === "item_prize" && rateBps > 0 && gross > 0n) {
    result.grossUp = grossUp(gross, rateBps);
    const currency = input.payerCountry === "CA" ? "CAD" : "USD";
    result.reason += ` Tax cannot be withheld from an item; the organization covers ${formatMoney(BigInt(result.grossUp.withholdingMinor), currency)} in tax, bringing the reportable value to ${formatMoney(BigInt(result.grossUp.grossMinor), currency)}. Offering cash is another option.`;
  }
  return result;
}

/** Last day of the third calendar year after signing (Instructions for Form W-8BEN). */
export function w8ExpiresAt(signedAt: string): string {
  const year = Number(signedAt.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}/.test(signedAt) || !Number.isFinite(year)) {
    throw new EngineError("invalid_input", `signedAt must be an ISO date, got ${JSON.stringify(signedAt)}`);
  }
  return `${year + 3}-12-31`;
}

export type FormValidity = "missing" | "valid" | "expired";

/** Whether a tax form is usable on `asOf` (ISO date). W-9s do not expire; W-8s use w8ExpiresAt. */
export function formValidity(form: { taxForm: string; taxSignedAt?: string; taxExpiresAt?: string }, asOf: string): FormValidity {
  if (!form.taxSignedAt) return "missing";
  const expires = form.taxExpiresAt ?? (form.taxForm.startsWith("W-8") ? w8ExpiresAt(form.taxSignedAt) : undefined);
  if (expires && asOf.slice(0, 10) > expires.slice(0, 10)) return "expired";
  return "valid";
}

export interface PaymentRecord {
  personId: string;
  reportingForm: string;
  grossMinor: string;
  /** ISO date the payment was made (or will be). */
  paidAt: string;
}

/**
 * Per-person, per-form gross for a calendar year. Pass the result for the
 * payment's own form family as computeTax's ytdMinor: a prize and a stipend
 * are on different forms and never share a threshold.
 */
export function aggregateYtdByForm(payments: readonly PaymentRecord[], personId: string, year: number): Record<string, string> {
  const buckets = new Map<string, bigint[]>();
  for (const p of payments) {
    if (p.personId !== personId || Number(p.paidAt.slice(0, 4)) !== year) continue;
    const key = formFamily(p.reportingForm);
    const list = buckets.get(key) ?? [];
    list.push(parseNonNegativeMinor(p.grossMinor, "grossMinor"));
    buckets.set(key, list);
  }
  return Object.fromEntries([...buckets].map(([k, v]) => [k, toMinor(sumMinor(v))]));
}

export interface StateFlag {
  ruleId: string;
  ruleVersion: number;
  verified: false;
  potentialWithholdingMinor: string;
  message: string;
}

/**
 * State-level layer for an event held in a US state. Returns review flags,
 * never withholding: these rules are unverified, so a person decides.
 */
export function stateRuleFlags(input: {
  eventState: string;
  payeeState?: string;
  paymentType: string;
  grossMinor: string;
  ytdMinor: string;
  year: number;
  rules?: readonly TaxRule[];
}): StateFlag[] {
  if (input.payeeState === input.eventState) return [];
  const gross = parseNonNegativeMinor(input.grossMinor, "grossMinor");
  const ytd = parseNonNegativeMinor(input.ytdMinor, "ytdMinor");
  const rule = selectRule(input.rules ?? startingRules, {
    payerCountry: `US-${input.eventState}`, payeeCountry: input.payeeState ?? "XX",
    paymentType: input.paymentType, year: input.year,
  });
  if (!rule) return [];
  const threshold = parseNonNegativeMinor(rule.thresholdMinor);
  if (ytd + gross <= threshold) return [];
  return [{
    ruleId: rule.id, ruleVersion: rule.version, verified: false,
    potentialWithholdingMinor: toMinor(applyBps(gross, rule.rateBps)),
    message: `Possible ${input.eventState} nonresident withholding (${rule.rateBps / 100}% over ${formatMoney(threshold)} for the year). Unverified; review before release.`,
  }];
}
