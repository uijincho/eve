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
import { lockPeriod } from "@/lib/ledger";
import { renderFilingDraft, renderPayoutPacket, renderTaxFormReceipt } from "@/lib/pdf";

import { actionSchemas } from "./action-schemas";
import { prepareClaim, processClaim, reviewClaim, submitClaim, type ClaimEvidence } from "./claims";
import {
  ActionError, agentActor, assertMayInvoke, assertSelfOrStaff, conflict, currentProfile, effectiveTaxStatus, expectedForm, forbidden,
  invalid, isAdultAt, loadOrgEvent, loadPerson, maskEmail, methodsFor, normName, notFound, recordDecision, recordNotice, storeDocument,
  toAward, toEvent, toPerson, usd,
} from "./core";
import { recommendFulfillment, splitAward, w8ExpiresAt } from "./engines";
import { changeBankDetails, proposePayout, reevaluatePerson, releasePayout, retryPayout, verifyBankChange } from "./payouts";
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
  const re = await reevaluatePerson(tx, actor.orgId, person.id);
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "tax.submit",
    summary: status === "valid" ? `${p.form} signed and valid${expiresAt ? ` until ${expiresAt.toISOString().slice(0, 10)}` : ""}. ${re.requoted} held payout(s) re-evaluated.` : `${p.form} needs review: ${blocking.join(" ")}`,
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
  const [a] = await tx.select().from(s.award).where(and(eq(s.award.id, id), eq(s.award.orgId, actor.orgId))).for("update");
  if (!a) throw notFound("Award not found.");
  return a;
}

async function awardChoose(tx: Executor, actor: ActorContext, p: { id: string; fulfillment: "ship" | "local" | "cash" }) {
  const a = await loadAward(tx, actor, p.id);
  assertSelfOrStaff(actor, a.personId);
  if (a.status === "paid" || a.status === "proposed") throw conflict(`Award is already ${a.status}.`);
  if (a.kind === "cash" && p.fulfillment !== "cash") throw invalid("Cash prizes are paid in cash.");
  await tx.update(s.award).set({ fulfillment: p.fulfillment }).where(eq(s.award.id, a.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, action: "award.choose", summary: `Fulfillment set to ${p.fulfillment}.`, actor, status: "done", tool: "fulfillment" });
  return ok(`Fulfillment set to ${p.fulfillment}.`);
}

async function awardSplit(tx: Executor, actor: ActorContext, p: { teamId: string; splits: { personId: string; bps: number }[] }) {
  const team = await tx.select().from(s.award).where(and(eq(s.award.teamId, p.teamId), eq(s.award.orgId, actor.orgId))).for("update");
  if (!team.length) throw notFound("Team not found.");
  if (actor.role === "attendee" && !team.some((a) => a.personId === actor.personId)) throw forbidden("Only team members can propose a split.");
  if (team.some((a) => a.status === "paid" || a.status === "proposed")) throw conflict("Payouts already exist for this team.");
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
  await tx.update(s.award).set({ splitConfirmed: true }).where(eq(s.award.id, a.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, action: "award.confirm", summary: `${actor.name} confirmed their share of ${usd(a.amountMinor)}.`, actor, status: "done", tool: "splitAward" });
  return ok("Split confirmed.");
}

// ---------------------------------------------------------------- payouts

async function payoutRelease(tx: Executor, actor: ActorContext, p: { id?: string; ids?: string[] }) {
  const ids = p.ids ?? [p.id!];
  if (ids.length === 1) {
    const paid = await releasePayout(tx, actor, ids[0]);
    return ok(`Released ${usd(paid.netMinor)}.`, { released: [paid.id] });
  }
  // Batches release each payout in a savepoint so one stale payout does not block the rest.
  const released: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      await (tx as unknown as { transaction: (fn: (t: Executor) => Promise<unknown>) => Promise<unknown> }).transaction((sp) => releasePayout(sp, actor, id));
      released.push(id);
    } catch (e) {
      if (!(e instanceof ActionError)) throw e;
      failed.push({ id, reason: e.message });
    }
  }
  if (!released.length) throw new ActionError(409, `Nothing released: ${failed.map((f) => f.reason).join(" ")}`, { failed });
  return ok(`Released ${released.length} of ${ids.length} payouts.`, { released, failed });
}

// ---------------------------------------------------------------- sponsor

export async function sponsorCreate(tx: Executor, actor: ActorContext, p: { payoutId: string }) {
  const [row] = await tx.select({ payout: s.payout, person: s.person }).from(s.payout).innerJoin(s.person, eq(s.person.id, s.payout.personId))
    .where(and(eq(s.payout.id, p.payoutId), eq(s.payout.orgId, actor.orgId)));
  if (!row) throw notFound("Payout not found.");
  const { payout, person } = row;
  if (["held", "frozen", "failed", "returned"].includes(payout.status)) throw conflict(`Payout is ${payout.status}; it cannot go to the sponsor.`);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  const profile = await currentProfile(tx, person.id);
  const methods = await methodsFor(tx, person.id);
  const id = newId("sp");
  const pdf = await renderPayoutPacket({
    packetId: id, sponsorName: org.sponsorName || "Fiscal sponsor", preparedAt: new Date().toISOString(),
    payee: { name: person.name, country: person.country, taxForm: profile?.form ?? expectedForm(person), taxStatus: effectiveTaxStatus(profile, new Date()), payoutLast4: methods.active?.last4 },
    source: { type: payout.sourceType, id: (payout.claimId ?? payout.awardId)!, description: payout.reason.slice(0, 120) },
    amounts: { currency: payout.currency, grossMinor: payout.grossMinor.toString(), withholdingMinor: payout.withholdingMinor.toString(), feeMinor: payout.feeMinor.toString(), netMinor: payout.netMinor.toString(), destinationCurrency: payout.destinationCurrency, destinationNetMinor: payout.destinationNetMinor.toString(), fxRate: payout.fxRate },
    provider: "sponsor_packet", truth: payout.truth, rule: { id: payout.ruleId, version: payout.ruleVersion, verified: payout.ruleVerified, reportingForm: payout.reportingForm ?? undefined },
    approvals: [], attachments: [],
  });
  const doc = await storeDocument(tx, { orgId: actor.orgId, personId: person.id, uploadedBy: actor.memberId, kind: "sponsor_packet", name: `${id}.pdf`, mimeType: "application/pdf", bytes: pdf });
  const requested = payout.grossMinor - payout.withholdingMinor;
  await tx.insert(s.sponsorPacket).values({ id, orgId: actor.orgId, payoutId: payout.id, requestedMinor: requested, status: "draft", dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000), documentId: doc.id })
    .onConflictDoNothing();
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: id, personId: person.id, personName: person.name, action: "sponsor.create", summary: `Sponsor packet drafted for ${usd(requested)}.`, actor, status: "done", tool: "sponsorPacket", documentId: doc.id });
  return ok("Sponsor packet drafted.", { id, documentId: doc.id });
}

async function loadPacket(tx: Executor, actor: ActorContext, id: string) {
  const [pk] = await tx.select().from(s.sponsorPacket).where(and(eq(s.sponsorPacket.id, id), eq(s.sponsorPacket.orgId, actor.orgId))).for("update");
  if (!pk) throw notFound("Packet not found.");
  return pk;
}

export async function sponsorSubmit(tx: Executor, actor: ActorContext, p: { id: string }) {
  const pk = await loadPacket(tx, actor, p.id);
  if (pk.status !== "draft" && pk.status !== "questioned") throw conflict(`Packet is ${pk.status}.`);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  await tx.update(s.sponsorPacket).set({ status: "submitted", submittedAt: new Date(), dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000) }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, action: "sponsor.submit", summary: `Submitted to ${org.sponsorName || "the sponsor"}; expected within ${org.sponsorTurnaroundDays} days.`, actor, status: "waiting", tool: "sponsorPacket" });
  return ok("Packet submitted.");
}

export async function reconcilePacket(tx: Executor, actor: ActorContext, p: { id: string; paidMinor?: bigint; acceptShortfall?: boolean; note?: string }) {
  const pk = await loadPacket(tx, actor, p.id);
  if (pk.status === "paid") throw conflict("Packet is already reconciled.");
  if (pk.status === "draft") throw conflict("Submit the packet before reconciling.");
  const paid = p.paidMinor ?? pk.remittanceMinor;
  if (paid == null) throw invalid("Enter the amount the sponsor paid.");
  const short = pk.requestedMinor - paid;
  let status: "paid" | "exception" = "paid";
  let reason = `Sponsor paid ${usd(paid)} as requested.`;
  if (short !== 0n && !p.acceptShortfall) {
    status = "exception";
    reason = `Sponsor paid ${usd(paid)} on a ${usd(pk.requestedMinor)} request (${short > 0n ? "short" : "over"} ${usd(short < 0n ? -short : short)}).${p.note ? ` ${p.note}` : ""}`;
  } else if (short > 0n) {
    reason = `Accepted ${usd(paid)} on ${usd(pk.requestedMinor)}; ${usd(short)} booked as a sponsor wire fee.`;
    const { postJournal } = await import("@/lib/ledger");
    await postJournal(tx, { orgId: actor.orgId, memo: `Sponsor fee on ${pk.id}`, sourceType: "packet", sourceId: pk.id, idempotencyKey: `sponsor-fee:${pk.id}`, createdBy: actor.memberId, lines: [{ account: "5300", debitMinor: short, currency: "USD" }, { account: "1100", creditMinor: short, currency: "USD" }] });
  }
  await tx.update(s.sponsorPacket).set({ status, paidMinor: paid, reason }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, action: "sponsor.reconcile", summary: reason, actor, status: status === "paid" ? "done" : "escalated", tool: "reconcile", facts: { requestedMinor: pk.requestedMinor.toString(), paidMinor: paid.toString() } });
  return ok(reason, { status });
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
      const live = await tx.select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.awardId, a.id), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
      if (live.length) continue;
      if (a.teamId) {
        const team = await tx.select({ ok: s.award.splitConfirmed }).from(s.award).where(eq(s.award.teamId, a.teamId));
        if (team.some((t) => !t.ok)) continue;
      }
      await proposePayout(tx, agent, { sourceType: "award", sourceId: a.id });
      proposed++;
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

async function flightSearch(tx: Executor, actor: ActorContext, p: { origin: string; date?: string; personId?: string }) {
  if (p.personId) assertSelfOrStaff(actor, p.personId);
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const offers = fixtureOffers(p.origin);
  const result = suggestFlights(offers, toEvent(event));
  return ok(result.options.length ? `${result.options.length} option(s) under policy.` : result.reason, { offers: result.options, rejected: result.rejected, truth: result.truth });
}

async function flightRequest(tx: Executor, actor: ActorContext, p: { personId?: string; offerId: string; origin: string; carrier: string; departAt: string; amountMinor: bigint; currency?: string; cabin?: string }) {
  const personId = p.personId ?? actor.personId;
  if (!personId) throw invalid("personId is required.");
  assertSelfOrStaff(actor, personId);
  const person = await loadPerson(tx, actor.orgId, personId);
  const evidence: ClaimEvidence = { source: "org_booking", corroborated: true, mismatches: [] };
  const { claim } = await submitClaim(tx, actor, {
    personId, type: "travel", merchant: p.carrier, description: `Org booking request: offer ${p.offerId}`, category: "org_booked_flight",
    amountMinor: p.amountMinor, currency: p.currency ?? "USD", purchasedAt: new Date().toISOString(), travelDate: p.departAt,
    cabin: p.cabin ?? "economy", origin: p.origin, nameOnReceipt: person.name, idempotencyKey: `flight:${personId}:${p.offerId}`,
  }, evidence);
  return ok(claim.status === "approved" ? "Flight request approved for booking." : `Flight request sent to organizers: ${claim.reason}`, { claimId: claim.id, status: claim.status });
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
  "payout.propose": (async (tx, actor, p) => {
    const row = await proposePayout(tx, actor, p);
    return ok(row.status === "proposed" ? "Payout proposed for controller release." : `Payout ${row.status}: ${row.reason}`, { payoutId: row.id, status: row.status });
  }) as Handler,
  "payout.release": payoutRelease as Handler,
  "payout.bankChange": (async (tx, actor, p) => {
    assertSelfOrStaff(actor, p.personId);
    const r = await changeBankDetails(tx, actor, p);
    return ok(`Bank change recorded. ${r.frozen.length} payout(s) frozen; confirmation sent to ${r.sentTo}.`, r);
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
    const result = await db.transaction((tx) => handlers[name](tx, actor, payload, prepared));
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
