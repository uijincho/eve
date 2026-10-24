// Action dispatcher and the remaining domain services. Every action:
// validate (Zod, strict) -> authorize (role + self) -> transition -> decision
// log -> persist, inside one transaction (receipt extraction runs before it).
//
// Entry points for durable workflows:
//   runAuthorizedAction(actor, action, payload)   same path as POST /api/actions
//   agentActor(orgId)                              role "agent"; cannot release money
//   processClaimById(actor, claimId)               re-run checks for one claim
//   runAgent(actor, kind)                          claims + chases for the org
//   missingFormContext(orgId)                      sanitized list for chase messages
//   recordNotice / recordDecision                  (from ./core)

import { and, eq, inArray, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { demoModeEnabled } from "@/lib/auth/session";
import type { ActionResult, AppAction } from "@/lib/contracts";
import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { fixtureOffers, suggestFlights } from "@/lib/flights";
import { offerSigningKeyFromEnv, signOffers, verifyFlightRequest } from "@/lib/flights/verify";
import { lockPeriod, postJournal, type JournalLineInput } from "@/lib/ledger";
import { renderFilingDraft, renderPayoutPacket, renderTaxFormReceipt } from "@/lib/pdf";

import { actionSchemas } from "./action-schemas";
import { prepareClaim, processClaim, reviewClaim, submitClaim, type ClaimEvidence } from "./claims";
import {
  ActionError, agentActor, assertMayInvoke, assertSelfOrStaff, conflict, currentProfile, effectiveTaxStatus, expectedForm, forbidden,
  invalid, isAdultAt, loadOrgEvent, loadPerson, maskEmail, methodsFor, normName, notFound, recordDecision, recordNotice, storeDocument,
  toAward, toEvent, toPerson, usd,
} from "./core";
import { assertFits, ORG_BOOKED_FLIGHT, prizeBudgetRoom } from "./budget";
import { computeTax, grossUp, recommendFulfillment, splitAward, w8ExpiresAt } from "./engines";
import {
  assertNotBeneficiary, changeBankDetails, IN_KIND_PROVIDER, loadPayoutContext, lockOrgFinance, lockPayee, payoutCategory, postAccrual, prepareRelease,
  proposePayout, reevaluatePerson, releasePayout, requoteSiblings, retryPayout, SPONSOR_PROVIDER, taxFor, termsKey, verifyBankChange,
} from "./payouts";
import { computeScoreboard, saveScoreboard } from "./scoreboard";
import { vaultTin } from "./tin";

export { agentActor, recordDecision, recordNotice } from "./core";

// Payloads are validated by actionSchemas before dispatch, so handlers receive the parsed shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (tx: Executor, actor: ActorContext, payload: any, prepared: unknown) => Promise<ActionResult>;

const ok = (message: string, data?: Record<string, unknown>): ActionResult => ({ ok: true, message, data });

// ------------------------------------------------------------------ org/event

async function orgUpdate(tx: Executor, actor: ActorContext, p: Partial<typeof s.organization.$inferInsert>) {
  if (Object.keys(p).length === 0) throw invalid("Nothing to update.");
  await tx.update(s.organization).set(p).where(eq(s.organization.id, actor.orgId));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "org", objectId: actor.orgId, action: "org.update", summary: `Policy updated: ${Object.keys(p).join(", ")}.`, actor, status: "done", tool: "settings", facts: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });
  return ok("Organization updated.");
}

async function eventUpdate(tx: Executor, actor: ActorContext, p: Record<string, unknown>) {
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const set: Partial<typeof s.event.$inferInsert> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    (set as Record<string, unknown>)[k] = ["startsAt", "endsAt", "bookingDeadline", "checkInAt", "closingAt"].includes(k) ? new Date(v as string) : v;
  }
  if (Object.keys(set).length === 0) throw invalid("Nothing to update.");
  await tx.update(s.event).set(set).where(eq(s.event.id, event.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "event", objectId: event.id, action: "event.update", summary: `Event updated: ${Object.keys(set).join(", ")}.`, actor, status: "done", tool: "settings" });
  return ok("Event updated.");
}

async function budgetUpdate(tx: Executor, actor: ActorContext, p: { id?: string; name: string; category?: string; capMinor: bigint; fundingSource: string }) {
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const category = p.category ?? p.name.toLowerCase().replace(/[^a-z]+/g, "_");
  if (p.id) {
    const [row] = await tx.update(s.budgetLine).set({ name: p.name, capMinor: p.capMinor, fundingSource: p.fundingSource, ...(p.category ? { category } : {}) })
      .where(and(eq(s.budgetLine.id, p.id), eq(s.budgetLine.orgId, actor.orgId))).returning();
    if (!row) throw notFound("Budget line not found.");
  } else {
    await tx.insert(s.budgetLine).values({ id: newId("bud"), orgId: actor.orgId, eventId: event.id, name: p.name, category, capMinor: p.capMinor, fundingSource: p.fundingSource })
      .onConflictDoUpdate({ target: [s.budgetLine.eventId, s.budgetLine.category], set: { name: p.name, capMinor: p.capMinor, fundingSource: p.fundingSource } });
  }
  await recordDecision(tx, { orgId: actor.orgId, objectType: "budget", objectId: p.id ?? category, action: "budget.update", summary: `${p.name} cap set to ${usd(p.capMinor)}.`, actor, status: "done", tool: "settings" });
  return ok("Budget saved.");
}

// ------------------------------------------------------------------ people

type PersonInput = { name: string; email: string; country: string; citizenship?: string; dateOfBirth: string; address?: string; role?: string; payoutCurrency?: string };

async function peopleImport(tx: Executor, actor: ActorContext, p: { people: PersonInput[] }) {
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const rows = p.people.map((x) => ({
    id: newId("per"), orgId: actor.orgId, eventId: event.id, name: x.name, email: x.email.toLowerCase(), country: x.country,
    citizenship: x.citizenship ?? x.country, dateOfBirth: x.dateOfBirth, address: x.address ?? "", role: x.role ?? "hacker",
    adult: isAdultAt(x.dateOfBirth, event.startsAt), payoutCurrency: x.payoutCurrency ?? "USD",
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await tx.insert(s.person).values(rows.slice(i, i + 200)).onConflictDoUpdate({
      target: [s.person.orgId, s.person.email],
      set: { name: sql`excluded.name`, country: sql`excluded.country`, citizenship: sql`excluded.citizenship`, dateOfBirth: sql`excluded.date_of_birth`, address: sql`excluded.address`, role: sql`excluded.role`, adult: sql`excluded.adult` },
    });
  }
  const minors = rows.filter((r) => !r.adult).length;
  await recordDecision(tx, { orgId: actor.orgId, objectType: "people", objectId: event.id, action: "people.import", summary: `Imported ${rows.length} people${minors ? `; ${minors} under 18 blocked from payments` : ""}.`, actor, status: minors ? "escalated" : "done", tool: "importPeople", facts: { count: rows.length, minors } });
  return ok(`Imported ${rows.length} people.`, { imported: rows.length, minors });
}

async function personUpdate(tx: Executor, actor: ActorContext, p: { id: string } & Partial<PersonInput>) {
  assertSelfOrStaff(actor, p.id);
  const { event } = await loadOrgEvent(tx, actor.orgId);
  await loadPerson(tx, actor.orgId, p.id);
  const set: Partial<typeof s.person.$inferInsert> = {};
  for (const k of ["name", "country", "citizenship", "dateOfBirth", "address", "role", "payoutCurrency"] as const) if (p[k] !== undefined) (set as Record<string, unknown>)[k] = p[k];
  if (actor.role === "attendee") delete set.role;
  if (set.dateOfBirth) set.adult = isAdultAt(set.dateOfBirth, event.startsAt);
  if (Object.keys(set).length === 0) throw invalid("Nothing to update.");
  await tx.update(s.person).set(set).where(eq(s.person.id, p.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "person", objectId: p.id, personId: p.id, action: "person.update", summary: `Profile updated: ${Object.keys(set).join(", ")}.`, actor, status: set.adult === false ? "escalated" : "done", tool: "profile" });
  return ok("Profile updated.");
}

// --------------------------------------------------------------------- tax

async function taxSubmit(tx: Executor, actor: ActorContext, p: { personId: string; form: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration"; signature: string; tin?: string; treatyCountry?: string; treatyArticle?: string }) {
  assertSelfOrStaff(actor, p.personId);
  const person = await loadPerson(tx, actor.orgId, p.personId, true);
  if (!person.adult) throw conflict("Eve cannot onboard anyone under 18 at the event start date.");
  const now = new Date();
  const problems: string[] = [];
  if (normName(p.signature) !== normName(person.name)) problems.push("Signature does not match the legal name on the profile.");
  const usPerson = person.country === "US" || person.citizenship === "US";
  if (p.form === "W-9" && !usPerson) problems.push("A W-9 was submitted by someone with a non-US address and citizenship; a W-8BEN is expected.");
  if (p.form.startsWith("W-8") && usPerson) problems.push("A US person must submit a W-9, not a W-8.");
  if (p.form === "W-9" && !p.tin) problems.push("No TIN provided; backup withholding may apply.");
  const blocking = problems.filter((x) => !x.startsWith("No TIN"));
  const status = blocking.length ? "review" : "valid";
  const expiresAt = p.form.startsWith("W-8") ? new Date(`${w8ExpiresAt(now.toISOString())}T23:59:59Z`) : null;
  const tin = p.tin ? await vaultTin(tx, actor.orgId, person.id, p.tin) : null;
  await tx.update(s.taxProfile).set({ supersededAt: now }).where(and(eq(s.taxProfile.personId, person.id), sql`${s.taxProfile.supersededAt} IS NULL`));
  const profileId = newId("tax");
  const pdf = await renderTaxFormReceipt({
    documentId: profileId, formType: p.form, legalName: person.name, citizenship: person.citizenship, residenceCountry: person.country,
    address: person.address, dateOfBirth: person.dateOfBirth, tinLast4: tin?.last4, signedName: p.signature, signedAt: now.toISOString(),
    expiresAt: expiresAt?.toISOString(), treaty: p.treatyArticle ? { country: p.treatyCountry ?? person.country, article: p.treatyArticle, rate: "per rules table", verified: false } : undefined,
  });
  const doc = await storeDocument(tx, { orgId: actor.orgId, personId: person.id, uploadedBy: actor.memberId, kind: "tax_form", name: `${p.form}-${person.name}.pdf`, mimeType: "application/pdf", bytes: pdf });
  await tx.insert(s.taxProfile).values({
    id: profileId, orgId: actor.orgId, personId: person.id, form: p.form, status, statusReason: problems.join(" "), signatureName: p.signature,
    signedAt: now, expiresAt, tinVaultId: tin?.vaultId ?? null, tinLast4: tin?.last4 ?? null, treatyCountry: p.treatyCountry ?? null,
    treatyArticle: p.treatyArticle ?? null, documentId: doc.id,
  });
  const re = await reevaluatePerson(tx, actor.orgId, person.id, actor);
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "tax.submit",
    summary: status === "valid" ? `${p.form} signed and valid${expiresAt ? ` until ${expiresAt.toISOString().slice(0, 10)}` : ""}. ${re.requoted} unpaid payout(s) re-quoted.` : `${p.form} needs review: ${blocking.join(" ")}`,
    actor, status: status === "valid" ? "done" : "escalated", tool: "validateTaxForm", documentId: doc.id,
    facts: { form: p.form, expected: expectedForm(person), tinLast4: tin?.last4 ?? null, problems },
  });
  return ok(status === "valid" ? `${p.form} saved.` : `${p.form} saved for review: ${blocking.join(" ")}`, { status, documentId: doc.id });
}

// ------------------------------------------------------------------ awards

async function awardCreate(tx: Executor, actor: ActorContext, p: { personId?: string; teamPersonIds?: string[]; track: string; title: string; kind: "cash" | "item"; amountMinor: bigint; currency?: string; dueAt?: string }) {
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const ids = p.teamPersonIds ?? [p.personId!];
  const people = await tx.select().from(s.person).where(and(eq(s.person.orgId, actor.orgId), inArray(s.person.id, ids)));
  if (people.length !== ids.length) throw notFound("Winner not found.");
  if (people.some((x) => (actor.personId && x.id === actor.personId) || x.email.toLowerCase() === actor.email.toLowerCase())) throw forbidden("You cannot create an award for yourself; another organizer must.");
  const teamId = p.teamPersonIds ? newId("team") : null;
  const parts = teamId ? splitAward({ amountMinor: p.amountMinor.toString(), memberIds: ids }).parts : [{ personId: ids[0], amountMinor: p.amountMinor.toString() }];
  const created = [];
  const now = new Date();
  for (const part of parts) {
    const person = people.find((x) => x.id === part.personId)!;
    const profile = await currentProfile(tx, person.id);
    const valid = effectiveTaxStatus(profile, now) === "valid";
    const draft = { id: newId("awd"), orgId: actor.orgId, eventId: event.id, personId: person.id, track: p.track, title: p.title, kind: p.kind, amountMinor: BigInt(part.amountMinor), currency: p.currency ?? "USD", dueAt: p.dueAt ? new Date(p.dueAt) : event.closingAt, requestedBy: actor.memberId, teamId, splitBps: Math.round(10000 / parts.length), splitConfirmed: !teamId };
    const rec = recommendFulfillment(toAward({ ...draft, fulfillment: "undecided", status: "draft", recommendation: "", shippingMinor: 0n, localMinor: 0n, createdAt: now }, person.name), toPerson(person, { profile, paidYtdMinor: 0n, outstandingMinor: 0n, now }));
    const [row] = await tx.insert(s.award).values({ ...draft, status: valid ? "ready" : "needs_form", fulfillment: p.kind === "cash" ? "cash" : "undecided", recommendation: rec.recommendation, shippingMinor: BigInt(rec.shippingMinor), localMinor: BigInt(rec.localMinor) }).returning();
    created.push(row);
    const nudges = [!valid ? `${person.name} needs a valid ${expectedForm(person)} before payment.` : "", p.kind === "item" && person.country !== "US" ? "Item prize to a non-US winner: withholding cannot come out of an item; consider cash." : ""].filter(Boolean);
    await recordDecision(tx, {
      orgId: actor.orgId, objectType: "award", objectId: row.id, personId: person.id, personName: person.name, action: "award.create",
      summary: `${p.title} (${p.track}) for ${person.name}, ${usd(row.amountMinor)}. ${rec.recommendation} ${nudges.join(" ")}`.trim(),
      actor, status: nudges.length ? "escalated" : "done", tool: "recommendFulfillment", facts: { recommendation: rec, nudges },
    });
    if (!valid) await recordNotice(tx, { orgId: actor.orgId, personId: person.id, channel: `email ${maskEmail(person.email)}`, title: `You won ${p.title}`, body: `Congratulations! To receive your prize, complete your ${expectedForm(person)} in the Eve portal.` });
  }
  return ok(`Created ${created.length} award(s).`, { ids: created.map((a) => a.id), teamId });
}

async function loadAward(tx: Executor, actor: ActorContext, id: string) {
  const [peek] = await tx.select({ personId: s.award.personId }).from(s.award).where(and(eq(s.award.id, id), eq(s.award.orgId, actor.orgId)));
  if (!peek) throw notFound("Award not found.");
  await lockPayee(tx, actor.orgId, peek.personId);
  const [a] = await tx.select().from(s.award).where(and(eq(s.award.id, id), eq(s.award.orgId, actor.orgId))).for("update");
  if (!a) throw notFound("Award not found.");
  return a;
}

/** Any payout that is not failed or returned (held, proposed, frozen, in flight, paid, in kind) freezes the award's terms. */
async function livePayoutsFor(tx: Executor, awardIds: string[]) {
  if (!awardIds.length) return [];
  return tx.select({ id: s.payout.id, awardId: s.payout.awardId, status: s.payout.status }).from(s.payout)
    .where(and(inArray(s.payout.awardId, awardIds), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
}

function lockedTermsMessage(live: { status: string }[]): string {
  return `A payout already exists for this prize (${[...new Set(live.map((l) => l.status))].join(", ")}), so its fulfillment and split are locked. Ask a controller to stop that payout before changing them.`;
}

async function awardChoose(tx: Executor, actor: ActorContext, p: { id: string; fulfillment: "ship" | "local" | "cash" }) {
  const a = await loadAward(tx, actor, p.id);
  assertSelfOrStaff(actor, a.personId);
  if (a.status === "paid") throw conflict(a.kind === "item" && a.fulfillment !== "cash" ? "This prize was already fulfilled; the choice is final." : "Award is already paid.");
  if (a.kind === "cash" && p.fulfillment !== "cash") throw invalid("Cash prizes are paid in cash.");
  const live = await livePayoutsFor(tx, [a.id]);
  if (live.length) throw conflict(lockedTermsMessage(live));
  if (a.fulfillment === p.fulfillment) return ok(`Fulfillment is already ${p.fulfillment}.`);
  await tx.update(s.award).set({ fulfillment: p.fulfillment }).where(eq(s.award.id, a.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, action: "award.choose", summary: `Fulfillment set to ${p.fulfillment}.`, actor, status: "done", tool: "fulfillment", facts: { from: a.fulfillment, to: p.fulfillment } });
  return ok(`Fulfillment set to ${p.fulfillment}.`);
}

async function awardSplit(tx: Executor, actor: ActorContext, p: { teamId: string; splits: { personId: string; bps: number }[] }) {
  await lockOrgFinance(tx, actor.orgId);
  const members0 = await tx.select({ personId: s.award.personId }).from(s.award).where(and(eq(s.award.teamId, p.teamId), eq(s.award.orgId, actor.orgId)));
  for (const pid of [...new Set(members0.map((m) => m.personId))].sort()) await loadPerson(tx, actor.orgId, pid, true);
  const team = await tx.select().from(s.award).where(and(eq(s.award.teamId, p.teamId), eq(s.award.orgId, actor.orgId))).for("update");
  if (!team.length) throw notFound("Team not found.");
  if (actor.role === "attendee" && !team.some((a) => a.personId === actor.personId)) throw forbidden("Only team members can propose a split.");
  if (team.some((a) => a.status === "paid")) throw conflict("Part of this team prize is already paid; the split is final.");
  const live = await livePayoutsFor(tx, team.map((a) => a.id));
  if (live.length) throw conflict(lockedTermsMessage(live));
  const members = team.map((a) => a.personId);
  if (p.splits.length !== members.length || p.splits.some((x) => !members.includes(x.personId))) throw invalid("Splits must cover exactly the team members.");
  const total = team.reduce((sum, a) => sum + a.amountMinor, 0n);
  const result = splitAward({ amountMinor: total.toString(), memberIds: members, shares: Object.fromEntries(p.splits.map((x) => [x.personId, x.bps])) });
  for (const part of result.parts) {
    const bps = p.splits.find((x) => x.personId === part.personId)!.bps;
    await tx.update(s.award).set({ amountMinor: BigInt(part.amountMinor), splitBps: bps, splitConfirmed: false }).where(and(eq(s.award.teamId, p.teamId), eq(s.award.personId, part.personId)));
  }
  await recordDecision(tx, { orgId: actor.orgId, objectType: "team", objectId: p.teamId, action: "award.split", summary: `Custom split proposed (${p.splits.map((x) => `${x.bps / 100}%`).join(" / ")}); every member must confirm.`, actor, status: "waiting", tool: "splitAward", facts: { parts: result.parts } });
  return ok("Split proposed. Each member must confirm.");
}

async function awardConfirm(tx: Executor, actor: ActorContext, p: { id: string }) {
  const a = await loadAward(tx, actor, p.id);
  if (actor.personId !== a.personId) throw forbidden("Only the winner can confirm their split.");
  if (a.splitConfirmed) return ok("Split already confirmed.");
  const live = await livePayoutsFor(tx, [a.id]);
  if (live.length) throw conflict(lockedTermsMessage(live));
  await tx.update(s.award).set({ splitConfirmed: true }).where(eq(s.award.id, a.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, action: "award.confirm", summary: `${actor.name} confirmed their share of ${usd(a.amountMinor)}.`, actor, status: "done", tool: "splitAward" });
  return ok("Split confirmed.");
}

/**
 * award.fulfill (controller only). Records that an item prize was handed
 * over by shipping or local purchase. Simulated: nothing is shipped or bought.
 * The item's fair market value is non-cash income: it counts toward the
 * winner's same-form YTD and filings through an in-kind payout row (status
 * paid, provider in_kind, net 0). Where the rule withholds (backup
 * withholding, 30% for non-US winners), the org pays the tax on top: the
 * engine grosses up so the reported income is FMV + tax.
 */
async function awardFulfill(tx: Executor, actor: ActorContext, p: { id: string }) {
  if (actor.role !== "controller") throw forbidden("Only a controller can confirm a physical prize fulfillment.");
  const a = await loadAward(tx, actor, p.id);
  assertNotBeneficiary(actor, await loadPerson(tx, actor.orgId, a.personId), "fulfill");
  if (a.requestedBy === actor.memberId) throw forbidden("You created this award, so another controller must confirm its fulfillment.");
  if (a.kind !== "item") throw invalid("Cash prizes are paid through payout release, not fulfilled.");
  if (a.status === "paid") throw conflict("This prize was already fulfilled.");
  if (a.fulfillment !== "ship" && a.fulfillment !== "local") {
    throw conflict(a.fulfillment === "cash" ? "This item was converted to its cash equivalent; propose a payout instead." : "Choose ship or buy-local for this item first.");
  }
  const live = await livePayoutsFor(tx, [a.id]);
  if (live.length) throw conflict(lockedTermsMessage(live));
  if (a.teamId) {
    const team = await tx.select({ ok: s.award.splitConfirmed }).from(s.award).where(eq(s.award.teamId, a.teamId));
    if (team.some((t) => !t.ok)) throw conflict("Every team member must confirm the split first.");
  }
  const ctx = await loadPayoutContext(tx, actor.orgId, a.personId);
  if (!ctx.person.adult) throw conflict("Recipient is under 18; Eve does not deliver prizes to minors.");
  const fmv = a.amountMinor;
  const { tax, ytdMinor } = taxFor(ctx, "item_prize", fmv);
  if (tax.hold) throw conflict(`Fulfillment held: ${tax.reason} The item's fair market value is reportable income, so it needs the same tax checks as cash.`);
  // Tax cannot come out of an item: the org pays it on top (gross-up) and the grossed-up amount is the income.
  const up = tax.rateBps > 0 ? (tax.grossUp ?? grossUp(fmv, tax.rateBps)) : null;
  const grossMinor = up ? BigInt(up.grossMinor) : fmv;
  const withholdingMinor = up ? BigInt(up.withholdingMinor) : 0n;
  if (grossMinor - withholdingMinor !== fmv) throw conflict("Gross-up did not reconcile to the item's value; held for review.");
  // Reportability is judged on the income actually reported (FMV plus any tax paid on the winner's behalf).
  const year = ctx.event.startsAt.getUTCFullYear();
  const reported = computeTax({ payerCountry: ctx.org.country, payeeCountry: ctx.person.country, paymentType: "item_prize", grossMinor: grossMinor.toString(), hasValidForm: true, hasTin: Boolean(ctx.profile?.tinLast4), year, ytdMinor, rules: ctx.rules, treatyClaim: Boolean(ctx.profile?.treatyArticle) });
  assertFits(await prizeBudgetRoom(tx, a.eventId), grossMinor, "Fulfilling");
  const now = new Date();
  const id = newId("pay");
  const method = a.fulfillment === "ship" ? "shipped" : "bought locally";
  const [row] = await tx.insert(s.payout).values({
    id, orgId: actor.orgId, personId: a.personId, sourceType: "award", awardId: a.id, claimId: null,
    grossMinor, withholdingMinor, feeMinor: 0n, netMinor: 0n, currency: "USD", destinationCurrency: "USD", destinationNetMinor: 0n, fxRate: "1",
    provider: IN_KIND_PROVIDER, truth: "Simulated", status: "paid",
    reason: `In-kind prize: ${a.title} ${method} (simulated; nothing was shipped or purchased). Fair market value ${usd(fmv)}${withholdingMinor > 0n ? ` plus ${usd(withholdingMinor)} tax the org pays on top` : ""} is reportable income.`,
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion, ruleVerified: tax.ruleVerified, reportingForm: reported.reportingForm, reportable: reported.reportable,
    requestedBy: a.requestedBy, releasedBy: actor.memberId, idempotencyKey: `inkind:${a.id}`, providerRef: `inkind_sim_${a.id.slice(-12)}`,
    attempts: 1, dueAt: a.dueAt, paidAt: now,
  }).returning();
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "payout", objectId: id, requestedBy: a.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: `Physical prize ${method}` });
  const lines: JournalLineInput[] = [
    { account: "5100", debitMinor: grossMinor, currency: "USD", personId: a.personId, memo: `In-kind prize ${a.title} (FMV ${usd(fmv)}${withholdingMinor > 0n ? " + tax on top" : ""})` },
    { account: "1000", creditMinor: fmv, currency: "USD", memo: `Item ${method} (simulated purchase/shipment)` },
  ];
  if (withholdingMinor > 0n) lines.push({ account: "2100", creditMinor: withholdingMinor, currency: "USD", personId: a.personId, memo: `Withholding paid by the org on a grossed-up prize (${tax.ruleId} v${tax.ruleVersion})` });
  await postJournal(tx, { orgId: actor.orgId, memo: `Fulfill item prize ${a.id}`, sourceType: "payout", sourceId: id, idempotencyKey: `inkind:${a.id}`, createdBy: actor.memberId, lines });
  await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, a.id));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, personName: ctx.person.name, action: "award.fulfill",
    summary: `${a.title} ${method} for ${ctx.person.name} (Simulated). Reportable income ${usd(grossMinor)} on ${reported.reportingForm}${withholdingMinor > 0n ? `, including ${usd(withholdingMinor)} withholding the org pays on top` : ""}${reported.reportable ? "" : " (below the threshold so far)"}.`,
    actor, status: "done", tool: "fulfillPrize", ruleId: tax.ruleId, ruleVersion: tax.ruleVersion,
    facts: { truth: "Simulated", fmvMinor: fmv.toString(), grossMinor: grossMinor.toString(), withholdingMinor: withholdingMinor.toString(), ytdMinor, reportingForm: reported.reportingForm, reportable: reported.reportable, payoutId: id, method },
  });
  await recordNotice(tx, { orgId: actor.orgId, personId: a.personId, channel: "portal", title: `${a.title}: fulfillment recorded`, body: `Your prize was marked ${method}. This demo does not ship or buy anything. Its fair market value (${usd(fmv)}) is reportable prize income.` });
  await requoteSiblings(tx, actor.orgId, a.personId, `in-kind prize ${a.title} became final`, id, actor);
  return ok(`${a.title} marked ${method} (simulated).`, { awardId: a.id, payoutId: row.id, fmvMinor: fmv.toString(), grossMinor: grossMinor.toString(), withholdingMinor: withholdingMinor.toString(), reportingForm: reported.reportingForm, reportable: reported.reportable, truth: "Simulated" });
}

// ---------------------------------------------------------------- payouts

async function payoutRelease(tx: Executor, actor: ActorContext, p: { id?: string; ids?: string[] }) {
  const ids = p.ids ?? [p.id!];
  // Pin the terms the controller is looking at; a payout re-quoted during the batch is skipped, never paid on new terms.
  const rows = await tx.select().from(s.payout).where(and(eq(s.payout.orgId, actor.orgId), inArray(s.payout.id, ids)));
  const expected = new Map(rows.map((r) => [r.id, termsKey(r)]));
  if (ids.length === 1) {
    const paid = await releasePayout(tx, actor, ids[0], { expectTerms: expected.get(ids[0]) });
    if (paid.status !== "paid") return { ok: false, message: `Not released: the quote changed (${paid.reason}). Review the new terms and release again.`, data: { requoted: [paid.id] } };
    return ok(`Released ${usd(paid.netMinor)}.`, { released: [paid.id] });
  }
  // Batches release each payout in a savepoint so one stale payout does not block the rest.
  const released: string[] = [];
  const requoted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const out = await (tx as unknown as { transaction: <T>(fn: (t: Executor) => Promise<T>) => Promise<T> }).transaction((sp) => releasePayout(sp, actor, id, { expectTerms: expected.get(id) }));
      if (out.status === "paid") released.push(id);
      else { requoted.push(id); failed.push({ id, reason: `Re-quoted: ${out.reason}` }); }
    } catch (e) {
      if (!(e instanceof ActionError)) throw e;
      failed.push({ id, reason: e.message });
    }
  }
  if (!released.length && !requoted.length) throw new ActionError(409, `Nothing released: ${failed.map((f) => f.reason).join(" ")}`, { failed });
  return { ok: released.length > 0, message: `Released ${released.length} of ${ids.length} payouts.${requoted.length ? ` ${requoted.length} re-quoted and need a fresh release.` : ""}`, data: { released, requoted, failed } };
}

// ---------------------------------------------------------------- sponsor

// Sponsor-direct pay. The fiscal sponsor holds the org's funds (1100 "Due from
// sponsor") and pays payees itself. A packet takes exclusive ownership of its
// payout: while one exists the payout cannot be released directly, and the
// payout moves only through the packet.
//   create (organizer): draft packet for a proposed payout; nothing posts.
//   submit (controller, the release): same checks as a direct release; payout
//     -> processing (provider sponsor_packet); accrual Dr expense / Cr
//     withholding payable / Cr AP-attendee.
//   reconcile: remittance equal to the request -> Dr AP / Cr Due from sponsor,
//     payout paid. Any difference is an exception with no ledger effect. A
//     controller may accept a shortfall only when org policy makes recipients
//     bear transfer fees: the sponsor sent the requested amount and the
//     difference was deducted in transit, so AP settles in full. When the org
//     bears fees the shortfall is still owed to the payee and cannot be closed.

export async function sponsorCreate(tx: Executor, actor: ActorContext, p: { payoutId: string }) {
  await lockOrgFinance(tx, actor.orgId);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  if (org.mode === "direct") throw conflict("This organization pays directly. Switch to sponsor or hybrid mode in Settings to use sponsor packets.");
  const [peek] = await tx.select({ personId: s.payout.personId }).from(s.payout).where(and(eq(s.payout.id, p.payoutId), eq(s.payout.orgId, actor.orgId)));
  if (!peek) throw notFound("Payout not found.");
  const person = await loadPerson(tx, actor.orgId, peek.personId, true);
  assertNotBeneficiary(actor, person, "request");
  const [payout] = await tx.select().from(s.payout).where(eq(s.payout.id, p.payoutId)).for("update");
  if (payout.status !== "proposed" && payout.status !== "approved") throw conflict(`Payout is ${payout.status}; only a proposed payout can go to the sponsor.`);
  if (payout.provider === IN_KIND_PROVIDER) throw conflict("In-kind prizes are not paid in cash.");
  const [existing] = await tx.select({ id: s.sponsorPacket.id, status: s.sponsorPacket.status }).from(s.sponsorPacket).where(eq(s.sponsorPacket.payoutId, payout.id));
  if (existing) throw new ActionError(409, `Sponsor packet ${existing.id} already exists for this payout (${existing.status}).`, { packetId: existing.id });
  const profile = await currentProfile(tx, person.id);
  if (payout.sourceType === "award" && effectiveTaxStatus(profile, new Date()) !== "valid") throw conflict("The payee's tax form is missing or invalid; the sponsor packet would be incomplete.");
  const methods = await methodsFor(tx, person.id);
  if (methods.pending) throw conflict("Bank details are pending verification; the packet cannot carry payout instructions yet.");
  const id = newId("sp");
  const pdf = await renderPayoutPacket({
    packetId: id, sponsorName: org.sponsorName || "Fiscal sponsor", preparedAt: new Date().toISOString(),
    payee: { name: person.name, country: person.country, taxForm: profile?.form ?? expectedForm(person), taxStatus: effectiveTaxStatus(profile, new Date()), payoutLast4: methods.active?.last4 },
    source: { type: payout.sourceType, id: (payout.claimId ?? payout.awardId)!, description: payout.reason.slice(0, 120) },
    amounts: { currency: payout.currency, grossMinor: payout.grossMinor.toString(), withholdingMinor: payout.withholdingMinor.toString(), feeMinor: "0", netMinor: (payout.grossMinor - payout.withholdingMinor).toString(), destinationCurrency: payout.destinationCurrency, destinationNetMinor: payout.destinationNetMinor.toString(), fxRate: payout.fxRate },
    provider: SPONSOR_PROVIDER, truth: "Simulated", rule: { id: payout.ruleId, version: payout.ruleVersion, verified: payout.ruleVerified, reportingForm: payout.reportingForm ?? undefined },
    approvals: [], attachments: [],
  });
  const doc = await storeDocument(tx, { orgId: actor.orgId, personId: person.id, uploadedBy: actor.memberId, kind: "sponsor_packet", name: `${id}.pdf`, mimeType: "application/pdf", bytes: pdf });
  const requested = payout.grossMinor - payout.withholdingMinor;
  await tx.insert(s.sponsorPacket).values({ id, orgId: actor.orgId, payoutId: payout.id, requestedMinor: requested, status: "draft", dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000), documentId: doc.id });
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: id, personId: person.id, personName: person.name, action: "sponsor.create", summary: `Sponsor packet drafted for ${usd(requested)} (gross ${usd(payout.grossMinor)} less ${usd(payout.withholdingMinor)} withholding). A controller must submit it; it cannot also be released directly.`, actor, status: "waiting", tool: "sponsorPacket", documentId: doc.id, facts: { payoutId: payout.id, terms: termsKey(payout) } });
  return ok("Sponsor packet drafted.", { id, documentId: doc.id });
}

async function loadPacket(tx: Executor, actor: ActorContext, id: string) {
  const [peek] = await tx.select({ payoutId: s.sponsorPacket.payoutId }).from(s.sponsorPacket).where(and(eq(s.sponsorPacket.id, id), eq(s.sponsorPacket.orgId, actor.orgId)));
  if (!peek) throw notFound("Packet not found.");
  // Lock order: org -> person -> payout -> packet.
  const [{ personId }] = await tx.select({ personId: s.payout.personId }).from(s.payout).where(eq(s.payout.id, peek.payoutId));
  await lockPayee(tx, actor.orgId, personId);
  const [payout] = await tx.select().from(s.payout).where(eq(s.payout.id, peek.payoutId)).for("update");
  const [pk] = await tx.select().from(s.sponsorPacket).where(and(eq(s.sponsorPacket.id, id), eq(s.sponsorPacket.orgId, actor.orgId))).for("update");
  if (!pk) throw notFound("Packet not found.");
  return { pk, payout };
}

/** sponsor.submit: the controller's release for a sponsor-paid payout. */
export async function sponsorSubmit(tx: Executor, actor: ActorContext, p: { id: string }) {
  if (actor.role !== "controller") throw forbidden("Submitting a packet releases money through the sponsor, so only a controller can do it.");
  const { pk } = await loadPacket(tx, actor, p.id);
  if (pk.status !== "draft" && pk.status !== "questioned") throw conflict(`Packet is ${pk.status}.`);
  const check = await prepareRelease(tx, actor, pk.payoutId, "sponsor");
  if (check.kind === "requoted") {
    return { ok: false, message: `Not submitted: the payout was re-quoted (${check.payout.reason}). Draft a new packet for the new terms.`, data: { payoutId: check.payout.id } };
  }
  const payout = check.p;
  if (pk.requestedMinor !== payout.grossMinor - payout.withholdingMinor) throw conflict("The packet no longer matches the payout's terms; draft a new packet.");
  const { org } = await loadOrgEvent(tx, actor.orgId);
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "payout", objectId: payout.id, requestedBy: payout.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: `Submitted to sponsor in packet ${pk.id}`, bankVersion: payout.bankVersion });
  const [sent] = await tx.update(s.payout).set({ status: "processing", provider: SPONSOR_PROVIDER, truth: "Simulated", releasedBy: actor.memberId, providerRef: pk.id, attempts: payout.attempts + 1, feeMinor: 0n, netMinor: pk.requestedMinor, reason: `Submitted to ${org.sponsorName || "the fiscal sponsor"} in packet ${pk.id}; awaiting remittance.` })
    .where(and(eq(s.payout.id, payout.id), inArray(s.payout.status, ["proposed", "approved"]))).returning();
  if (!sent) throw conflict("Payout changed while submitting; try again.");
  await postAccrual(tx, sent, actor.memberId, await payoutCategory(tx, sent));
  await tx.update(s.sponsorPacket).set({ status: "submitted", submittedAt: new Date(), dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000) }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: payout.personId, action: "sponsor.submit", summary: `Submitted ${usd(pk.requestedMinor)} to ${org.sponsorName || "the sponsor"} (Simulated counterparty); expected within ${org.sponsorTurnaroundDays} days. Expense and withholding accrued.`, actor, status: "waiting", tool: "sponsorPacket", facts: { payoutId: payout.id, requestedMinor: pk.requestedMinor.toString() } });
  if (payout.sourceType === "award") await requoteSiblings(tx, actor.orgId, payout.personId, `payment ${payout.id} went to the sponsor`, payout.id, actor);
  return ok("Packet submitted.");
}

export async function reconcilePacket(tx: Executor, actor: ActorContext, p: { id: string; paidMinor?: bigint; acceptShortfall?: boolean; note?: string }) {
  const { pk, payout } = await loadPacket(tx, actor, p.id);
  assertNotBeneficiary(actor, await loadPerson(tx, actor.orgId, payout.personId), "reconcile");
  if (pk.status === "paid") throw conflict("Packet is already reconciled.");
  if (pk.status === "draft") throw conflict("Submit the packet before reconciling.");
  if (payout.status !== "processing" || payout.provider !== SPONSOR_PROVIDER || payout.providerRef !== pk.id) {
    throw conflict(`Payout ${payout.id} is ${payout.status}${payout.provider !== SPONSOR_PROVIDER ? ` via ${payout.provider}` : ""}; this packet does not own it, so nothing can be reconciled.`);
  }
  const { org } = await loadOrgEvent(tx, actor.orgId);
  const paid = p.paidMinor ?? pk.remittanceMinor;
  if (paid == null) throw invalid("Enter the amount the sponsor paid.");
  const short = pk.requestedMinor - paid;
  const facts = { requestedMinor: pk.requestedMinor.toString(), paidMinor: paid.toString(), payoutId: payout.id, feesPaidBy: org.feesPaidBy };
  if (short !== 0n && !p.acceptShortfall) {
    const reason = `Sponsor paid ${usd(paid)} on a ${usd(pk.requestedMinor)} request (${short > 0n ? "short" : "over"} ${usd(short < 0n ? -short : short)}).${p.note ? ` ${p.note}` : ""} Nothing posted; the payout stays open until this is resolved.`;
    await tx.update(s.sponsorPacket).set({ status: "exception", paidMinor: paid, remittanceMinor: paid, reason }).where(eq(s.sponsorPacket.id, pk.id));
    await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: payout.personId, action: "sponsor.reconcile", summary: reason, actor, status: "escalated", tool: "reconcile", facts });
    return ok(reason, { status: "exception" });
  }
  let reason = `Sponsor paid ${usd(paid)} as requested.`;
  if (short !== 0n) {
    if (actor.role !== "controller") throw forbidden("Only a controller can accept a remittance that differs from the request.");
    if (!p.note) throw invalid("Explain why the difference is acceptable (note).");
    if (short < 0n) throw conflict(`The sponsor paid ${usd(-short)} more than requested. Ask the sponsor to correct the remittance; Eve does not book overpayments as settled.`);
    if (org.feesPaidBy === "org") {
      throw conflict(`Org policy says the org bears transfer fees, so the ${usd(short)} shortfall is still owed to the payee. Ask the sponsor to send the difference, then reconcile with the full amount.`);
    }
    reason = `Accepted: sponsor sent ${usd(pk.requestedMinor)} and the payee received ${usd(paid)}; ${usd(short)} was deducted in transit, which recipients bear under org policy. ${p.note}`;
  }
  const settled = pk.requestedMinor;
  if (settled > 0n) {
    await postJournal(tx, {
      orgId: actor.orgId, memo: `Sponsor paid packet ${pk.id}`, sourceType: "packet", sourceId: pk.id, idempotencyKey: `sponsor-pay:${pk.id}`, createdBy: actor.memberId,
      lines: [
        { account: "2000", debitMinor: settled, currency: "USD", personId: payout.personId, memo: "Payable settled by the sponsor" },
        { account: "1100", creditMinor: settled, currency: "USD", memo: `${org.sponsorName || "Sponsor"} disbursement (Simulated counterparty)` },
      ],
    });
  }
  const now = new Date();
  await tx.update(s.payout).set({ status: "paid", paidAt: now, destinationNetMinor: payout.destinationCurrency === "USD" ? paid : payout.destinationNetMinor, reason }).where(eq(s.payout.id, payout.id));
  if (payout.claimId) await tx.update(s.claim).set({ status: "paid" }).where(eq(s.claim.id, payout.claimId));
  if (payout.awardId) await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, payout.awardId));
  await tx.update(s.sponsorPacket).set({ status: "paid", paidMinor: paid, reason }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: payout.personId, action: "sponsor.reconcile", summary: reason, actor, status: "done", tool: "reconcile", facts });
  return ok(reason, { status: "paid" });
}

// ---------------------------------------------------------------- filings

export async function generateFilings(tx: Executor, actor: ActorContext, p: { year?: number }) {
  const { org, event } = await loadOrgEvent(tx, actor.orgId);
  const year = p.year ?? event.startsAt.getUTCFullYear();
  const rows = await tx.select({ payout: s.payout, person: s.person }).from(s.payout).innerJoin(s.person, eq(s.person.id, s.payout.personId))
    .where(and(eq(s.payout.orgId, actor.orgId), eq(s.payout.sourceType, "award"), eq(s.payout.status, "paid"), sql`extract(year from ${s.payout.paidAt}) = ${year}`));
  const groups = new Map<string, { person: typeof s.person.$inferSelect; form: "1099-MISC" | "1099-NEC" | "1042-S"; gross: bigint; wh: bigint; payments: { date: string; description: string; grossMinor: string }[]; rule: { id: string; version: number; verified: boolean } }>();
  for (const { payout, person } of rows) {
    const reporting = payout.reportingForm ?? "";
    const form = reporting.startsWith("1042-S") ? "1042-S" : reporting.startsWith("1099-NEC") ? "1099-NEC" : reporting.startsWith("1099-MISC") ? "1099-MISC" : null;
    if (!form) continue;
    const key = `${person.id}:${form}`;
    const g = groups.get(key) ?? { person, form, gross: 0n, wh: 0n, payments: [], rule: { id: payout.ruleId, version: payout.ruleVersion, verified: payout.ruleVerified } };
    g.gross += payout.grossMinor;
    g.wh += payout.withholdingMinor;
    g.payments.push({ date: payout.paidAt!.toISOString().slice(0, 10), description: `Payout ${payout.id}`, grossMinor: payout.grossMinor.toString() });
    groups.set(key, g);
  }
  const rules = await tx.select().from(s.taxRule);
  let count = 0;
  for (const g of groups.values()) {
    // US forms only once the same-form total reaches the rule threshold; 1042-S has no threshold.
    const threshold = rules.find((r) => r.id === g.rule.id && r.version === g.rule.version)?.thresholdMinor ?? 0n;
    if (g.form !== "1042-S" && g.gross < threshold) continue;
    const profile = await currentProfile(tx, g.person.id);
    const pdf = await renderFilingDraft({ form: g.form, year, payer: { name: org.name, address: "On file" }, payee: { name: g.person.name, address: g.person.address, country: g.person.country, tinLast4: profile?.tinLast4 ?? undefined }, currency: "USD", grossMinor: g.gross.toString(), withholdingMinor: g.wh.toString(), box: g.form === "1099-MISC" ? "3" : g.form === "1099-NEC" ? "1" : "2", rule: g.rule, payments: g.payments });
    const doc = await storeDocument(tx, { orgId: actor.orgId, personId: g.person.id, uploadedBy: actor.memberId, kind: "filing", name: `${g.form}-${year}-${g.person.name}.pdf`, mimeType: "application/pdf", bytes: pdf });
    await tx.insert(s.filing).values({ id: newId("fil"), orgId: actor.orgId, personId: g.person.id, year, form: g.form, grossMinor: g.gross, withholdingMinor: g.wh, documentId: doc.id })
      .onConflictDoUpdate({ target: [s.filing.orgId, s.filing.personId, s.filing.year, s.filing.form], set: { grossMinor: g.gross, withholdingMinor: g.wh, documentId: doc.id, status: "draft" } });
    count++;
  }
  await recordDecision(tx, { orgId: actor.orgId, objectType: "filings", objectId: String(year), action: "filings.generate", summary: `Drafted ${count} filing(s) for ${year}. Drafts only; a controller signs.`, actor, status: "done", tool: "draftFilings" });
  return ok(`Drafted ${count} filing(s) for ${year}.`, { count, year });
}

// ------------------------------------------------------------- agent/demo

/** Sanitized context for chase messages: no TINs, bank numbers or addresses. */
export async function missingFormContext(db: Executor, orgId: string) {
  const rows = await db.select({ person: s.person, award: s.award }).from(s.award).innerJoin(s.person, eq(s.person.id, s.award.personId))
    .where(and(eq(s.award.orgId, orgId), eq(s.award.status, "needs_form")));
  const now = new Date();
  const out = [];
  for (const { person, award } of rows) {
    const profile = await currentProfile(db, person.id);
    out.push({ personId: person.id, name: person.name, emailMasked: maskEmail(person.email), country: person.country, form: expectedForm(person), taxStatus: effectiveTaxStatus(profile, now), awardId: award.id, awardTitle: award.title, amountMinor: award.amountMinor.toString(), chaseCount: person.chaseCount, lastChasedAt: person.lastChasedAt?.toISOString() ?? null });
  }
  return out;
}

export async function runAgent(tx: Executor, actor: ActorContext, kind: "claims" | "chase" | "all" = "all") {
  const runId = newId("run");
  await tx.insert(s.agentRun).values({ id: runId, orgId: actor.orgId, kind, status: "running", triggeredBy: actor.name });
  const agent = agentActor(actor.orgId);
  let processed = 0, chased = 0, proposed = 0;
  if (kind !== "chase") {
    const pending = await tx.select({ id: s.claim.id }).from(s.claim).where(and(eq(s.claim.orgId, actor.orgId), inArray(s.claim.status, ["submitted", "processing"])));
    for (const c of pending) { await processClaim(tx, agent, c.id, runId); processed++; }
    // Queue ready cash awards (and items converted to cash) for controller release.
    const ready = await tx.select().from(s.award).where(and(eq(s.award.orgId, actor.orgId), inArray(s.award.status, ["ready", "needs_form"])));
    for (const a of ready) {
      if (a.kind === "item" && a.fulfillment !== "cash") continue;
      if (a.status === "needs_form") {
        const live0 = await tx.select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.awardId, a.id), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
        if (live0.length) continue;
      }
      const live = await tx.select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.awardId, a.id), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
      if (live.length) continue;
      if (a.teamId) {
        const team = await tx.select({ ok: s.award.splitConfirmed }).from(s.award).where(eq(s.award.teamId, a.teamId));
        if (team.some((t) => !t.ok)) continue;
      }
      try {
        await (tx as unknown as { transaction: <T>(fn: (t: Executor) => Promise<T>) => Promise<T> }).transaction((sp) => proposePayout(sp, agent, { sourceType: "award", sourceId: a.id }));
        proposed++;
      } catch (e) {
        if (!(e instanceof ActionError)) throw e;
        await recordDecision(tx, { orgId: actor.orgId, runId, objectType: "award", objectId: a.id, personId: a.personId, action: "payout.propose", summary: `Not proposed: ${e.message}`, actor: agent, status: "escalated", tool: "computeWithholding+quotePayouts" });
      }
    }
  }
  if (kind !== "claims") {
    const missing = await missingFormContext(tx, actor.orgId);
    const cutoff = Date.now() - 60_000;
    for (const m of missing) {
      if (m.lastChasedAt && Date.parse(m.lastChasedAt) > cutoff) continue;
      await recordNotice(tx, { orgId: actor.orgId, personId: m.personId, channel: `email ${m.emailMasked}`, title: `Action needed: ${m.form} for ${m.awardTitle}`, body: `Your ${m.awardTitle} payment is on hold until your ${m.form} is complete. It takes about five minutes in the Eve portal.` });
      await tx.update(s.person).set({ chaseCount: sql`${s.person.chaseCount} + 1`, lastChasedAt: new Date() }).where(eq(s.person.id, m.personId));
      await recordDecision(tx, { orgId: actor.orgId, runId, objectType: "person", objectId: m.personId, personId: m.personId, personName: m.name, action: "agent.chase", summary: `Chased ${m.name} for a ${m.form} (${m.chaseCount + 1}${m.chaseCount ? "th" : "st"} reminder).`, actor: agent, status: "waiting", tool: "messagePerson", nextActionAt: new Date(Date.now() + 2 * 86_400_000) });
      chased++;
    }
  }
  const summary = `Processed ${processed} claim(s), proposed ${proposed} prize payout(s), chased ${chased} person(s).`;
  await tx.update(s.agentRun).set({ status: "done", finishedAt: new Date(), summary }).where(eq(s.agentRun.id, runId));
  return { runId, processed, proposed, chased, summary };
}

async function assertDemoOrg(tx: Executor, actor: ActorContext) {
  if (!demoModeEnabled()) throw forbidden("Demo actions are disabled.");
  const [org] = await tx.select({ isDemo: s.organization.isDemo }).from(s.organization).where(eq(s.organization.id, actor.orgId));
  if (!org?.isDemo) throw forbidden("Demo actions only work in the demo organization.");
}

async function demoRun(tx: Executor, actor: ActorContext) {
  await assertDemoOrg(tx, actor);
  const run = await runAgent(tx, actor, "all");
  const submitted = await tx.select({ id: s.sponsorPacket.id }).from(s.sponsorPacket).where(and(eq(s.sponsorPacket.orgId, actor.orgId), eq(s.sponsorPacket.status, "submitted"), sql`${s.sponsorPacket.remittanceMinor} IS NOT NULL`));
  for (const pk of submitted) await reconcilePacket(tx, actor, { id: pk.id });
  await generateFilings(tx, actor, {});
  const board = await computeScoreboard(tx, actor.orgId);
  await saveScoreboard(tx, actor.orgId, board);
  return ok(`${run.summary} Scoreboard: caught ${board.caught} of ${board.total}, ${board.falsePositives} false positive(s), ${board.wrongfulPayouts} wrongful payout(s).`, { scoreboard: board });
}

// --------------------------------------------------------------- flights

function offerKey(): Buffer | undefined {
  try {
    return offerSigningKeyFromEnv();
  } catch {
    return undefined;
  }
}

async function flightSearch(tx: Executor, actor: ActorContext, p: { origin: string; date?: string; personId?: string }) {
  if (p.personId) assertSelfOrStaff(actor, p.personId);
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const offers = fixtureOffers(p.origin);
  const result = suggestFlights(offers, toEvent(event));
  const key = offerKey();
  // The token binds the server's price and itinerary; flight.request trusts only the token or the fixture table.
  const options = key ? signOffers(result.options, key, Date.now()) : result.options;
  return ok(result.options.length ? `${result.options.length} option(s) under policy.` : result.reason, { offers: options, rejected: result.rejected, truth: result.truth });
}

/**
 * flight.request: the attendee picks a server-issued offer and asks the org to
 * buy it. Price, carrier, times and cabin come only from the verified offer;
 * client copies are compared and reported. Stored as a travel claim
 * (category org_booked_flight) that an organizer approves; approval records a
 * simulated booking and never pays the attendee.
 */
async function flightRequest(tx: Executor, actor: ActorContext, p: { personId?: string; offerId: string; origin: string; offerToken?: string; carrier?: string; departAt?: string; amountMinor?: bigint; currency?: string; cabin?: string }) {
  const personId = p.personId ?? actor.personId;
  if (!personId) throw invalid("personId is required.");
  assertSelfOrStaff(actor, personId);
  const person = await lockPayee(tx, actor.orgId, personId);
  if (!person.adult) throw conflict("Eve cannot book travel for anyone under 18 at the event start date.");
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const verified = await verifyFlightRequest({
    offerId: p.offerId, origin: p.origin, offerToken: p.offerToken,
    claimed: { carrier: p.carrier, departAt: p.departAt, amountMinor: p.amountMinor?.toString(), currency: p.currency, cabin: p.cabin as "economy" | undefined },
  }, { event: toEvent(event), now: Date.now(), signingKey: offerKey() });
  if (!verified.ok) throw new ActionError(verified.code === "expired" ? 409 : 400, verified.reason, { code: verified.code });
  const offer = verified.offer;
  const key = `flight:${personId}:${offer.id}`;
  const existing = await tx.select({ id: s.claim.id, status: s.claim.status, idempotencyKey: s.claim.idempotencyKey }).from(s.claim)
    .where(and(eq(s.claim.orgId, actor.orgId), eq(s.claim.personId, personId), eq(s.claim.category, ORG_BOOKED_FLIGHT), sql`${s.claim.status} NOT IN ('rejected')`));
  const same = existing.find((c) => c.idempotencyKey === key);
  if (same) return ok("This flight was already requested.", { claimId: same.id, status: same.status, replayed: true });
  if (existing.length) throw new ActionError(409, `You already have an org flight request (${existing[0].status}). Ask an organizer to reject it before requesting another.`, { claimId: existing[0].id });
  const evidence: ClaimEvidence = {
    source: "org_booking", corroborated: true, mismatches: verified.mismatches,
    offer: { id: offer.id, carrier: offer.carrier, flightNumber: offer.flightNumber, origin: offer.origin, destination: offer.destination, departAt: offer.departAt, cabin: offer.cabin, totalMinor: offer.totalMinor, currency: offer.currency, source: verified.source, truth: verified.truth, policyOk: verified.policyOk, policyReason: verified.policyReason },
  };
  const { claim } = await submitClaim(tx, actor, {
    personId, type: "travel", merchant: `${offer.carrier} ${offer.flightNumber}`.trim(),
    description: `Org booking request: ${offer.origin} → ${offer.destination}, offer ${offer.id} (${verified.truth} fare)`, category: ORG_BOOKED_FLIGHT,
    amountMinor: BigInt(offer.totalMinor), currency: offer.currency, purchasedAt: new Date().toISOString(), travelDate: offer.departAt,
    cabin: offer.cabin, origin: offer.origin, nameOnReceipt: person.name, idempotencyKey: key,
  }, evidence);
  return ok(`Flight request sent to organizers: ${claim.reason}`, { claimId: claim.id, status: claim.status, offerId: offer.id, amountMinor: offer.totalMinor, currency: offer.currency, truth: verified.truth, mismatches: verified.mismatches });
}

// ----------------------------------------------------------------- table

const handlers: Record<AppAction, Handler> = {
  "org.update": orgUpdate as Handler,
  "event.update": eventUpdate as Handler,
  "budget.update": budgetUpdate as Handler,
  "people.import": peopleImport as Handler,
  "person.update": personUpdate as Handler,
  "tax.submit": taxSubmit as Handler,
  "claim.submit": (async (tx, actor, p, prepared) => {
    const { claim, replayed } = await submitClaim(tx, actor, p, prepared as ClaimEvidence);
    return ok(replayed ? "Claim already submitted." : claim.status === "approved" ? "Claim approved and queued for payout." : `Claim ${claim.status}: ${claim.reason}`, { claimId: claim.id, status: claim.status });
  }) as Handler,
  "claim.review": (async (tx, actor, p) => ok("Claim reviewed.", await reviewClaim(tx, actor, p))) as Handler,
  "award.create": awardCreate as Handler,
  "award.choose": awardChoose as Handler,
  "award.split": awardSplit as Handler,
  "award.confirm": awardConfirm as Handler,
  "award.fulfill": awardFulfill as Handler,
  "payout.propose": (async (tx, actor, p) => {
    const row = await proposePayout(tx, actor, p);
    return ok(row.status === "proposed" ? "Payout proposed for controller release." : `Payout ${row.status}: ${row.reason}`, { payoutId: row.id, status: row.status });
  }) as Handler,
  "payout.release": payoutRelease as Handler,
  "payout.bankChange": (async (tx, actor, p) => {
    assertSelfOrStaff(actor, p.personId);
    const r = await changeBankDetails(tx, actor, p);
    return ok(`Bank change recorded. ${r.frozen.length} payout(s) frozen; verification requested through ${r.sentTo} (delivery pending).`, r);
  }) as Handler,
  "payout.verify": (async (tx, actor, p) => {
    const r = await verifyBankChange(tx, actor, p);
    return { ok: r.ok, message: r.message, data: r.ok ? { payouts: r.payouts } : undefined };
  }) as Handler,
  "payout.retry": (async (tx, actor, p) => ok("Payout retried.", { payoutId: (await retryPayout(tx, actor, p.id)).id })) as Handler,
  "sponsor.create": sponsorCreate as Handler,
  "sponsor.submit": sponsorSubmit as Handler,
  "sponsor.reconcile": reconcilePacket as Handler,
  "period.lock": (async (tx, actor, p) => {
    const r = await lockPeriod(tx, { orgId: actor.orgId, month: p.period, lockedBy: actor.memberId });
    await recordDecision(tx, { orgId: actor.orgId, objectType: "period", objectId: p.period, action: "period.lock", summary: `Locked ${r.startsOn} to ${r.endsOn}. New entries in this period are rejected.`, actor, status: "done", tool: "lockPeriod" });
    return ok(`Locked ${p.period}.`, r);
  }) as Handler,
  "filings.generate": generateFilings as Handler,
  "demo.reset": (async (tx, actor) => {
    await assertDemoOrg(tx, actor);
    const { resetDemoOrg } = await import("./seed");
    await resetDemoOrg(tx);
    return ok("Demo data reset.");
  }) as Handler,
  "demo.run": demoRun as Handler,
  "agent.run": (async (tx, actor, p) => {
    const r = await runAgent(tx, actor, p.kind);
    return ok(r.summary, r);
  }) as Handler,
  "flight.search": flightSearch as Handler,
  "flight.request": flightRequest as Handler,
};

/** Same path as POST /api/actions: validate, authorize, prepare (outside tx), run in a transaction. */
export async function runAuthorizedAction(actor: ActorContext, action: string, rawPayload: unknown): Promise<ActionResult & { status: number }> {
  if (!(action in actionSchemas)) return { ok: false, status: 400, message: `Unknown action ${action}.` };
  const name = action as AppAction;
  if (actor.role === "auditor") return { ok: false, status: 403, message: "Auditors have read-only access." };
  try {
    assertMayInvoke(actor, name);
  } catch (e) {
    return { ok: false, status: 403, message: (e as Error).message };
  }
  const parsed = actionSchemas[name].safeParse(rawPayload ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, message: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ") };
  }
  const payload = parsed.data as never;
  const db = getDb();
  try {
    let prepared: unknown;
    if (name === "claim.submit") prepared = await prepareClaim(db, actor, payload);
    const result = await db.transaction(async (tx) => {
      // Lock order for every mutation: organization first (see payouts.ts).
      if (name !== "flight.search") await lockOrgFinance(tx, actor.orgId);
      return handlers[name](tx, actor, payload, prepared);
    });
    return { ...result, status: result.ok ? 200 : 409 };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, status: e.status, message: e.message, data: e.data };
    const msg = describeDbError(e);
    if (msg) return { ok: false, status: 409, message: msg };
    console.error(`[actions] ${name} failed`, e instanceof Error ? e.name : "error");
    throw e;
  }
}

/** Maps database integrity errors (raised by constraints/triggers) to user-safe messages. */
function describeDbError(e: unknown): string | null {
  let cur: unknown = e;
  while (cur instanceof Error) {
    const code = (cur as Error & { code?: string }).code;
    if (code === "23505") return "That already exists (duplicate request).";
    if (code === "23514" || code === "23000") return cur.message.replace(/^.*?: /, "");
    if (cur.name === "EngineError") return cur.message;
    if (cur.name === "LedgerError") return cur.message;
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return null;
}

export async function processClaimById(actor: ActorContext, claimId: string) {
  return getDb().transaction((tx) => processClaim(tx, actor, claimId));
}

export async function runAgentForOrg(orgId: string, kind: "claims" | "chase" | "all" = "all") {
  return getDb().transaction((tx) => runAgent(tx, agentActor(orgId), kind));
}
