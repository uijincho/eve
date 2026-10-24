// Payout lifecycle: propose (tax + quote via engines), release (controller
// only, segregation of duties, bank-version check, simulated provider, ledger),
// bank change freeze and original-channel verification, retry.

import { createHash, randomInt } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { TaxRule } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { postJournal, type JournalLineInput } from "@/lib/ledger";

import {
  ActionError, conflict, currentProfile, forbidden, hasValidForm, invalid, loadOrgEvent, loadPerson, maskEmail,
  methodsFor, notFound, recordDecision, recordNotice, usd,
  type AwardRow, type ClaimRow, type EventRow, type MethodRow, type OrgRow, type PayoutRow, type PersonRow, type ProfileRow,
} from "./core";
import { aggregateYtdByForm, big, computeTax, formFamily, paymentTypeFor, quotePayout, selectRule } from "./engines";
import { constantTimeEqual, openSecret, sealSecret } from "./vault";

const LIVE = ["held", "proposed", "approved", "processing", "frozen"] as const;
const SIMULATED_PROVIDER = "simulated";

export async function loadRules(db: Executor): Promise<TaxRule[]> {
  const rows = await db.select().from(s.taxRule);
  return rows.map((r) => ({
    id: r.id, version: r.version, payerCountry: r.payerCountry, payeeCountry: r.payeeCountry, paymentType: r.paymentType,
    rateBps: r.rateBps, thresholdMinor: r.thresholdMinor.toString(), form: r.form, reportingForm: r.reportingForm,
    verified: r.verified, sourceUrl: r.sourceUrl, explanation: r.explanation, effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? undefined,
  }));
}

/** Prize/stipend payments already paid (or in flight) to this person, for same-form YTD thresholds. */
export async function paymentsFor(db: Executor, personId: string): Promise<PaymentRecord[]> {
  const rows = await db.select({ gross: s.payout.grossMinor, form: s.payout.reportingForm, ruleId: s.payout.ruleId, paidAt: s.payout.paidAt, createdAt: s.payout.createdAt })
    .from(s.payout)
    .where(and(eq(s.payout.personId, personId), eq(s.payout.sourceType, "award"), inArray(s.payout.status, ["processing", "paid"])));
  return rows.map((r) => ({ personId, reportingForm: r.form ?? r.ruleId, grossMinor: r.gross.toString(), paidAt: (r.paidAt ?? r.createdAt).toISOString() }));
}

interface PaymentRecord { personId: string; reportingForm: string; grossMinor: string; paidAt: string }

export interface PayoutSource {
  type: "claim" | "award";
  id: string;
  grossMinor: bigint;
  paymentType: string;
  dueAt: Date;
}

export function sourceFromClaim(c: ClaimRow): PayoutSource {
  return { type: "claim", id: c.id, grossMinor: c.usdMinor, paymentType: paymentTypeFor({ kind: "claim" }), dueAt: c.dueAt };
}

export function sourceFromAward(a: AwardRow): PayoutSource {
  return { type: "award", id: a.id, grossMinor: a.amountMinor, paymentType: paymentTypeFor({ kind: "award", awardKind: a.kind, track: a.track, fulfillment: a.fulfillment }), dueAt: a.dueAt };
}

export interface PayoutContext {
  org: OrgRow; event: EventRow; person: PersonRow; profile?: ProfileRow; active?: MethodRow; pending?: MethodRow;
  payments: PaymentRecord[]; rules: TaxRule[]; now: Date;
}

/** Pure: computes the payout row for a source. Tax and quote come from the engines. */
export function buildPayout(ctx: PayoutContext, source: PayoutSource, requestedBy: string) {
  const { org, person, profile, active, pending, now } = ctx;
  const year = ctx.event.startsAt.getUTCFullYear();
  // YTD only counts payments on the same reporting form (1099-MISC and 1099-NEC thresholds are separate).
  const rule = selectRule(ctx.rules, { payerCountry: org.country, payeeCountry: person.country, paymentType: source.paymentType, year });
  const ytdMinor = rule ? aggregateYtdByForm(ctx.payments, person.id, year)[formFamily(rule.reportingForm)] ?? "0" : "0";
  const tax = computeTax({
    payerCountry: org.country, payeeCountry: person.country, paymentType: source.paymentType,
    grossMinor: source.grossMinor.toString(), hasValidForm: hasValidForm(profile, now), hasTin: Boolean(profile?.tinLast4),
    year, ytdMinor, rules: ctx.rules, treatyClaim: Boolean(profile?.treatyArticle),
  });
  const destinationCurrency = (pending ?? active)?.currency ?? person.payoutCurrency;
  const net = big(tax.netMinor);
  const quote = net > 0n
    ? quotePayout({ amountMinor: tax.netMinor, currency: "USD", destinationCurrency, provider: SIMULATED_PROVIDER, feesPaidBy: org.feesPaidBy, destinationCountry: person.country, payerCountry: org.country })
    : { feeMinor: "0", netMinor: "0", destinationNetMinor: "0", fxRate: "1", provider: "mock_wire", truth: "Simulated" as const, warnings: [] as string[] };

  const holds: string[] = [];
  if (!person.adult) holds.push("Recipient is under 18; Eve does not pay minors.");
  if (source.type === "claim" ? tax.hold && tax.ruleId === "none" : tax.hold) holds.push(tax.reason);
  if (!active && !pending) holds.push("No verified payout method on file.");
  let status: PayoutRow["status"] = holds.length ? "held" : "proposed";
  let frozenFrom: PayoutRow["status"] | null = null;
  let reason = holds.length ? holds.join(" ") : tax.reason;
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

export async function loadPayoutContext(db: Executor, orgId: string, personId: string): Promise<PayoutContext> {
  // Sequential: this often runs on a single transaction client.
  const { org, event } = await loadOrgEvent(db, orgId);
  const person = await loadPerson(db, orgId, personId);
  const profile = await currentProfile(db, personId);
  const methods = await methodsFor(db, personId);
  const rules = await loadRules(db);
  const payments = await paymentsFor(db, personId);
  return { org, event, person, profile, active: methods.active, pending: methods.pending, payments, rules, now: new Date() };
}

/** payout.propose. Requested by an organizer or the agent; one live payout per source. */
export async function proposePayout(tx: Executor, actor: ActorContext, input: { sourceType: "claim" | "award"; sourceId: string }) {
  if (actor.role !== "organizer" && actor.role !== "agent") throw forbidden("Only organizers or the agent can request a payout.");
  let source: PayoutSource;
  let personId: string;
  if (input.sourceType === "claim") {
    const [c] = await tx.select().from(s.claim).where(and(eq(s.claim.id, input.sourceId), eq(s.claim.orgId, actor.orgId))).for("update");
    if (!c) throw notFound("Claim not found.");
    if (c.status !== "approved") throw conflict(`Claim is ${c.status}; only approved claims can be paid.`);
    source = sourceFromClaim(c);
    personId = c.personId;
  } else {
    const [a] = await tx.select().from(s.award).where(and(eq(s.award.id, input.sourceId), eq(s.award.orgId, actor.orgId))).for("update");
    if (!a) throw notFound("Award not found.");
    if (a.status === "paid" || a.status === "proposed") throw conflict(`Award is already ${a.status}.`);
    if (a.kind === "item" && a.fulfillment !== "cash") throw conflict("Item prizes are fulfilled, not paid. Choose the cash equivalent to pay out.");
    if (a.teamId) {
      const team = await tx.select({ ok: s.award.splitConfirmed }).from(s.award).where(eq(s.award.teamId, a.teamId));
      if (team.some((t) => !t.ok)) throw conflict("Every team member must confirm the split first.");
    }
    source = sourceFromAward(a);
    personId = a.personId;
  }
  const existing = await tx.select({ id: s.payout.id, status: s.payout.status }).from(s.payout)
    .where(and(input.sourceType === "claim" ? eq(s.payout.claimId, input.sourceId) : eq(s.payout.awardId, input.sourceId), inArray(s.payout.status, [...LIVE, "paid"])));
  if (existing[0]) throw new ActionError(409, `A payout already exists for this ${input.sourceType} (${existing[0].status}).`, { payoutId: existing[0].id });

  const ctx = await loadPayoutContext(tx, actor.orgId, personId);
  const { row, tax, quote, ytdMinor } = buildPayout(ctx, source, actor.memberId);
  await tx.insert(s.payout).values(row);
  if (input.sourceType === "award" && row.status !== "held") await tx.update(s.award).set({ status: "proposed" }).where(eq(s.award.id, input.sourceId));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "payout", objectId: row.id!, personId, personName: ctx.person.name, action: "payout.propose",
    summary: row.status === "proposed"
      ? `Proposed ${usd(row.grossMinor)} gross, ${usd(row.withholdingMinor!)} withheld, est. ${usd(row.netMinor!)} net for controller release.`
      : `Payout ${row.status}: ${row.reason}`,
    actor, status: row.status === "proposed" ? "waiting" : row.status === "frozen" ? "frozen" : "escalated", tool: "computeWithholding+quotePayouts",
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion,
    facts: { sourceType: input.sourceType, sourceId: input.sourceId, tax, quote: { ...quote }, ytdMinor },
  });
  return row;
}

function simulatedProviderRef(idempotencyKey: string) {
  return `sim_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20)}`;
}

/** Accrual (expense -> withholding + AP) and payment (AP -> cash, fee) entries, idempotent per payout. */
export async function postPayoutJournals(tx: Executor, p: PayoutRow, createdBy: string, category: "travel" | "expense" | "prize" | "stipend") {
  const expenseAccount = category === "travel" ? "5000" : category === "expense" ? "5010" : category === "stipend" ? "5200" : "5100";
  const ap = p.grossMinor - p.withholdingMinor;
  const accrual: JournalLineInput[] = [{ account: expenseAccount, debitMinor: p.grossMinor, currency: "USD", personId: p.personId, memo: "Gross" }];
  if (p.withholdingMinor > 0n) accrual.push({ account: "2100", creditMinor: p.withholdingMinor, currency: "USD", personId: p.personId, memo: `Withholding (${p.ruleId} v${p.ruleVersion})` });
  if (ap > 0n) accrual.push({ account: "2000", creditMinor: ap, currency: "USD", personId: p.personId, memo: "Payable to recipient" });
  if (accrual.length >= 2) {
    await postJournal(tx, { orgId: p.orgId, memo: `Accrue ${p.sourceType} ${p.claimId ?? p.awardId}`, sourceType: "payout", sourceId: p.id, idempotencyKey: `accrual:${p.id}`, createdBy, lines: accrual });
  }
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

async function payoutCategory(tx: Executor, p: PayoutRow): Promise<"travel" | "expense" | "prize" | "stipend"> {
  if (p.claimId) {
    const [c] = await tx.select({ type: s.claim.type }).from(s.claim).where(eq(s.claim.id, p.claimId));
    return c?.type === "travel" ? "travel" : "expense";
  }
  const [a] = await tx.select({ track: s.award.track }).from(s.award).where(eq(s.award.id, p.awardId!));
  return a && /stipend|judge|mentor|speaker/i.test(a.track) ? "stipend" : "prize";
}

/** payout.release for one payout. Controller only; never the requester; never the agent. */
export async function releasePayout(tx: Executor, actor: ActorContext, payoutId: string) {
  if (actor.role !== "controller") throw forbidden(actor.role === "agent" ? "The agent can never release money." : "Only a controller can release payouts.");
  const [p] = await tx.select().from(s.payout).where(and(eq(s.payout.id, payoutId), eq(s.payout.orgId, actor.orgId))).for("update");
  if (!p) throw notFound("Payout not found.");
  if (p.requestedBy === actor.memberId) throw forbidden("You requested this payout, so another controller must release it.");
  if (p.status === "paid") throw conflict("Payout is already paid.");
  if (p.status !== "proposed" && p.status !== "approved") throw conflict(`Payout is ${p.status}: ${p.reason}`);
  const person = await loadPerson(tx, actor.orgId, p.personId);
  const profile = await currentProfile(tx, p.personId);
  const methods = await methodsFor(tx, p.personId);
  if (!person.adult) throw conflict("Recipient is under 18; payment blocked.");
  if (p.sourceType === "award" && !hasValidForm(profile, new Date())) throw conflict("Tax form is missing or invalid; payment held.");
  if (methods.pending) throw conflict(`Bank details changed to ••${methods.pending.last4}; payout is frozen pending verification.`);
  if (!methods.active || methods.active.version !== p.bankVersion || methods.active.id !== p.payoutMethodId) {
    throw conflict("This payout was quoted against outdated bank details; it must be re-proposed and re-approved.");
  }
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
    summary: `Released ${usd(p.netMinor)} to ••${methods.active.last4} via simulated provider (${providerRef}).`,
    actor, status: "done", tool: "executePayout", ruleId: p.ruleId, ruleVersion: p.ruleVersion,
    facts: { providerRef, idempotencyKey: p.idempotencyKey, truth: p.truth, bankVersion: p.bankVersion, requestedBy: p.requestedBy },
  });
  return paid;
}

/** payout.retry: re-submit a failed payout with the same idempotency key (no double pay). */
export async function retryPayout(tx: Executor, actor: ActorContext, payoutId: string) {
  const [p] = await tx.select().from(s.payout).where(and(eq(s.payout.id, payoutId), eq(s.payout.orgId, actor.orgId))).for("update");
  if (!p) throw notFound("Payout not found.");
  if (p.status !== "failed") throw conflict(`Only failed payouts can be retried (this one is ${p.status}).`);
  if (!p.releasedBy) throw conflict("This payout was never released.");
  const methods = await methodsFor(tx, p.personId);
  if (methods.pending || methods.active?.version !== p.bankVersion) throw conflict("Bank details changed since release; re-propose instead.");
  const [paid] = await tx.update(s.payout).set({ status: "paid", paidAt: new Date(), attempts: p.attempts + 1, providerRef: simulatedProviderRef(p.idempotencyKey) })
    .where(eq(s.payout.id, p.id)).returning();
  await postPayoutJournals(tx, paid, actor.memberId, await payoutCategory(tx, paid));
  if (p.claimId) await tx.update(s.claim).set({ status: "paid" }).where(eq(s.claim.id, p.claimId));
  if (p.awardId) await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, p.awardId));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "payout", objectId: p.id, personId: p.personId, action: "payout.retry", summary: "Retried with the original idempotency key.", actor, status: "done", tool: "executePayout", facts: { idempotencyKey: p.idempotencyKey } });
  return paid;
}

/** Re-quotes a payout against the person's current state (after a form or bank change). */
export async function requote(tx: Executor, p: PayoutRow, ctx: PayoutContext): Promise<PayoutRow> {
  let source: PayoutSource;
  if (p.claimId) {
    const [c] = await tx.select().from(s.claim).where(eq(s.claim.id, p.claimId));
    source = sourceFromClaim(c);
  } else {
    const [a] = await tx.select().from(s.award).where(eq(s.award.id, p.awardId!));
    source = sourceFromAward(a);
  }
  const { row } = buildPayout(ctx, source, p.requestedBy);
  const [updated] = await tx.update(s.payout).set({
    grossMinor: row.grossMinor, withholdingMinor: row.withholdingMinor, feeMinor: row.feeMinor, netMinor: row.netMinor,
    destinationCurrency: row.destinationCurrency, destinationNetMinor: row.destinationNetMinor, fxRate: row.fxRate,
    status: row.status, frozenFrom: row.frozenFrom, reason: row.reason, ruleId: row.ruleId, ruleVersion: row.ruleVersion,
    ruleVerified: row.ruleVerified, reportingForm: row.reportingForm, reportable: row.reportable, payoutMethodId: row.payoutMethodId, bankVersion: row.bankVersion,
    releasedBy: null,
  }).where(eq(s.payout.id, p.id)).returning();
  if (p.awardId) await tx.update(s.award).set({ status: updated.status === "held" ? "needs_form" : "proposed" }).where(eq(s.award.id, p.awardId));
  return updated;
}

const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * payout.bankChange. New details are stored pending verification; every unpaid
 * payout for the person freezes; a code goes to the ORIGINAL email on file.
 */
export async function changeBankDetails(tx: Executor, actor: ActorContext, input: { personId: string; last4: string; currency: string; accountNumber?: string; requestedVia?: string }) {
  const person = await loadPerson(tx, actor.orgId, input.personId, true);
  if (input.accountNumber && !input.accountNumber.endsWith(input.last4)) throw invalid("The account number does not end in the given last 4 digits.");
  const methods = await methodsFor(tx, person.id);
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
  await recordNotice(tx, { orgId: actor.orgId, channel: "organizers", title: `Payout frozen: ${person.name}`, body: `${toFreeze.length} payout(s) frozen after a bank detail change to ••${input.last4}. Confirmation sent to the original email.` });
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "payout.bankChange",
    summary: `Bank details changed to ••${input.last4} via ${requestedVia}. Froze ${toFreeze.length} payout(s) and asked ${maskEmail(person.email)} to confirm.`,
    actor, status: "frozen", tool: "freezePayouts",
    facts: { previousLast4: methods.active?.last4 ?? null, newLast4: input.last4, requestedVia, frozen: toFreeze.map((p) => p.id), sentTo: maskEmail(person.email) },
  });
  return { methodId, frozen: toFreeze.map((p) => p.id), sentTo: maskEmail(person.email) };
}

/**
 * payout.verify. Requires the code delivered to the original channel. Wrong
 * codes count toward a limit and are persisted (the caller must commit).
 */
export async function verifyBankChange(tx: Executor, actor: ActorContext, input: { id: string; confirmation: string; decision?: "confirm" | "reject" }) {
  const [pending] = await tx.select().from(s.payoutMethod)
    .where(and(eq(s.payoutMethod.orgId, actor.orgId), eq(s.payoutMethod.status, "pending_verification"),
      sql`(${s.payoutMethod.id} = ${input.id} OR ${s.payoutMethod.personId} = ${input.id})`)).for("update");
  if (!pending) throw notFound("No bank change is waiting for verification.");
  if (actor.role === "attendee" && actor.personId !== pending.personId) throw forbidden("You can only verify your own bank change.");
  if (pending.verificationAttempts >= MAX_ATTEMPTS) throw conflict("Too many attempts. Start the bank change again.");
  if (!pending.verificationExpiresAt || pending.verificationExpiresAt.getTime() < Date.now()) throw conflict("The confirmation code expired. Start the bank change again.");
  const expected = pending.verificationVaultId ? await openSecret(tx, actor.orgId, pending.verificationVaultId) : null;
  if (!expected || !constantTimeEqual(expected, input.confirmation)) {
    await tx.update(s.payoutMethod).set({ verificationAttempts: pending.verificationAttempts + 1 }).where(eq(s.payoutMethod.id, pending.id));
    return { ok: false as const, message: `That code does not match the one sent to ${maskEmail(pending.verificationSentTo ?? "")}. ${MAX_ATTEMPTS - pending.verificationAttempts - 1} attempts left.` };
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
    for (const p of frozen) await requote(tx, p, ctx);
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

/** After a tax form becomes valid: awards waiting on a form become ready; held payouts are re-quoted. */
export async function reevaluatePerson(tx: Executor, orgId: string, personId: string) {
  const ctx = await loadPayoutContext(tx, orgId, personId);
  const valid = hasValidForm(ctx.profile, ctx.now);
  if (valid) await tx.update(s.award).set({ status: "ready" }).where(and(eq(s.award.personId, personId), eq(s.award.status, "needs_form")));
  const held = await tx.select().from(s.payout).where(and(eq(s.payout.personId, personId), eq(s.payout.status, "held")));
  for (const p of held) await requote(tx, p, ctx);
  return { valid, requoted: held.length };
}
