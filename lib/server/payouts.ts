// Payout lifecycle: propose (tax + quote via engines), release (controller
// only, segregation of duties, bank-version check, simulated provider, ledger),
// bank change freeze and original-channel verification, retry.
//
// Locking (every money path, same order everywhere, all re-entrant):
//   organization (FOR NO KEY UPDATE, lockOrgFinance) -> org_member -> person
//   (FOR UPDATE) -> payout -> award/claim -> payout_method / sponsor_packet.
// The org lock serializes budget room and payout state per organization; the
// person lock serializes same-form YTD totals and tax quotes per payee.
//
// Tax quotes and YTD: a payout's quote counts only *finalized* same-form
// payments (processing, paid, and in-kind fulfillments). Whenever a payment
// becomes final, every other unpaid payout for that person is re-quoted, and
// release recomputes the quote under the person lock. A quote that changes is
// written back as `proposed` with releasedBy cleared, which changes its
// approval fingerprint: the controller must approve the new terms.

import { createHash, randomInt } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { TaxRule } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { checkProjectSubmission } from "@/lib/engines/project-submission";
import { postJournal, type JournalLineInput } from "@/lib/ledger";

import { assertFits, claimBudgetRoom, ORG_BOOKED_FLIGHT, prizeBudgetRoom } from "./budget";
import {
  ActionError, conflict, currentProfile, forbidden, invalid, loadOrgEvent, loadPerson, maskEmail, profileValidFor, taxPayeeCountry,
  BOOKS_CURRENCY, methodsFor, money, notFound, recordDecision, recordNotice, toUsd, usd,
  type AwardRow, type ClaimRow, type EventRow, type MethodRow, type OrgRow, type PayoutRow, type PersonRow, type ProfileRow,
} from "./core";
import { aggregateYtdByForm, big, computeTax, formFamily, paymentTypeFor, quotePayout, selectRule } from "./engines";
import { constantTimeEqual, openSecret, sealSecret } from "./vault";

/** Unpaid statuses a quote can still change in. */
export const UNPAID = ["held", "proposed", "approved", "frozen"] as const;
const LIVE = [...UNPAID, "processing"] as const;
/** Payments that count toward same-form YTD thresholds. */
const FINAL = ["processing", "paid"] as const;
const SIMULATED_PROVIDER = "simulated";
export const SPONSOR_PROVIDER = "sponsor_packet";
export const IN_KIND_PROVIDER = "in_kind";

// ------------------------------------------------------------------ locks

/** Serializes money decisions for one organization. NO KEY UPDATE does not block FK inserts. */
export async function lockOrgFinance(tx: Executor, orgId: string): Promise<void> {
  const [row] = await tx.select({ id: s.organization.id }).from(s.organization).where(eq(s.organization.id, orgId)).for("no key update");
  if (!row) throw notFound("Organization not found.");
}

/** Org lock, then the payee's person row. Returns the person. */
export async function lockPayee(tx: Executor, orgId: string, personId: string): Promise<PersonRow> {
  await lockOrgFinance(tx, orgId);
  return loadPerson(tx, orgId, personId, true);
}

/** Locks org -> person -> payout for a payout id. */
async function lockPayoutChain(tx: Executor, orgId: string, payoutId: string) {
  await lockOrgFinance(tx, orgId);
  const [peek] = await tx.select({ personId: s.payout.personId }).from(s.payout).where(and(eq(s.payout.id, payoutId), eq(s.payout.orgId, orgId)));
  if (!peek) throw notFound("Payout not found.");
  const person = await loadPerson(tx, orgId, peek.personId, true);
  const [p] = await tx.select().from(s.payout).where(and(eq(s.payout.id, payoutId), eq(s.payout.orgId, orgId))).for("update");
  if (!p) throw notFound("Payout not found.");
  return { person, p };
}

/**
 * A person may never request, approve, review or release money to themselves.
 * Matches the member's linked person and, as a backstop for unlinked staff
 * accounts, the person's original email. Checked before any role exception.
 */
export function assertNotBeneficiary(actor: ActorContext, payee: string | Pick<PersonRow, "id" | "email">, verb: string): void {
  const id = typeof payee === "string" ? payee : payee.id;
  const email = typeof payee === "string" ? null : payee.email;
  const same = (actor.personId && actor.personId === id) || (email && actor.email && actor.email.trim().toLowerCase() === email.trim().toLowerCase());
  if (same) throw forbidden(`You are the recipient, so you cannot ${verb} this payment. Another ${actor.role === "controller" ? "controller" : "organizer"} must.`);
}

// ------------------------------------------------------------------ rules/YTD

export async function loadRules(db: Executor): Promise<TaxRule[]> {
  const rows = await db.select().from(s.taxRule);
  return rows.map((r) => ({
    id: r.id, version: r.version, payerCountry: r.payerCountry, payeeCountry: r.payeeCountry, paymentType: r.paymentType,
    rateBps: r.rateBps, thresholdMinor: r.thresholdMinor.toString(), form: r.form, reportingForm: r.reportingForm,
    verified: r.verified, sourceUrl: r.sourceUrl, explanation: r.explanation, effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? undefined,
  }));
}

interface PaymentRecord { personId: string; reportingForm: string; grossMinor: string; paidAt: string }

/**
 * Finalized prize/stipend payments to this person for same-form YTD: payouts
 * released or in flight to the sponsor, and in-kind item fulfillments (FMV).
 * Unpaid proposals are excluded; they are re-quoted when a sibling becomes final.
 */
export async function paymentsFor(db: Executor, personId: string, excludePayoutId?: string): Promise<PaymentRecord[]> {
  const rows = await db.select({ id: s.payout.id, gross: s.payout.grossMinor, form: s.payout.reportingForm, ruleId: s.payout.ruleId, paidAt: s.payout.paidAt, createdAt: s.payout.createdAt })
    .from(s.payout)
    .where(and(eq(s.payout.personId, personId), eq(s.payout.sourceType, "award"), inArray(s.payout.status, [...FINAL])));
  return rows.filter((r) => r.id !== excludePayoutId)
    .map((r) => ({ personId, reportingForm: r.form ?? r.ruleId, grossMinor: r.gross.toString(), paidAt: (r.paidAt ?? r.createdAt).toISOString() }));
}

// ------------------------------------------------------------------ sources

export interface PayoutSource {
  type: "claim" | "award";
  id: string;
  grossMinor: bigint;
  paymentType: string;
  dueAt: Date;
  /** Conversion into the USD books when the source was entered in another currency. */
  note?: string;
  /** The amount as entered on the source, before conversion (rule overrides bind to it). */
  originalMinor?: bigint;
  originalCurrency?: string;
}

export type RuleOverride = typeof s.taxRuleOverride.$inferSelect;

/** The live controller resolution of an unverified-rule hold for a source, if any. */
export async function liveOverride(tx: Executor, sourceType: "claim" | "award", sourceId: string): Promise<RuleOverride | undefined> {
  const [row] = await tx.select().from(s.taxRuleOverride)
    .where(and(eq(s.taxRuleOverride.sourceType, sourceType), eq(s.taxRuleOverride.sourceId, sourceId), sql`${s.taxRuleOverride.revokedAt} IS NULL`));
  return row;
}

export function sourceFromClaim(c: ClaimRow): PayoutSource {
  return { type: "claim", id: c.id, grossMinor: c.usdMinor, paymentType: paymentTypeFor({ kind: "claim" }), dueAt: c.dueAt };
}

export function sourceFromAward(a: AwardRow): PayoutSource {
  return { type: "award", id: a.id, grossMinor: a.amountMinor, paymentType: paymentTypeFor({ kind: "award", awardKind: a.kind, track: a.track, fulfillment: a.fulfillment }), dueAt: a.dueAt };
}

export interface LoadedSource { source: PayoutSource; personId: string; eventId: string; claim?: ClaimRow; award?: AwardRow; blockers: string[]; override?: RuleOverride }

/**
 * Loads (and locks) a payout's source and reports why it cannot be paid in
 * cash right now. Checked at proposal, on every re-quote and at release.
 */
export async function loadSource(tx: Executor, orgId: string, ref: { sourceType: "claim" | "award"; sourceId: string }, ownPayoutId?: string): Promise<LoadedSource> {
  if (ref.sourceType === "claim") {
    const [c] = await tx.select().from(s.claim).where(and(eq(s.claim.id, ref.sourceId), eq(s.claim.orgId, orgId))).for("update");
    if (!c) throw notFound("Claim not found.");
    const blockers: string[] = [];
    if (c.category === ORG_BOOKED_FLIGHT) blockers.push("Org-booked flights are bought by the organization; Eve never reimburses them to the attendee.");
    else if (c.status !== "approved" && !(c.status === "paid" && ownPayoutId)) blockers.push(`Claim is ${c.status}; only approved claims can be paid.`);
    return { source: { ...sourceFromClaim(c), originalMinor: c.amountMinor, originalCurrency: c.currency }, personId: c.personId, eventId: c.eventId, claim: c, blockers, override: await liveOverride(tx, "claim", c.id) };
  }
  const [a] = await tx.select().from(s.award).where(and(eq(s.award.id, ref.sourceId), eq(s.award.orgId, orgId))).for("update");
  if (!a) throw notFound("Award not found.");
  const blockers: string[] = [];
  if (a.kind === "item" && a.fulfillment !== "cash") {
    blockers.push(a.fulfillment === "undecided"
      ? "Item prize: choose ship, buy-local or the cash equivalent first."
      : `Item prize set to ${a.fulfillment === "ship" ? "ship" : "buy locally"}; it is fulfilled in kind by a controller, not paid in cash.`);
  }
  if (a.teamId) {
    const team = await tx.select({ ok: s.award.splitConfirmed }).from(s.award).where(eq(s.award.teamId, a.teamId));
    if (team.some((t) => !t.ok)) blockers.push("Every team member must confirm the prize split first.");
  }
  const source: PayoutSource = { ...sourceFromAward(a), originalMinor: a.amountMinor, originalCurrency: a.currency };
  if (a.currency !== BOOKS_CURRENCY) {
    const fx = await toUsd(tx, a.amountMinor, a.currency, new Date());
    source.grossMinor = fx.usdMinor;
    source.note = `${source.paymentType === "stipend" ? "Stipend" : "Prize"} of ${money(a.amountMinor, a.currency)} converted to ${usd(fx.usdMinor)} for the USD books at ${fx.fxRate} (${fx.fxSource}).`;
  }
  return { source, personId: a.personId, eventId: a.eventId, award: a, blockers, override: await liveOverride(tx, "award", a.id) };
}

// ------------------------------------------------------------------ quote

export interface PayoutContext {
  org: OrgRow; event: EventRow; person: PersonRow; profile?: ProfileRow; active?: MethodRow; pending?: MethodRow;
  payments: PaymentRecord[]; rules: TaxRule[]; now: Date;
}

/**
 * Same-form YTD and the engine's tax result for one payment. Pure. A live
 * controller override clears only an unverified-rule hold, and only while it
 * still matches the current form, source amount, payment type and rule
 * version; any other hold (form, minor, bank, budget) is untouched.
 */
export function taxFor(ctx: PayoutContext, paymentType: string, grossMinor: bigint, resolution?: { override?: RuleOverride; originalMinor?: bigint; originalCurrency?: string }) {
  const base = baseTax(ctx, paymentType, grossMinor);
  const o = resolution?.override;
  if (!o) return base;
  const { org, person, profile, now } = ctx;
  const matches = o.taxProfileId === profile?.id && o.paymentType === paymentType && o.ruleId === base.tax.ruleId && o.ruleVersion === base.tax.ruleVersion
    && o.amountMinor === (resolution?.originalMinor ?? grossMinor) && o.currency === (resolution?.originalCurrency ?? BOOKS_CURRENCY);
  if (!matches) return { ...base, tax: { ...base.tax, reason: `${base.tax.reason} An earlier controller resolution no longer applies because the form, amount or rule changed.` } };
  const onlyUnverified = base.tax.hold && !base.tax.ruleVerified && grossMinor > 0n && profileValidFor(profile, person, org.country, now);
  if (!onlyUnverified) return base;
  if (o.decision === "rule") {
    return { ...base, overrideId: o.id, tax: { ...base.tax, hold: false, reason: `${base.tax.reason} A controller accepted unverified rule ${o.ruleId} v${o.ruleVersion} for this payment only ("${o.reason}"); the rule itself stays unverified.` } };
  }
  const def = ctx.rules.find((r) => r.id === o.appliedRuleId && r.version === o.appliedRuleVersion);
  if (!def?.verified) return base;
  const forced = baseTax(ctx, paymentType, grossMinor, def);
  return { ...forced, overrideId: o.id, tax: { ...forced.tax, reason: `${forced.tax.reason} A controller applied the verified default ${def.id} v${def.version} instead of unverified ${o.ruleId} v${o.ruleVersion} ("${o.reason}").` } };
}

function baseTax(ctx: PayoutContext, paymentType: string, grossMinor: bigint, forceRule?: TaxRule): { tax: ReturnType<typeof computeTax>; ytdMinor: string; overrideId?: string } {
  const { org, person, profile, now } = ctx;
  // Tax year = the payment's calendar year (now: proposals are re-quoted at release), never the event's.
  // A year with no effective rule holds; an earlier year's rule is never reused.
  const year = now.getUTCFullYear();
  // YTD only counts payments on the same reporting form (1099-MISC and 1099-NEC thresholds are separate).
  const payeeCountry = taxPayeeCountry(org.country, person);
  const rule = selectRule(ctx.rules, { payerCountry: org.country, payeeCountry, paymentType, year });
  const ytdMinor = rule ? aggregateYtdByForm(ctx.payments, person.id, year)[formFamily(rule.reportingForm)] ?? "0" : "0";
  const tax = computeTax({
    payerCountry: org.country, payeeCountry, paymentType,
    grossMinor: grossMinor.toString(), hasValidForm: profileValidFor(profile, person, org.country, now), hasTin: Boolean(profile?.tinLast4),
    year, ytdMinor, rules: ctx.rules, treatyClaim: Boolean(profile?.treatyArticle), rule: forceRule,
  });
  return { tax, ytdMinor };
}

/** Pure: computes the payout row for a source. Tax and quote come from the engines. */
export function buildPayout(ctx: PayoutContext, source: PayoutSource, requestedBy: string, extraHolds: string[] = [], override?: RuleOverride) {
  const { org, person, active, pending } = ctx;
  const { tax, ytdMinor } = taxFor(ctx, source.paymentType, source.grossMinor, { override, originalMinor: source.originalMinor, originalCurrency: source.originalCurrency });
  const destinationCurrency = (pending ?? active)?.currency ?? person.payoutCurrency;
  const net = big(tax.netMinor);
  const quote = net > 0n
    ? quotePayout({ amountMinor: tax.netMinor, currency: "USD", destinationCurrency, provider: SIMULATED_PROVIDER, feesPaidBy: org.feesPaidBy, destinationCountry: person.country, payerCountry: org.country })
    : { feeMinor: "0", netMinor: "0", destinationNetMinor: "0", fxRate: "1", provider: "mock_wire", truth: "Simulated" as const, warnings: [] as string[] };

  const holds: string[] = [...extraHolds];
  if (!person.adult) holds.push("Recipient is under 18; Eve does not pay minors.");
  if (source.type === "claim" ? tax.hold && tax.ruleId === "none" : tax.hold) holds.push(tax.reason);
  if (!active && !pending) holds.push("No verified payout method on file.");
  let status: PayoutRow["status"] = holds.length ? "held" : "proposed";
  let frozenFrom: PayoutRow["status"] | null = null;
  let reason = `${holds.length ? holds.join(" ") : tax.reason}${source.note ? ` ${source.note}` : ""}`;
  if (destinationCurrency !== "USD" && "fxDate" in quote) {
    reason += ` Destination quote: 1 USD = ${quote.fxRate} ${destinationCurrency}, including ${quote.fxSpreadBps / 100}% FX spread (${quote.fxSource}, ${quote.fxDate}).`;
  }
  if (pending) {
    frozenFrom = status;
    status = "frozen";
    reason = `Bank details changed to ••${pending.last4}; frozen until confirmed through ${maskEmail(person.email)}. ${reason}`;
  }
  const row: typeof s.payout.$inferInsert = {
    id: newId("pay"), orgId: org.id, personId: person.id, sourceType: source.type,
    claimId: source.type === "claim" ? source.id : null, awardId: source.type === "award" ? source.id : null,
    grossMinor: source.grossMinor, withholdingMinor: big(tax.withholdingMinor), feeMinor: big(quote.feeMinor), netMinor: big(quote.netMinor),
    currency: "USD", destinationCurrency, destinationNetMinor: big(quote.destinationNetMinor), fxRate: quote.fxRate,
    provider: quote.provider, truth: quote.truth, status, frozenFrom, reason,
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion, ruleVerified: tax.ruleVerified,
    reportingForm: tax.reportingForm, reportable: tax.reportable, requestedBy,
    payoutMethodId: active?.id ?? null, bankVersion: active?.version ?? null,
    idempotencyKey: `payout:${source.type}:${source.id}:${newId("v")}`, dueAt: source.dueAt,
  };
  return { row, tax, quote, ytdMinor };
}

export async function loadPayoutContext(db: Executor, orgId: string, personId: string, excludePayoutId?: string): Promise<PayoutContext> {
  // Sequential: this often runs on a single transaction client.
  const { org, event } = await loadOrgEvent(db, orgId);
  const person = await loadPerson(db, orgId, personId);
  const profile = await currentProfile(db, personId);
  const methods = await methodsFor(db, personId);
  const { rules, payments } = await loadPayoutTaxContext(db, personId, excludePayoutId);
  return { org, event, person, profile, active: methods.active, pending: methods.pending, payments, rules, now: new Date() };
}

async function loadPayoutTaxContext(db: Executor, personId: string, excludePayoutId?: string) {
  // CRA thresholds are stated in CAD; the books are USD, so convert them before comparing.
  const rules = await Promise.all((await loadRules(db)).map(async (r) => r.payerCountry !== "CA" || r.thresholdMinor === "0" ? r
    : { ...r, thresholdMinor: (await toUsd(db, BigInt(r.thresholdMinor), "CAD", new Date())).usdMinor.toString() }));
  const payments = await paymentsFor(db, personId, excludePayoutId);
  return { rules, payments };
}

/** Fields a controller approves. Any difference means the quote changed. */
type Terms = Pick<PayoutRow, "grossMinor" | "withholdingMinor" | "feeMinor" | "netMinor" | "destinationCurrency" | "destinationNetMinor" | "fxRate" | "provider" | "ruleId" | "ruleVersion" | "ruleVerified" | "reportingForm" | "reportable" | "payoutMethodId" | "bankVersion" | "status">;

export function termsKey(t: Partial<Terms>): string {
  return JSON.stringify([t.grossMinor?.toString(), t.withholdingMinor?.toString(), t.feeMinor?.toString(), t.netMinor?.toString(), t.destinationCurrency,
    t.destinationNetMinor?.toString(), t.fxRate == null ? null : Number(t.fxRate).toFixed(8), t.provider, t.ruleId, t.ruleVersion, t.ruleVerified,
    t.reportingForm ?? null, t.reportable ?? false, t.payoutMethodId ?? null, t.bankVersion ?? null, t.status === "approved" ? "proposed" : t.status]);
}

function describeChange(before: PayoutRow, after: typeof s.payout.$inferInsert): string {
  const parts: string[] = [];
  if (before.withholdingMinor !== after.withholdingMinor) parts.push(`withholding ${usd(before.withholdingMinor)} → ${usd(after.withholdingMinor!)}`);
  if (before.netMinor !== after.netMinor) parts.push(`net ${usd(before.netMinor)} → ${usd(after.netMinor!)}`);
  if (before.reportable !== after.reportable) parts.push(after.reportable ? `now reportable on ${after.reportingForm}` : "no longer reportable");
  if (before.ruleId !== after.ruleId || before.ruleVersion !== after.ruleVersion) parts.push(`rule ${before.ruleId} v${before.ruleVersion} → ${after.ruleId} v${after.ruleVersion}`);
  if (before.status !== after.status) parts.push(`${before.status} → ${after.status}`);
  if (before.bankVersion !== after.bankVersion) parts.push("bank details");
  return parts.join(", ") || "quote details";
}

/**
 * Re-quotes an unpaid payout against the person's current state. Writes only
 * when terms changed; a written re-quote clears releasedBy, withdraws any
 * draft sponsor packet and logs old and new terms.
 */
export async function requote(tx: Executor, p: PayoutRow, ctx: PayoutContext, why: string, actor?: ActorContext): Promise<PayoutRow> {
  if (!(UNPAID as readonly string[]).includes(p.status)) return p;
  const loaded = await loadSource(tx, p.orgId, { sourceType: p.sourceType, sourceId: (p.claimId ?? p.awardId)! }, p.id);
  const { row } = buildPayout(ctx, loaded.source, p.requestedBy, loaded.blockers, loaded.override);
  // A frozen payout stays frozen until the bank change is resolved, whatever the hold reason.
  const changed = termsKey(row) !== termsKey(p) || (row.status === "held" && p.status === "held" && row.reason !== p.reason);
  if (!changed) return p;
  const [updated] = await tx.update(s.payout).set({
    grossMinor: row.grossMinor, withholdingMinor: row.withholdingMinor, feeMinor: row.feeMinor, netMinor: row.netMinor,
    destinationCurrency: row.destinationCurrency, destinationNetMinor: row.destinationNetMinor, fxRate: row.fxRate, provider: row.provider, truth: row.truth,
    status: row.status, frozenFrom: row.frozenFrom, reason: `${row.reason}${row.status === "proposed" && p.status !== "held" ? " Re-quoted; needs a fresh controller release." : ""}`,
    ruleId: row.ruleId, ruleVersion: row.ruleVersion,
    ruleVerified: row.ruleVerified, reportingForm: row.reportingForm, reportable: row.reportable, payoutMethodId: row.payoutMethodId, bankVersion: row.bankVersion,
    releasedBy: null,
  }).where(eq(s.payout.id, p.id)).returning();
  // A packet drafted against the old terms is stale.
  await tx.delete(s.sponsorPacket).where(and(eq(s.sponsorPacket.payoutId, p.id), inArray(s.sponsorPacket.status, ["draft", "questioned"])));
  if (p.awardId) await tx.update(s.award).set({ status: awardStatusFor(updated, ctx) }).where(eq(s.award.id, p.awardId));
  await recordDecision(tx, {
    orgId: p.orgId, objectType: "payout", objectId: p.id, personId: p.personId, personName: ctx.person.name, action: "payout.requote",
    summary: `Re-quoted (${why}): ${describeChange(p, row)}. ${updated.status === "proposed" ? "The earlier approval no longer applies; a controller must release the new terms." : updated.reason}`,
    actor: actor ?? { memberId: "agent", role: "agent", name: "Eve (agent)" }, status: updated.status === "proposed" ? "waiting" : updated.status === "frozen" ? "frozen" : "escalated",
    tool: "computeWithholding+quotePayouts", ruleId: updated.ruleId, ruleVersion: updated.ruleVersion,
    facts: { why, before: { grossMinor: p.grossMinor.toString(), withholdingMinor: p.withholdingMinor.toString(), netMinor: p.netMinor.toString(), reportable: p.reportable, status: p.status }, after: { grossMinor: String(row.grossMinor), withholdingMinor: String(row.withholdingMinor), netMinor: String(row.netMinor), reportable: row.reportable, status: row.status } },
  });
  return updated;
}

/** Award status that mirrors its payout: held for a form -> needs_form, otherwise proposed or paid. */
export function awardStatusFor(p: Pick<PayoutRow, "status">, ctx: Pick<PayoutContext, "profile" | "now" | "person" | "org">): AwardRow["status"] {
  if (p.status === "paid") return "paid";
  if (p.status === "held" && !profileValidFor(ctx.profile, ctx.person, ctx.org.country, ctx.now)) return "needs_form";
  return "proposed";
}

/** Re-quotes every other unpaid payout for a person (after a payment becomes final, a form change, a rule change). */
export async function requoteSiblings(tx: Executor, orgId: string, personId: string, why: string, exceptPayoutId?: string, actor?: ActorContext) {
  const rows = await tx.select().from(s.payout).where(and(eq(s.payout.personId, personId), eq(s.payout.orgId, orgId), inArray(s.payout.status, [...UNPAID]))).for("update");
  const others = rows.filter((r) => r.id !== exceptPayoutId);
  if (!others.length) return 0;
  const ctx = await loadPayoutContext(tx, orgId, personId);
  let changed = 0;
  for (const p of others) {
    const after = await requote(tx, p, ctx, why, actor);
    if (after !== p) changed++;
  }
  return changed;
}

async function assertBudget(tx: Executor, loaded: LoadedSource, grossMinor: bigint, payoutId: string | null, verb: string) {
  if (loaded.claim) assertFits(await claimBudgetRoom(tx, loaded.claim), loaded.claim.usdMinor, verb);
  else assertFits(await prizeBudgetRoom(tx, loaded.eventId, payoutId), grossMinor, verb);
}

// ------------------------------------------------------------------ propose

/** payout.propose. Requested by an organizer or the agent; one live payout per source. */
export async function proposePayout(tx: Executor, actor: ActorContext, input: { sourceType: "claim" | "award"; sourceId: string }) {
  if (actor.role !== "organizer" && actor.role !== "agent") throw forbidden("Only organizers or the agent can request a payout.");
  await lockOrgFinance(tx, actor.orgId);
  // Find the payee, then lock person before the source row (lock order).
  const table = input.sourceType === "claim" ? s.claim : s.award;
  const [peek] = await tx.select({ personId: table.personId }).from(table).where(and(eq(table.id, input.sourceId), eq(table.orgId, actor.orgId)));
  if (!peek) throw notFound(input.sourceType === "claim" ? "Claim not found." : "Award not found.");
  assertNotBeneficiary(actor, await loadPerson(tx, actor.orgId, peek.personId, true), "request");
  const loaded = await loadSource(tx, actor.orgId, input);
  if (loaded.award && (loaded.award.status === "paid")) throw conflict("Award is already paid or fulfilled.");
  if (loaded.blockers.length) throw conflict(loaded.blockers.join(" "));
  const existing = await tx.select({ id: s.payout.id, status: s.payout.status }).from(s.payout)
    .where(and(input.sourceType === "claim" ? eq(s.payout.claimId, input.sourceId) : eq(s.payout.awardId, input.sourceId), inArray(s.payout.status, [...LIVE, "paid"])));
  if (existing[0]) throw new ActionError(409, `A payout already exists for this ${input.sourceType} (${existing[0].status}).`, { payoutId: existing[0].id });
  await assertBudget(tx, loaded, loaded.source.grossMinor, null, "Proposing");

  const ctx = await loadPayoutContext(tx, actor.orgId, loaded.personId);
  const { row, tax, quote, ytdMinor } = buildPayout(ctx, loaded.source, actor.memberId, [], loaded.override);
  const pending = await tx.select({ id: s.payout.id, gross: s.payout.grossMinor }).from(s.payout)
    .where(and(eq(s.payout.personId, loaded.personId), eq(s.payout.sourceType, "award"), inArray(s.payout.status, [...UNPAID])));
  if (input.sourceType === "award" && pending.length) {
    row.reason = `${row.reason} ${pending.length} other unpaid prize payout(s) for this person; whichever is released first changes this quote's YTD, and Eve will re-quote it.`;
  }
  await tx.insert(s.payout).values(row);
  if (input.sourceType === "award") await tx.update(s.award).set({ status: awardStatusFor({ status: row.status! }, ctx) }).where(eq(s.award.id, input.sourceId));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "payout", objectId: row.id!, personId: loaded.personId, personName: ctx.person.name, action: "payout.propose",
    summary: row.status === "proposed"
      ? `Proposed ${usd(row.grossMinor)} gross, ${usd(row.withholdingMinor!)} withheld, est. ${usd(row.netMinor!)} net for controller release.`
      : `Payout ${row.status}: ${row.reason}`,
    actor, status: row.status === "proposed" ? "waiting" : row.status === "frozen" ? "frozen" : "escalated", tool: "computeWithholding+quotePayouts",
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion,
    facts: { sourceType: input.sourceType, sourceId: input.sourceId, tax, quote: { ...quote }, ytdMinor, ytdBasis: "finalized same-form payments (processing, paid, in-kind)" },
  });
  return row;
}

// ------------------------------------------------------------------ release

function simulatedProviderRef(idempotencyKey: string) {
  return `sim_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20)}`;
}

type Category = "travel" | "expense" | "prize" | "stipend";
const EXPENSE_ACCOUNT = { travel: "5000", expense: "5010", stipend: "5200", prize: "5100" } as const;

/** Accrual: expense -> withholding payable + AP to the recipient. Idempotent per payout. */
export async function postAccrual(tx: Executor, p: PayoutRow, createdBy: string, category: Category) {
  const ap = p.grossMinor - p.withholdingMinor;
  const accrual: JournalLineInput[] = [{ account: EXPENSE_ACCOUNT[category], debitMinor: p.grossMinor, currency: "USD", personId: p.personId, memo: "Gross" }];
  if (p.withholdingMinor > 0n) accrual.push({ account: "2100", creditMinor: p.withholdingMinor, currency: "USD", personId: p.personId, memo: `Withholding (${p.ruleId} v${p.ruleVersion})` });
  if (ap > 0n) accrual.push({ account: "2000", creditMinor: ap, currency: "USD", personId: p.personId, memo: "Payable to recipient" });
  if (accrual.length >= 2) {
    await postJournal(tx, { orgId: p.orgId, memo: `Accrue ${p.sourceType} ${p.claimId ?? p.awardId}`, sourceType: "payout", sourceId: p.id, idempotencyKey: `accrual:${p.id}`, createdBy, lines: accrual });
  }
}

/** Accrual (expense -> withholding + AP) and payment (AP -> cash, fee) entries, idempotent per payout. */
export async function postPayoutJournals(tx: Executor, p: PayoutRow, createdBy: string, category: Category) {
  await postAccrual(tx, p, createdBy, category);
  const ap = p.grossMinor - p.withholdingMinor;
  const cashAccount = p.truth === "Test mode" ? "1010" : "1000";
  const payment: JournalLineInput[] = [];
  if (ap > 0n) {
    payment.push({ account: "2000", debitMinor: ap, currency: "USD", personId: p.personId, memo: "Settle payable" });
    payment.push({ account: cashAccount, creditMinor: ap, currency: "USD", memo: `${p.provider} ${p.providerRef ?? ""}`.trim() });
  }
  // When the org bears fees they are an expense on top; recipient-paid fees come out of the transfer.
  const recipientPaysFees = p.netMinor < ap;
  if (p.feeMinor > 0n && !recipientPaysFees) {
    payment.push({ account: "5300", debitMinor: p.feeMinor, currency: "USD", memo: "Provider fee (estimate)" });
    payment.push({ account: cashAccount, creditMinor: p.feeMinor, currency: "USD", memo: "Provider fee" });
  }
  if (payment.length >= 2) {
    await postJournal(tx, { orgId: p.orgId, memo: `Pay ${p.id}`, sourceType: "payout", sourceId: p.id, idempotencyKey: `payment:${p.id}`, createdBy, lines: payment });
  }
}

export async function payoutCategory(tx: Executor, p: Pick<PayoutRow, "claimId" | "awardId">): Promise<Category> {
  if (p.claimId) {
    const [c] = await tx.select({ type: s.claim.type }).from(s.claim).where(eq(s.claim.id, p.claimId));
    return c?.type === "travel" ? "travel" : "expense";
  }
  const [a] = await tx.select({ track: s.award.track }).from(s.award).where(eq(s.award.id, p.awardId!));
  return a && /stipend|judge|mentor|speaker/i.test(a.track) ? "stipend" : "prize";
}

export type ReleaseCheck =
  | { kind: "ready"; p: PayoutRow; person: PersonRow; methods: { active?: MethodRow; pending?: MethodRow } }
  | { kind: "requoted"; payout: PayoutRow };

export async function assertNotInBatch(tx: Executor, payoutId: string, allowedBatchId?: string) {
  const [reservation] = await tx.select().from(s.disbursementBatchItem).where(eq(s.disbursementBatchItem.payoutId, payoutId));
  if (reservation && reservation.batchId !== allowedBatchId) throw conflict(`This payout belongs to batch ${reservation.batchId}. Open Disburse to follow or cancel that batch.`);
}


/**
 * Shared release gate for direct release and sponsor submission. Takes the
 * org -> person -> payout locks, checks authority (controller, never the
 * requester, never the beneficiary), state, form, bank version, source
 * eligibility and budget, then recomputes the quote. A changed quote is
 * written back (status proposed, approval void) and returned as "requoted".
 */

export async function prepareRelease(tx: Executor, actor: ActorContext, payoutId: string, route: "direct" | "sponsor", opts: { expectTerms?: string; batchId?: string } = {}): Promise<ReleaseCheck> {
  if (actor.role !== "controller") throw forbidden(actor.role === "agent" ? "The agent can never release money." : "Only a controller can release payouts.");
  const { person, p } = await lockPayoutChain(tx, actor.orgId, payoutId);
  await assertNotInBatch(tx, payoutId, opts.batchId);
  if (p.requestedBy === actor.memberId) throw forbidden("You requested this payout, so another controller must release it.");
  assertNotBeneficiary(actor, person, "release");
  if (p.status === "paid") throw conflict("Payout is already paid.");
  if (p.status === "processing") throw conflict(p.provider === SPONSOR_PROVIDER ? "Payout was already submitted to the sponsor." : "Payout is already in flight.");
  if (p.status !== "proposed" && p.status !== "approved") throw conflict(`Payout is ${p.status}: ${p.reason}`);
  if (opts.expectTerms && termsKey(p) !== opts.expectTerms) throw conflict("This payout was re-quoted after you reviewed it; review the new terms and release again.");
  const { org, event } = await loadOrgEvent(tx, actor.orgId);
  const [packet] = await tx.select({ id: s.sponsorPacket.id, status: s.sponsorPacket.status }).from(s.sponsorPacket).where(eq(s.sponsorPacket.payoutId, p.id)).for("update");
  if (route === "direct") {
    if (org.mode === "sponsor") throw conflict("This organization pays through its fiscal sponsor. Draft and submit a sponsor packet instead of a direct release.");
    if (packet) throw conflict(`This payout belongs to sponsor packet ${packet.id} (${packet.status}); the sponsor pays it, so it cannot also be released directly.`);
  }
  const profile = await currentProfile(tx, p.personId);
  const methods = await methodsFor(tx, p.personId);
  if (!person.adult) throw conflict("Recipient is under 18; payment blocked.");
  if (p.sourceType === "award" && !profileValidFor(profile, person, org.country, new Date())) throw conflict("Tax form is missing, invalid or no longer matches the profile; payment held.");
  if (methods.pending) throw conflict(`Bank details changed to ••${methods.pending.last4}; payout is frozen pending verification.`);
  if (!methods.active || methods.active.version !== p.bankVersion || methods.active.id !== p.payoutMethodId) {
    throw conflict("This payout was quoted against outdated bank details; it must be re-proposed and re-approved.");
  }
  const loaded = await loadSource(tx, actor.orgId, { sourceType: p.sourceType, sourceId: (p.claimId ?? p.awardId)! }, p.id);
  if (loaded.blockers.length) throw conflict(loaded.blockers.join(" "));
  if (loaded.claim?.type === "travel") {
    // Status can change after approval (unknown before closing, none later). Hold here; do not reject the claim.
    const project = checkProjectSubmission({
      role: person.role, name: person.name, projectStatus: person.projectStatus, projectUrl: person.projectUrl,
      claimType: "travel", closingAt: event.closingAt.toISOString(), asOf: new Date().toISOString(),
    });
    if (project.applies && !project.check.passed) throw conflict(project.check.detail);
  }
  await assertBudget(tx, loaded, p.grossMinor, p.id, "Releasing");
  // Recompute tax and quote under the person lock with finalized YTD.
  // These facts were just loaded under the same finance/person locks. Reuse
  // them, but always read current finalized payments for the YTD calculation.
  const ctx: PayoutContext = {
    org, event, person, profile, active: methods.active, pending: methods.pending,
    ...await loadPayoutTaxContext(tx, p.personId, p.id), now: new Date(),
  };
  const { row } = buildPayout(ctx, loaded.source, p.requestedBy, [], loaded.override);
  if (termsKey(row) !== termsKey(p)) {
    const updated = await requote(tx, p, ctx, "terms changed before release", actor);
    return { kind: "requoted", payout: updated };
  }
  return { kind: "ready", p, person, methods };
}

/**
 * payout.release for one payout. Controller only; never the requester or the
 * recipient; never the agent. Returns the paid row, or, when the quote changed
 * under the lock, the re-quoted row (status "proposed"/"held"): the caller must
 * commit and ask for a fresh approval rather than report a release.
 */
export async function releasePayout(tx: Executor, actor: ActorContext, payoutId: string, opts: { expectTerms?: string } = {}): Promise<PayoutRow> {
  const check = await prepareRelease(tx, actor, payoutId, "direct", opts);
  if (check.kind === "requoted") return check.payout;
  const { p, person, methods } = check;
  await tx.insert(s.approval).values({
    id: newId("apr"), orgId: actor.orgId, objectType: "payout", objectId: p.id, requestedBy: p.requestedBy,
    approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: "Released", bankVersion: p.bankVersion,
  });
  const attempts = p.attempts + 1;
  const providerRef = simulatedProviderRef(p.idempotencyKey);
  const now = new Date();
  const [paid] = await tx.update(s.payout)
    .set({ status: "paid", releasedBy: actor.memberId, providerRef, paidAt: now, attempts })
    .where(and(eq(s.payout.id, p.id), inArray(s.payout.status, ["proposed", "approved"]))).returning();
  if (!paid) throw conflict("Payout changed while releasing; try again.");
  await postPayoutJournals(tx, paid, actor.memberId, await payoutCategory(tx, paid));
  if (p.claimId) await tx.update(s.claim).set({ status: "paid" }).where(eq(s.claim.id, p.claimId));
  if (p.awardId) await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, p.awardId));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "payout", objectId: p.id, personId: p.personId, personName: person.name, action: "payout.release",
    summary: `Released ${usd(p.netMinor)} to ••${methods.active!.last4} by wire (${providerRef}).`,
    actor, status: "done", tool: "executePayout", ruleId: p.ruleId, ruleVersion: p.ruleVersion,
    facts: { providerRef, idempotencyKey: p.idempotencyKey, truth: p.truth, bankVersion: p.bankVersion, requestedBy: p.requestedBy, reportable: p.reportable, reportingForm: p.reportingForm },
  });
  if (p.sourceType === "award") await requoteSiblings(tx, actor.orgId, p.personId, `${usd(p.grossMinor)} payment ${p.id} became final`, p.id, actor);
  return paid;
}

/**
 * payout.retry for a failed payout. It never re-sends the old terms: the row
 * is re-quoted against current form, bank, rules, YTD and budget and returns
 * to proposed (or held/frozen), keeping its idempotency key so a provider can
 * deduplicate. A controller must then release it like any other proposal.
 */
export async function retryPayout(tx: Executor, actor: ActorContext, payoutId: string): Promise<PayoutRow> {
  if (actor.role !== "controller") throw forbidden("Only a controller can retry payouts.");
  const { p, person } = await lockPayoutChain(tx, actor.orgId, payoutId);
  if (p.status !== "failed") throw conflict(`Only failed payouts can be retried (this one is ${p.status}).`);
  if (p.requestedBy === actor.memberId) throw forbidden("You requested this payout, so another controller must retry it.");
  assertNotBeneficiary(actor, person, "retry");
  const live = await tx.select({ id: s.payout.id }).from(s.payout)
    .where(and(p.claimId ? eq(s.payout.claimId, p.claimId) : eq(s.payout.awardId, p.awardId!), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
  if (live.length) throw conflict("Another payout for this source is already live; it cannot be retried.");
  const loaded = await loadSource(tx, actor.orgId, { sourceType: p.sourceType, sourceId: (p.claimId ?? p.awardId)! }, p.id);
  const ctx = await loadPayoutContext(tx, actor.orgId, p.personId, p.id);
  const { row } = buildPayout(ctx, loaded.source, p.requestedBy, loaded.blockers, loaded.override);
  const [updated] = await tx.update(s.payout).set({
    grossMinor: row.grossMinor, withholdingMinor: row.withholdingMinor, feeMinor: row.feeMinor, netMinor: row.netMinor,
    destinationCurrency: row.destinationCurrency, destinationNetMinor: row.destinationNetMinor, fxRate: row.fxRate, provider: row.provider, truth: row.truth,
    status: row.status, frozenFrom: row.frozenFrom, reason: `Retry after failure: ${row.reason}`, ruleId: row.ruleId, ruleVersion: row.ruleVersion, ruleVerified: row.ruleVerified,
    reportingForm: row.reportingForm, reportable: row.reportable, payoutMethodId: row.payoutMethodId, bankVersion: row.bankVersion, releasedBy: null, providerRef: null, paidAt: null,
  }).where(and(eq(s.payout.id, p.id), eq(s.payout.status, "failed"))).returning();
  if (!updated) throw conflict("Payout changed while retrying; try again.");
  if (p.awardId) await tx.update(s.award).set({ status: awardStatusFor(updated, ctx) }).where(eq(s.award.id, p.awardId));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "payout", objectId: p.id, personId: p.personId, personName: person.name, action: "payout.retry",
    summary: `Failed payout re-quoted (${describeChange(p, row)}); it is ${updated.status} and needs a fresh controller release. Idempotency key kept.`,
    actor, status: updated.status === "proposed" ? "waiting" : "escalated", tool: "computeWithholding+quotePayouts", ruleId: updated.ruleId, ruleVersion: updated.ruleVersion,
    facts: { idempotencyKey: p.idempotencyKey },
  });
  return updated;
}

const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * First-account enrollment applies only when the signed-in attendee enters an
 * account for their own person record from the portal and that person has
 * never had an active or confirmed method. Staff never qualify. Every later
 * change goes through the freeze and original-email verification below.
 */
export function isInitialEnrollment(actor: Pick<ActorContext, "role" | "personId">, personId: string, history: readonly Pick<MethodRow, "status" | "verifiedAt">[], requestedVia?: string): boolean {
  if (actor.role !== "attendee" || !actor.personId || actor.personId !== personId) return false;
  if (requestedVia !== undefined && requestedVia !== "portal") return false;
  return !history.some((m) => m.status === "active" || m.status === "superseded" || m.verifiedAt !== null);
}

/**
 * Activates an attendee's first payout account. Called under the org -> person
 * locks, so concurrent first setups serialize and only one can activate (the
 * partial unique index on active methods is the backstop). No code is issued,
 * nothing is released: unpaid payouts are re-quoted and any that become
 * payable wait for a fresh controller release.
 */
async function enrollFirstMethod(tx: Executor, actor: ActorContext, person: PersonRow, input: { last4: string; currency: string; accountNumber?: string }, abandoned: MethodRow | undefined, maxVersion: number) {
  if (abandoned) await tx.update(s.payoutMethod).set({ status: "rejected" }).where(eq(s.payoutMethod.id, abandoned.id));
  const vaultId = input.accountNumber ? await sealSecret(tx, { orgId: actor.orgId, personId: person.id, kind: "bank_account", value: input.accountNumber }) : null;
  const methodId = newId("pm");
  const now = new Date();
  await tx.insert(s.payoutMethod).values({
    id: methodId, orgId: actor.orgId, personId: person.id, provider: SIMULATED_PROVIDER, currency: input.currency, last4: input.last4, vaultId,
    status: "active", version: maxVersion + 1, requestedVia: "portal", requestedBy: actor.memberId, verifiedAt: now, verifiedBy: actor.memberId,
  });
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "payout.enroll",
    summary: `${person.name} added a first payout account ••${input.last4} (${input.currency}) from their own signed-in portal session. No earlier account existed, so there was nothing to freeze and no code was sent.`,
    actor, status: "done", tool: "enrollPayoutMethod",
    facts: {
      methodId, last4: input.last4, currency: input.currency, version: maxVersion + 1, provider: SIMULATED_PROVIDER, truth: "Simulated",
      basis: "initial_self_enrollment", channelVerified: false, accountNumberVaulted: Boolean(vaultId), replacedUnconfirmedMethodId: abandoned?.id ?? null,
    },
  });
  // Existing unpaid quotes (held for "no payout method", or frozen by an abandoned unconfirmed request) are re-quoted; none are released.
  const requoted = await requoteSiblings(tx, actor.orgId, person.id, `first payout account ••${input.last4} added`, undefined, actor);
  await recordNotice(tx, { orgId: actor.orgId, channel: "organizers", title: `Payout account added: ${person.name}`, body: `${person.name} added a first payout account ••${input.last4} (${input.currency}). ${requoted} unpaid payout(s) re-quoted; each still needs a controller release.` });
  return { enrolled: true as const, activeMethodId: methodId, frozen: [] as string[], requoted, sentTo: null };
}

/**
 * payout.bankChange. A first account entered by the attendee themselves is
 * enrolled directly (isInitialEnrollment). Otherwise new details are stored
 * pending verification; every unpaid payout for the person freezes; a code
 * goes to the ORIGINAL email on file.
 */
export async function changeBankDetails(tx: Executor, actor: ActorContext, input: { personId: string; last4: string; currency: string; accountNumber?: string; requestedVia?: string }) {
  const person = await lockPayee(tx, actor.orgId, input.personId);
  if (input.accountNumber && !input.accountNumber.endsWith(input.last4)) throw invalid("The account number does not end in the given last 4 digits.");
  // Read under the person lock: a concurrent first setup that committed first is visible here.
  const history = await tx.select().from(s.payoutMethod).where(and(eq(s.payoutMethod.orgId, actor.orgId), eq(s.payoutMethod.personId, person.id))).for("update");
  const methods = await methodsFor(tx, person.id);
  if (isInitialEnrollment(actor, person.id, history, input.requestedVia)) {
    const maxVersion = history.reduce((m, r) => Math.max(m, r.version), 0);
    return enrollFirstMethod(tx, actor, person, input, methods.pending, maxVersion);
  }
  if (methods.pending) {
    await tx.update(s.payoutMethod).set({ status: "rejected" }).where(eq(s.payoutMethod.id, methods.pending.id));
  }
  const [{ maxVersion }] = await tx.select({ maxVersion: sql<number>`coalesce(max(${s.payoutMethod.version}), 0)::int` }).from(s.payoutMethod).where(eq(s.payoutMethod.personId, person.id));
  const vaultId = input.accountNumber ? await sealSecret(tx, { orgId: actor.orgId, personId: person.id, kind: "bank_account", value: input.accountNumber }) : null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeVault = await sealSecret(tx, { orgId: actor.orgId, personId: person.id, kind: "verification_code", value: code });
  const methodId = newId("pm");
  const requestedVia = input.requestedVia ?? (actor.role === "attendee" ? "portal" : "email");
  await tx.insert(s.payoutMethod).values({
    id: methodId, orgId: actor.orgId, personId: person.id, provider: SIMULATED_PROVIDER, currency: input.currency, last4: input.last4, vaultId,
    status: "pending_verification", version: maxVersion + 1, requestedVia, requestedBy: actor.memberId, verificationVaultId: codeVault,
    verificationSentTo: person.email, verificationExpiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  const toFreeze = await tx.select().from(s.payout).where(and(eq(s.payout.personId, person.id), inArray(s.payout.status, ["held", "proposed", "approved"])));
  for (const p of toFreeze) {
    await tx.update(s.payout).set({
      status: "frozen", frozenFrom: p.status,
      reason: `Bank details changed from ••${methods.active?.last4 ?? "none"} to ••${input.last4} via ${requestedVia}; frozen until confirmed through the original contact.`,
    }).where(eq(s.payout.id, p.id));
  }
  await recordNotice(tx, {
    orgId: actor.orgId, personId: person.id, channel: `email ${maskEmail(person.email)}`, title: "Confirm your new payout account",
    body: `We received a request via ${requestedVia} to send your payouts to an account ending ••${input.last4}. If this was you, enter the confirmation code in Eve. If not, do nothing and tell the organizers.`,
    privateVaultId: codeVault,
  });
  await recordNotice(tx, { orgId: actor.orgId, channel: "organizers", title: `Payout frozen: ${person.name}`, body: `${toFreeze.length} payout(s) frozen after a bank detail change to ••${input.last4}. Verification requested through the original email on file; delivery pending.` });
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "payout.bankChange",
    summary: `Bank details changed to ••${input.last4} via ${requestedVia}. Froze ${toFreeze.length} payout(s); verification requested through ${maskEmail(person.email)} (delivery pending).`,
    actor, status: "frozen", tool: "freezePayouts",
    facts: { previousLast4: methods.active?.last4 ?? null, newLast4: input.last4, requestedVia, frozen: toFreeze.map((p) => p.id), verificationChannel: maskEmail(person.email), delivery: "pending" },
  });
  return { enrolled: false as const, methodId, frozen: toFreeze.map((p) => p.id), sentTo: maskEmail(person.email) };
}

/**
 * payout.verify. Requires the code delivered to the original channel. Wrong
 * codes count toward a limit and are persisted (the caller must commit).
 */
export async function verifyBankChange(tx: Executor, actor: ActorContext, input: { id: string; confirmation: string; decision?: "confirm" | "reject" }) {
  const pendingWhere = and(eq(s.payoutMethod.orgId, actor.orgId), eq(s.payoutMethod.status, "pending_verification"),
    sql`(${s.payoutMethod.id} = ${input.id} OR ${s.payoutMethod.personId} = ${input.id})`);
  const [peek] = await tx.select({ personId: s.payoutMethod.personId }).from(s.payoutMethod).where(pendingWhere);
  if (!peek) throw notFound("No bank change is waiting for verification.");
  // Lock order: org -> person -> payout method.
  await lockPayee(tx, actor.orgId, peek.personId);
  const [pending] = await tx.select().from(s.payoutMethod).where(pendingWhere).for("update");
  if (!pending) throw notFound("No bank change is waiting for verification.");
  if (actor.role === "attendee" && actor.personId !== pending.personId) throw forbidden("You can only verify your own bank change.");
  if (pending.verificationAttempts >= MAX_ATTEMPTS) throw conflict("Too many attempts. Start the bank change again.");
  if (!pending.verificationExpiresAt || pending.verificationExpiresAt.getTime() < Date.now()) throw conflict("The confirmation code expired. Start the bank change again.");
  const expected = pending.verificationVaultId ? await openSecret(tx, actor.orgId, pending.verificationVaultId) : null;
  if (!expected || !constantTimeEqual(expected, input.confirmation)) {
    await tx.update(s.payoutMethod).set({ verificationAttempts: pending.verificationAttempts + 1 }).where(eq(s.payoutMethod.id, pending.id));
    return { ok: false as const, message: `That code does not match the one issued for ${maskEmail(pending.verificationSentTo ?? "")}. ${MAX_ATTEMPTS - pending.verificationAttempts - 1} attempts left.` };
  }
  const person = await loadPerson(tx, actor.orgId, pending.personId, true);
  const decision = input.decision ?? "confirm";
  const frozen = await tx.select().from(s.payout).where(and(eq(s.payout.personId, person.id), eq(s.payout.status, "frozen")));
  if (decision === "reject") {
    await tx.update(s.payoutMethod).set({ status: "rejected", verifiedAt: new Date(), verifiedBy: actor.memberId }).where(eq(s.payoutMethod.id, pending.id));
    for (const p of frozen) {
      await tx.update(s.payout).set({ status: p.frozenFrom ?? "proposed", frozenFrom: null, reason: "Bank change rejected by the account owner; original account kept." }).where(eq(s.payout.id, p.id));
    }
  } else {
    await tx.update(s.payoutMethod).set({ status: "superseded" }).where(and(eq(s.payoutMethod.personId, person.id), eq(s.payoutMethod.status, "active")));
    await tx.update(s.payoutMethod).set({ status: "active", verifiedAt: new Date(), verifiedBy: actor.memberId }).where(eq(s.payoutMethod.id, pending.id));
    const ctx = await loadPayoutContext(tx, actor.orgId, person.id);
    for (const p of frozen) await requote(tx, p, ctx, `bank details confirmed as ••${pending.last4}`, actor);
  }
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "payout.verify",
    summary: decision === "confirm"
      ? `Confirmed ••${pending.last4} through the original contact. ${frozen.length} payout(s) re-quoted and need a fresh controller release.`
      : `Bank change to ••${pending.last4} rejected; payouts restored to the original account.`,
    actor, status: "done", tool: "verifyBankChange", facts: { methodId: pending.id, decision, payouts: frozen.map((p) => p.id) },
  });
  return { ok: true as const, message: decision === "confirm" ? "Bank details confirmed. Payouts need a new release." : "Bank change rejected.", payouts: frozen.map((p) => p.id) };
}

/**
 * After a tax form changes (valid, review, superseded): every unpaid payout is
 * re-quoted, not only held ones, so a proposed quote never outlives the form
 * it was computed from. Awards without a payout follow the form's validity.
 */
export async function reevaluatePerson(tx: Executor, orgId: string, personId: string, actor?: ActorContext) {
  await lockPayee(tx, orgId, personId);
  const ctx = await loadPayoutContext(tx, orgId, personId);
  const valid = profileValidFor(ctx.profile, ctx.person, ctx.org.country, ctx.now);
  const withPayout = sql`${s.award.id} NOT IN (SELECT ${s.payout.awardId} FROM ${s.payout} WHERE ${s.payout.awardId} IS NOT NULL AND ${s.payout.status} NOT IN ('failed', 'returned'))`;
  if (valid) await tx.update(s.award).set({ status: "ready" }).where(and(eq(s.award.personId, personId), eq(s.award.status, "needs_form"), withPayout));
  else await tx.update(s.award).set({ status: "needs_form" }).where(and(eq(s.award.personId, personId), eq(s.award.status, "ready"), withPayout));
  const unpaid = await tx.select().from(s.payout).where(and(eq(s.payout.personId, personId), inArray(s.payout.status, [...UNPAID]))).for("update");
  let requoted = 0;
  for (const p of unpaid) if ((await requote(tx, p, ctx, "tax form changed", actor)) !== p) requoted++;
  return { valid, requoted };
}
