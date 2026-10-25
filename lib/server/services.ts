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
import type { ActionResult, AppAction, TaxRule } from "@/lib/contracts";
import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { destinationFor, fixtureOrigins, fixtureOffers, suggestFlights } from "@/lib/flights";
import { offerSigningKeyFromEnv, signOffers, verifyFlightRequest } from "@/lib/flights/verify";
import { lockPeriod, postJournal, type JournalLineInput } from "@/lib/ledger";
import { convertMinor as convertFx } from "@/lib/engines/money";
import { renderTaxFormReceipt } from "@/lib/pdf";
import { renderW8ben } from "@/lib/pdf/w8ben";
import { W8BEN_REVISION } from "@/lib/tax/w8ben";

import { renderSponsorDocument } from "./sponsor-document";
import { actionSchemas } from "./action-schemas";
import { explainClaim, prepareClaim, processClaim, reviewClaim, submitClaim, type ClaimEvidence } from "./claims";
import {
  acceptedForms, ActionError, BOOKS_CURRENCY, fromUsd, money, toUsd, agentActor, assertMayInvoke, assertSelfOrStaff, conflict, currentProfile, effectiveTaxStatus, expectedForm, forbidden,
  isUsPerson, profileValidFor, taxPayeeCountry,
  invalid, isAdultAt, loadOrgEvent, loadPerson, maskEmail, methodsFor, normName, notFound, recordDecision, recordNotice, storeDocument,
  toAward, toEvent, toPerson, usd,
} from "./core";
import { assertFits, ORG_BOOKED_FLIGHT, prizeBudgetRoom } from "./budget";
import { computeTax, grossUp, recommendFulfillment, selectRule, splitAward, w8ExpiresAt } from "./engines";
import {
  assertNotInBatch, assertNotBeneficiary, changeBankDetails, IN_KIND_PROVIDER, liveOverride, loadRules, loadSource, requote, loadPayoutContext, lockOrgFinance, lockPayee, payoutCategory, postAccrual, prepareRelease,
  proposePayout, reevaluatePerson, releasePayout, requoteSiblings, retryPayout, SPONSOR_PROVIDER, taxFor, termsKey, verifyBankChange,
} from "./payouts";
import { computeScoreboard, saveScoreboard } from "./scoreboard";
import { vaultTin } from "./tin";
import { generateFilings } from "./filings";
export { generateFilings } from "./filings";

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

type ProjectStatus = "unknown" | "submitted" | "none";
type PersonInput = {
  name: string; email: string; country: string; citizenship?: string; dateOfBirth: string; address?: string; role?: string; payoutCurrency?: string;
  projectStatus?: ProjectStatus; projectUrl?: string;
};

/**
 * A signed form certifies the name, residence and citizenship on file at signing.
 * When any of them change, the form no longer evidences the person: it goes to
 * review and every unpaid payout is re-quoted (held until a new form is signed).
 */
async function staleProfileAfterChange(tx: Executor, actor: ActorContext, before: typeof s.person.$inferSelect, after: Pick<typeof s.person.$inferSelect, "name" | "country" | "citizenship" | "adult">) {
  const changed = (["name", "country", "citizenship"] as const).filter((k) => before[k] !== after[k]);
  if (changed.length) {
    // Supersede rather than mutate: the old row stays valid for the period it covered (audit and scoreboard evidence).
    const current = await currentProfile(tx, before.id);
    if (current?.status === "valid") {
      const now = new Date();
      await tx.update(s.taxProfile).set({ supersededAt: now }).where(eq(s.taxProfile.id, current.id));
      await tx.insert(s.taxProfile).values({ ...current, id: newId("tax"), status: "review", statusReason: `The profile's ${changed.join(", ")} changed after signing; a new form is required.`, supersededAt: null, createdAt: now });
    }
  }
  if (changed.length || before.adult !== after.adult) await reevaluatePerson(tx, actor.orgId, before.id, actor);
  return changed;
}

async function peopleImport(tx: Executor, actor: ActorContext, p: { people: PersonInput[] }) {
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const emails = p.people.map((x) => x.email.toLowerCase());
  const before = emails.length ? await tx.select().from(s.person).where(and(eq(s.person.orgId, actor.orgId), inArray(s.person.email, emails))) : [];
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
  let invalidated = 0;
  for (const old of before) {
    const next = rows.find((r) => r.email === old.email)!;
    if ((await staleProfileAfterChange(tx, actor, old, next)).length) invalidated++;
  }
  const minors = rows.filter((r) => !r.adult).length;
  const projectRows = p.people.flatMap((x, i) => {
    const url = x.projectUrl?.trim() || undefined;
    const status = x.projectStatus ?? (url ? "submitted" as const : undefined);
    return status ? [{ email: rows[i].email, name: rows[i].name, status, url }] : [];
  });
  if (projectRows.length) {
    const saved = await tx.select({ id: s.person.id, email: s.person.email }).from(s.person)
      .where(and(eq(s.person.orgId, actor.orgId), inArray(s.person.email, projectRows.map((r) => r.email))));
    const idByEmail = new Map(saved.map((r) => [r.email, r.id]));
    const now = new Date();
    for (const row of projectRows) {
      const personId = idByEmail.get(row.email);
      if (!personId) continue;
      await tx.update(s.person).set({
        projectStatus: row.status, ...(row.url ? { projectUrl: row.url } : {}), projectSource: "csv", projectUpdatedAt: now,
      }).where(eq(s.person.id, personId));
      await recordDecision(tx, {
        orgId: actor.orgId, objectType: "person", objectId: personId, personId, personName: row.name, action: "people.import",
        summary: `Project submission for ${row.name} set to ${row.status} from CSV${row.url ? ` (${row.url})` : ""}.`,
        actor, status: "done", tool: "importPeople", facts: { projectStatus: row.status, projectUrl: row.url ?? null, projectSource: "csv" },
      });
    }
  }
  if (invalidated) await recordDecision(tx, { orgId: actor.orgId, objectType: "people", objectId: event.id, action: "tax.invalidate", summary: `${invalidated} existing tax form(s) moved to review because the imported name, residence or citizenship changed.`, actor, status: "escalated", tool: "validateTaxForm" });
  await recordDecision(tx, { orgId: actor.orgId, objectType: "people", objectId: event.id, action: "people.import", summary: `Imported ${rows.length} people${minors ? `; ${minors} under 18 blocked from payments` : ""}${projectRows.length ? `; ${projectRows.length} project status${projectRows.length === 1 ? "" : "es"} set` : ""}.`, actor, status: minors ? "escalated" : "done", tool: "importPeople", facts: { count: rows.length, minors, projectUpdates: projectRows.length } });
  return ok(`Imported ${rows.length} people.`, { imported: rows.length, minors, projectUpdates: projectRows.length });
}

async function personSetProject(tx: Executor, actor: ActorContext, p: { id: string; projectStatus: ProjectStatus; projectUrl?: string | null }) {
  if (actor.role === "attendee") throw forbidden("Attendees cannot set their own project submission status.");
  const before = await loadPerson(tx, actor.orgId, p.id, true);
  const url = p.projectUrl === undefined ? before.projectUrl : (p.projectUrl?.trim() || null);
  await tx.update(s.person).set({ projectStatus: p.projectStatus, projectUrl: url, projectSource: "organizer", projectUpdatedAt: new Date() }).where(eq(s.person.id, p.id));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "person", objectId: p.id, personId: p.id, personName: before.name, action: "person.setProject",
    summary: `${actor.name} set ${before.name}'s project submission to ${p.projectStatus}${url ? ` (${url})` : ""}.`,
    actor, status: "done", tool: "profile", facts: { before: before.projectStatus, projectStatus: p.projectStatus, projectUrl: url, projectSource: "organizer" },
  });
  return ok(`${before.name} is marked ${p.projectStatus}.`);
}

async function peopleMarkSubmitted(tx: Executor, actor: ActorContext, p: { people: { email?: string; name?: string; projectUrl?: string }[] }) {
  const all = await tx.select().from(s.person).where(eq(s.person.orgId, actor.orgId));
  const byEmail = new Map(all.map((x) => [x.email.toLowerCase(), x]));
  const byName = new Map<string, typeof all>();
  for (const person of all) {
    const key = normName(person.name);
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();
  let updated = 0;
  const now = new Date();
  for (const entry of p.people) {
    let person = entry.email ? byEmail.get(entry.email.toLowerCase()) : undefined;
    if (!person && entry.name) {
      const hits = byName.get(normName(entry.name)) ?? [];
      if (hits.length > 1) { ambiguous.push(entry.name); continue; }
      person = hits[0];
    }
    const label = entry.email ?? entry.name ?? "row";
    if (!person) { unmatched.push(label); continue; }
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    const url = entry.projectUrl?.trim() || person.projectUrl;
    await tx.update(s.person).set({ projectStatus: "submitted", projectUrl: url, projectSource: "organizer", projectUpdatedAt: now }).where(eq(s.person.id, person.id));
    await recordDecision(tx, {
      orgId: actor.orgId, objectType: "person", objectId: person.id, personId: person.id, personName: person.name, action: "people.markSubmitted",
      summary: `${actor.name} marked ${person.name} as project submitted${url ? ` (${url})` : ""}.`,
      actor, status: "done", tool: "importPeople", facts: { projectStatus: "submitted", projectUrl: url, projectSource: "organizer", before: person.projectStatus },
    });
    updated++;
  }
  const bits = [`Marked ${updated} ${updated === 1 ? "person" : "people"} as submitted.`];
  if (unmatched.length) bits.push(`Not found: ${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? "…" : ""}.`);
  if (ambiguous.length) bits.push(`Ambiguous names skipped: ${ambiguous.slice(0, 8).join(", ")}.`);
  return ok(bits.join(" "), { updated, unmatched, ambiguous });
}

async function personUpdate(tx: Executor, actor: ActorContext, p: { id: string } & Partial<PersonInput>) {
  assertSelfOrStaff(actor, p.id);
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const before = await lockPayee(tx, actor.orgId, p.id);
  const set: Partial<typeof s.person.$inferInsert> = {};
  for (const k of ["name", "country", "citizenship", "dateOfBirth", "address", "role", "payoutCurrency"] as const) if (p[k] !== undefined) (set as Record<string, unknown>)[k] = p[k];
  if (actor.role === "attendee") delete set.role;
  if (set.dateOfBirth) set.adult = isAdultAt(set.dateOfBirth, event.startsAt);
  if (Object.keys(set).length === 0) throw invalid("Nothing to update.");
  const [after] = await tx.update(s.person).set(set).where(eq(s.person.id, p.id)).returning();
  const stale = await staleProfileAfterChange(tx, actor, before, after);
  await recordDecision(tx, { orgId: actor.orgId, objectType: "person", objectId: p.id, personId: p.id, action: "person.update", summary: `Profile updated: ${Object.keys(set).join(", ")}.${stale.length ? ` The signed tax form no longer matches (${stale.join(", ")}); a new form is required before payment.` : ""}`, actor, status: set.adult === false || stale.length ? "escalated" : "done", tool: "profile" });
  return ok(stale.length ? "Profile updated. Please sign a new tax form; payments are held until then." : "Profile updated.");
}

// --------------------------------------------------------------------- tax

async function taxSubmit(tx: Executor, actor: ActorContext, p: { personId: string; form: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration"; signature: string; tin?: string; ftinNotRequired?: boolean; treatyCountry?: string; treatyArticle?: string }) {
  assertSelfOrStaff(actor, p.personId);
  if (p.ftinNotRequired && p.form !== "W-8BEN") throw invalid("Only a W-8BEN records that a foreign tax ID is not legally required.");
  if (p.ftinNotRequired && p.tin) throw invalid("Enter a foreign tax ID or say one is not legally required, not both.");
  const person = await lockPayee(tx, actor.orgId, p.personId);
  if (!person.adult) throw conflict("Eve cannot onboard anyone under 18 at the event start date.");
  const { org } = await loadOrgEvent(tx, actor.orgId);
  const now = new Date();
  const problems: string[] = [];
  if (normName(p.signature) !== normName(person.name)) problems.push("Signature does not match the legal name on the profile.");
  const usPerson = isUsPerson(person);
  const accepted = acceptedForms(org.country, person);
  if (p.form === "W-9" && !usPerson) problems.push("A W-9 was submitted by someone with a non-US address and citizenship; a W-8BEN is expected.");
  else if (p.form.startsWith("W-8") && usPerson) problems.push("A US person must submit a W-9, not a W-8.");
  else if (!accepted.includes(p.form)) problems.push(`A ${p.form} is not accepted by a ${org.country} payer for this person; ${accepted.join(" or ")} is expected.`);
  if (p.form === "W-9" && !p.tin) problems.push("No TIN provided; backup withholding may apply.");
  const blocking = problems.filter((x) => !x.startsWith("No TIN"));
  const status = blocking.length ? "review" : "valid";
  const expiresAt = p.form.startsWith("W-8") ? new Date(`${w8ExpiresAt(now.toISOString())}T23:59:59Z`) : null;
  const tin = p.tin ? await vaultTin(tx, actor.orgId, person.id, p.tin) : null;
  await tx.update(s.taxProfile).set({ supersededAt: now }).where(and(eq(s.taxProfile.personId, person.id), sql`${s.taxProfile.supersededAt} IS NULL`));
  const profileId = newId("tax");
  const treatyCountry = p.treatyCountry ?? (p.treatyArticle ? person.country : undefined);
  // Line 10's rate comes from the rules table (exact treaty country only); the claim stays unverified unless the rule is.
  const treatyRule = p.form === "W-8BEN" && p.treatyArticle && treatyCountry
    ? selectRule(await loadRules(tx), { payerCountry: org.country, payeeCountry: treatyCountry, paymentType: "cash_prize:treaty", year: now.getUTCFullYear() })
    : undefined;
  const rule = treatyRule?.payeeCountry === treatyCountry ? treatyRule : undefined;
  const signedVia = actor.personId === person.id ? `Eve portal, signed in as ${actor.name} (${actor.role})` : `Eve, submitted by ${actor.name} (${actor.role}) for ${person.name}`;
  // Only the vault's last 4 ever reach a renderer; the full TIN is never printed.
  const pdf = p.form === "W-8BEN"
    ? await renderW8ben({
      referenceNumber: profileId, legalName: person.name, citizenship: person.citizenship, residenceCountry: person.country, address: person.address,
      dateOfBirth: person.dateOfBirth, ftinLast4: tin?.last4, ftinNotRequired: p.ftinNotRequired, treatyCountry,
      treatyClaim: p.treatyArticle ? { article: p.treatyArticle, rateBps: rule?.rateBps, verified: rule?.verified ?? false } : undefined,
      signedName: p.signature, signedAt: now.toISOString(), signedVia, expiresAt: expiresAt?.toISOString(),
    })
    : await renderTaxFormReceipt({
      documentId: profileId, formType: p.form, legalName: person.name, citizenship: person.citizenship, residenceCountry: person.country,
      address: person.address, dateOfBirth: person.dateOfBirth, tinLast4: tin?.last4, signedName: p.signature, signedAt: now.toISOString(), signedVia,
      expiresAt: expiresAt?.toISOString(), treaty: p.treatyArticle ? { country: treatyCountry ?? person.country, article: p.treatyArticle, rate: "per rules table", verified: false } : undefined,
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
    facts: {
      form: p.form, expected: expectedForm(person, org.country), tinLast4: tin?.last4 ?? null, problems,
      ...(p.form === "W-8BEN" ? { document: `IRS Form W-8BEN (${W8BEN_REVISION}), filled, with signature record`, ftinNotRequired: Boolean(p.ftinNotRequired), treatyRule: rule ? `${rule.id} v${rule.version}` : null } : {}),
    },
  });
  return ok(status === "valid" ? `${p.form} saved.` : `${p.form} saved for review: ${blocking.join(" ")}`, { status, documentId: doc.id });
}

// ------------------------------------------------------------------ awards

async function awardCreate(tx: Executor, actor: ActorContext, p: { personId?: string; teamPersonIds?: string[]; track: string; title: string; kind: "cash" | "item"; amountMinor: bigint; currency?: string; dueAt?: string }) {
  const { org, event } = await loadOrgEvent(tx, actor.orgId);
  // Prizes are entered in the org's currency (or USD); payouts convert to the USD books at the payment date.
  const currency = p.currency ?? org.currency;
  if (currency !== org.currency && currency !== BOOKS_CURRENCY) throw invalid(`Enter prizes in ${org.currency}${org.currency !== BOOKS_CURRENCY ? " or USD" : ""}; Eve converts the payout to the winner's currency.`);
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
    const valid = profileValidFor(profile, person, org.country, now);
    const draft = { id: newId("awd"), orgId: actor.orgId, eventId: event.id, personId: person.id, track: p.track, title: p.title, kind: p.kind, amountMinor: BigInt(part.amountMinor), currency, dueAt: p.dueAt ? new Date(p.dueAt) : event.closingAt, requestedBy: actor.memberId, teamId, splitBps: Math.round(10000 / parts.length), splitConfirmed: !teamId };
    const rec = await fulfillmentFor(tx, draft, person, profile, now);
    const [row] = await tx.insert(s.award).values({ ...draft, status: valid ? "ready" : "needs_form", fulfillment: p.kind === "cash" ? "cash" : "undecided", recommendation: rec.recommendation, shippingMinor: BigInt(rec.shippingMinor), localMinor: BigInt(rec.localMinor) }).returning();
    created.push(row);
    const nudges = [!valid ? `${person.name} needs a valid ${expectedForm(person, org.country)} before payment.` : "", p.kind === "item" && person.country !== "US" ? "Item prize to a non-US winner: withholding cannot come out of an item; consider cash." : ""].filter(Boolean);
    await recordDecision(tx, {
      orgId: actor.orgId, objectType: "award", objectId: row.id, personId: person.id, personName: person.name, action: "award.create",
      summary: `${p.title} (${p.track}) for ${person.name}, ${money(row.amountMinor, row.currency)}. ${rec.recommendation} ${nudges.join(" ")}`.trim(),
      actor, status: nudges.length ? "escalated" : "done", tool: "recommendFulfillment", facts: { recommendation: rec, nudges },
    });
    if (!valid) await recordNotice(tx, { orgId: actor.orgId, personId: person.id, channel: `email ${maskEmail(person.email)}`, title: `You won ${p.title}`, body: `Congratulations! To receive your prize, complete your ${expectedForm(person, org.country)} in the Eve portal.` });
  }
  return ok(`Created ${created.length} award(s).`, { ids: created.map((a) => a.id), teamId });
}

/**
 * Fulfillment recommendation. Cash prizes need no estimate. Item estimates are
 * USD-only in the engine, so a non-USD item value is converted to USD for the
 * estimate and the shipping and local-purchase estimates are converted back.
 */
async function fulfillmentFor(tx: Executor, draft: { kind: "cash" | "item"; amountMinor: bigint; currency: string } & Omit<typeof s.award.$inferInsert, "kind" | "amountMinor" | "currency">, person: typeof s.person.$inferSelect, profile: Awaited<ReturnType<typeof currentProfile>>, now: Date) {
  if (draft.kind === "cash") return { recommendation: "Cash award: pay out after the tax form and withholding.", shippingMinor: "0", localMinor: "0" };
  const fx = await toUsd(tx, draft.amountMinor, draft.currency, now);
  const base = { ...draft, id: draft.id!, eventId: draft.eventId, orgId: draft.orgId, personId: draft.personId, track: draft.track, title: draft.title, dueAt: draft.dueAt, requestedBy: draft.requestedBy, teamId: draft.teamId ?? null, splitBps: draft.splitBps ?? 10000, splitConfirmed: draft.splitConfirmed ?? true };
  const rec = recommendFulfillment(toAward({ ...base, amountMinor: fx.usdMinor, currency: "USD", fulfillment: "undecided", status: "draft", recommendation: "", shippingMinor: 0n, localMinor: 0n, createdAt: now }, person.name), toPerson(person, { profile, paidYtdMinor: 0n, outstandingMinor: 0n, now }));
  if (draft.currency === "USD") return rec;
  const back = async (v: string) => (await fromUsd(tx, BigInt(v), draft.currency, now)).minor.toString();
  return { ...rec, shippingMinor: await back(rec.shippingMinor), localMinor: await back(rec.localMinor), recommendation: `${rec.recommendation} (Estimated in USD at ${fx.fxRate}, ${fx.fxSource}; shown in ${draft.currency}.)` };
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
  const fx = await toUsd(tx, a.amountMinor, a.currency, new Date());
  const fmv = fx.usdMinor; // USD books
  const { tax, ytdMinor } = taxFor(ctx, "item_prize", fmv, { override: await liveOverride(tx, "award", a.id), originalMinor: a.amountMinor, originalCurrency: a.currency });
  if (tax.hold) throw conflict(`Fulfillment held: ${tax.reason} The item's fair market value is reportable income, so it needs the same tax checks as cash.`);
  // Tax cannot come out of an item: the org pays it on top (gross-up) and the grossed-up amount is the income.
  const up = tax.rateBps > 0 ? (tax.grossUp ?? grossUp(fmv, tax.rateBps)) : null;
  const grossMinor = up ? BigInt(up.grossMinor) : fmv;
  const withholdingMinor = up ? BigInt(up.withholdingMinor) : 0n;
  if (grossMinor - withholdingMinor !== fmv) throw conflict("Gross-up did not reconcile to the item's value; held for review.");
  // Reportability is judged on the income actually reported (FMV plus any tax paid on the winner's behalf).
  const year = ctx.now.getUTCFullYear(); // payment year, as in taxFor
  const appliedRule = ctx.rules.find((r) => r.id === tax.ruleId && r.version === tax.ruleVersion);
  const reported = computeTax({ payerCountry: ctx.org.country, payeeCountry: taxPayeeCountry(ctx.org.country, ctx.person), paymentType: "item_prize", grossMinor: grossMinor.toString(), hasValidForm: true, hasTin: Boolean(ctx.profile?.tinLast4), year, ytdMinor, rules: ctx.rules, treatyClaim: Boolean(ctx.profile?.treatyArticle), rule: appliedRule });
  assertFits(await prizeBudgetRoom(tx, a.eventId), grossMinor, "Fulfilling");
  const now = new Date();
  const id = newId("pay");
  const method = a.fulfillment === "ship" ? "shipped" : "bought locally";
  const [row] = await tx.insert(s.payout).values({
    id, orgId: actor.orgId, personId: a.personId, sourceType: "award", awardId: a.id, claimId: null,
    grossMinor, withholdingMinor, feeMinor: 0n, netMinor: 0n, currency: "USD", destinationCurrency: "USD", destinationNetMinor: 0n, fxRate: "1",
    provider: IN_KIND_PROVIDER, truth: "Simulated", status: "paid",
    reason: `In-kind prize: ${a.title} ${method}. Fair market value ${usd(fmv)}${withholdingMinor > 0n ? ` plus ${usd(withholdingMinor)} tax the org pays on top` : ""} is reportable income.`,
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion, ruleVerified: tax.ruleVerified, reportingForm: reported.reportingForm, reportable: reported.reportable,
    requestedBy: a.requestedBy, releasedBy: actor.memberId, idempotencyKey: `inkind:${a.id}`, providerRef: `inkind_sim_${a.id.slice(-12)}`,
    attempts: 1, dueAt: a.dueAt, paidAt: now,
  }).returning();
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "payout", objectId: id, requestedBy: a.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: `Physical prize ${method}` });
  const lines: JournalLineInput[] = [
    { account: "5100", debitMinor: grossMinor, currency: "USD", personId: a.personId, memo: `In-kind prize ${a.title} (FMV ${usd(fmv)}${withholdingMinor > 0n ? " + tax on top" : ""})` },
    { account: "1000", creditMinor: fmv, currency: "USD", memo: `Item ${method}` },
  ];
  if (withholdingMinor > 0n) lines.push({ account: "2100", creditMinor: withholdingMinor, currency: "USD", personId: a.personId, memo: `Withholding paid by the org on a grossed-up prize (${tax.ruleId} v${tax.ruleVersion})` });
  await postJournal(tx, { orgId: actor.orgId, memo: `Fulfill item prize ${a.id}`, sourceType: "payout", sourceId: id, idempotencyKey: `inkind:${a.id}`, createdBy: actor.memberId, lines });
  await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, a.id));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "award", objectId: a.id, personId: a.personId, personName: ctx.person.name, action: "award.fulfill",
    summary: `${a.title} ${method} for ${ctx.person.name}. Reportable income ${usd(grossMinor)} on ${reported.reportingForm}${withholdingMinor > 0n ? `, including ${usd(withholdingMinor)} withholding the org pays on top` : ""}${reported.reportable ? "" : " (below the threshold so far)"}.`,
    actor, status: "done", tool: "fulfillPrize", ruleId: tax.ruleId, ruleVersion: tax.ruleVersion,
    facts: { truth: "Simulated", fmvMinor: fmv.toString(), grossMinor: grossMinor.toString(), withholdingMinor: withholdingMinor.toString(), ytdMinor, reportingForm: reported.reportingForm, reportable: reported.reportable, payoutId: id, method },
  });
  await recordNotice(tx, { orgId: actor.orgId, personId: a.personId, channel: "portal", title: `${a.title}: fulfillment recorded`, body: `Your prize was marked ${method}. Its fair market value (${usd(fmv)}) is reportable prize income.` });
  await requoteSiblings(tx, actor.orgId, a.personId, `in-kind prize ${a.title} became final`, id, actor);
  return ok(`${a.title} marked ${method}.`, { awardId: a.id, payoutId: row.id, fmvMinor: fmv.toString(), grossMinor: grossMinor.toString(), withholdingMinor: withholdingMinor.toString(), reportingForm: reported.reportingForm, reportable: reported.reportable, truth: "Simulated" });
}

// ---------------------------------------------------------------- payouts

/**
 * payout.resolveRule (controller). Resolves a hold caused only by an
 * unverified tax rule, for one source: apply the verified default rule, or
 * accept the unverified rule as stated. The rule table is never changed; the
 * resolution is stored per source and lapses if the form, amount, payment type
 * or rule version changes. It never clears form, minor, bank or budget holds,
 * and the payout still needs its own controller release afterwards.
 */
async function resolveRule(tx: Executor, actor: ActorContext, p: { sourceType: "claim" | "award"; sourceId: string; use: "default" | "rule"; reason: string }) {
  if (actor.role !== "controller") throw forbidden("Only a controller can resolve an unverified tax rule.");
  const table = p.sourceType === "claim" ? s.claim : s.award;
  const [peek] = await tx.select({ personId: table.personId }).from(table).where(and(eq(table.id, p.sourceId), eq(table.orgId, actor.orgId)));
  if (!peek) throw notFound(p.sourceType === "claim" ? "Claim not found." : "Award not found.");
  const person = await lockPayee(tx, actor.orgId, peek.personId);
  assertNotBeneficiary(actor, person, "resolve a tax hold on");
  const loaded = await loadSource(tx, actor.orgId, p);
  const requestedBy = loaded.award?.requestedBy ?? loaded.claim!.requestedBy;
  if (requestedBy === actor.memberId) throw forbidden("You requested this payment, so another controller must resolve its tax hold.");
  const ctx = await loadPayoutContext(tx, actor.orgId, person.id);
  const { tax } = taxFor(ctx, loaded.source.paymentType, loaded.source.grossMinor);
  if (!profileValidFor(ctx.profile, person, ctx.org.country, ctx.now)) throw conflict(`Held for a missing or invalid ${expectedForm(person, ctx.org.country)}. A controller cannot override a missing form; the recipient must submit one.`);
  if (tax.ruleId === "none") throw conflict(`No tax rule covers this payment (${tax.reason}). Add or verify a rule first.`);
  if (!tax.hold || tax.ruleVerified) throw conflict("Nothing to resolve: this payment is not held by an unverified rule.");
  let applied = { id: tax.ruleId, version: tax.ruleVersion };
  if (p.use === "default") {
    const year = ctx.now.getUTCFullYear();
    const def = selectRule(ctx.rules, { payerCountry: ctx.org.country, payeeCountry: taxPayeeCountry(ctx.org.country, person), paymentType: loaded.source.paymentType, year });
    if (!def?.verified || def.id === tax.ruleId) throw conflict(`No verified default rule exists for this payment; ${tax.ruleId} is the only rule. Accept it with a reason, or keep the hold.`);
    applied = { id: def.id, version: def.version };
  }
  const now = new Date();
  await tx.update(s.taxRuleOverride).set({ revokedAt: now }).where(and(eq(s.taxRuleOverride.sourceType, p.sourceType), eq(s.taxRuleOverride.sourceId, p.sourceId), sql`${s.taxRuleOverride.revokedAt} IS NULL`));
  const id = newId("rov");
  await tx.insert(s.taxRuleOverride).values({
    id, orgId: actor.orgId, sourceType: p.sourceType, sourceId: p.sourceId, personId: person.id, taxProfileId: ctx.profile!.id,
    paymentType: loaded.source.paymentType, amountMinor: loaded.source.originalMinor ?? loaded.source.grossMinor, currency: loaded.source.originalCurrency ?? BOOKS_CURRENCY,
    ruleId: tax.ruleId, ruleVersion: tax.ruleVersion, decision: p.use, appliedRuleId: applied.id, appliedRuleVersion: applied.version, reason: p.reason, approvedBy: actor.memberId,
  });
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "tax_rule_override", objectId: id, requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: p.reason });
  const [live] = await tx.select().from(s.payout).where(and(p.sourceType === "claim" ? eq(s.payout.claimId, p.sourceId) : eq(s.payout.awardId, p.sourceId), inArray(s.payout.status, ["held", "proposed", "approved", "frozen"]))).for("update");
  const after = live ? await requote(tx, live, ctx, `controller resolved unverified rule ${tax.ruleId}`, actor) : undefined;
  const summary = p.use === "default"
    ? `Applied verified default ${applied.id} v${applied.version} instead of unverified ${tax.ruleId} v${tax.ruleVersion}: ${p.reason}`
    : `Accepted unverified ${tax.ruleId} v${tax.ruleVersion} for this payment only (the rule stays unverified): ${p.reason}`;
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: p.sourceType, objectId: p.sourceId, personId: person.id, personName: person.name, action: "payout.resolveRule",
    summary: `${summary}${after ? ` Payout is now ${after.status}; it still needs a separate controller release.` : ""}`, actor, status: "done", tool: "resolveRule",
    ruleId: applied.id, ruleVersion: applied.version,
    facts: { overrideId: id, use: p.use, heldRule: { id: tax.ruleId, version: tax.ruleVersion, verified: false }, applied, taxProfileId: ctx.profile!.id, amountMinor: String(loaded.source.originalMinor ?? loaded.source.grossMinor), payoutId: after?.id ?? null },
  });
  return ok(`${summary}${after ? ` Payout ${after.status}; release it separately.` : ""}`, { overrideId: id, payoutId: after?.id ?? null, status: after?.status ?? null, ruleId: after?.ruleId ?? applied.id, ruleVersion: after?.ruleVersion ?? applied.version, ruleVerified: after?.ruleVerified ?? p.use === "default", withholdingMinor: after?.withholdingMinor.toString() ?? null });
}

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
// The sponsor sends gross less withholding with no Eve provider fee, so the
// payout's destination amount is always that USD figure converted at the
// payout's locked quote rate (an estimate; no new quote is invented). An
// accepted shortfall records what the payee actually received: net is the
// remitted amount, the fee is the shortfall, and the destination follows.

/** Destination amount for a USD sponsor amount at the payout's locked quote rate. */
function sponsorDestination(payout: Pick<typeof s.payout.$inferSelect, "currency" | "destinationCurrency" | "fxRate">, usdMinor: bigint) {
  return convertFx(usdMinor, payout.currency, payout.destinationCurrency, payout.fxRate);
}

/** Discloses the locked rate when the payee is paid in another currency. */
function sponsorFxNote(payout: Pick<typeof s.payout.$inferSelect, "currency" | "destinationCurrency" | "fxRate">, usdMinor: bigint) {
  if (payout.destinationCurrency === payout.currency) return "";
  return ` About ${money(sponsorDestination(payout, usdMinor), payout.destinationCurrency)} at the payout's quoted rate, 1 ${payout.currency} = ${payout.fxRate} ${payout.destinationCurrency} (estimate; the sponsor's rate may differ).`;
}

export async function sponsorCreate(tx: Executor, actor: ActorContext, p: { payoutId: string }, batchId?: string) {
  await lockOrgFinance(tx, actor.orgId);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  if (org.mode === "direct") throw conflict("This organization pays directly. Switch to sponsor or hybrid mode in Settings to use sponsor packets.");
  const [peek] = await tx.select({ personId: s.payout.personId }).from(s.payout).where(and(eq(s.payout.id, p.payoutId), eq(s.payout.orgId, actor.orgId)));
  if (!peek) throw notFound("Payout not found.");
  const person = await loadPerson(tx, actor.orgId, peek.personId, true);
  assertNotBeneficiary(actor, person, "request");
  const [payout] = await tx.select().from(s.payout).where(eq(s.payout.id, p.payoutId)).for("update");
  await assertNotInBatch(tx, payout.id, batchId);
  if (payout.status !== "proposed" && payout.status !== "approved") throw conflict(`Payout is ${payout.status}; only a proposed payout can go to the sponsor.`);
  if (payout.provider === IN_KIND_PROVIDER) throw conflict("In-kind prizes are not paid in cash.");
  const [existing] = await tx.select({ id: s.sponsorPacket.id, status: s.sponsorPacket.status }).from(s.sponsorPacket).where(eq(s.sponsorPacket.payoutId, payout.id));
  if (existing) throw new ActionError(409, `Sponsor packet ${existing.id} already exists for this payout (${existing.status}).`, { packetId: existing.id });
  const profile = await currentProfile(tx, person.id);
  if (payout.sourceType === "award" && !profileValidFor(profile, person, org.country, new Date())) throw conflict("The payee's tax form is missing or invalid; the sponsor packet would be incomplete.");
  const methods = await methodsFor(tx, person.id);
  if (methods.pending) throw conflict("Bank details are pending verification; the packet cannot carry payout instructions yet.");
  const id = newId("sp");
  const requested = payout.grossMinor - payout.withholdingMinor;
  const pdf = await renderSponsorDocument(id, org, person, payout, profile, methods.active);
  const doc = await storeDocument(tx, { orgId: actor.orgId, personId: person.id, uploadedBy: actor.memberId, kind: "sponsor_packet", name: `${id}.pdf`, mimeType: "application/pdf", bytes: pdf });
  await tx.insert(s.sponsorPacket).values({ id, orgId: actor.orgId, payoutId: payout.id, requestedMinor: requested, status: "draft", feesPaidBy: org.feesPaidBy, dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000), documentId: doc.id });
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
export async function sponsorSubmit(tx: Executor, actor: ActorContext, p: { id: string }, batchId?: string, checks?: { expectTerms: string; releaseRules: TaxRule[] }) {
  if (actor.role !== "controller") throw forbidden("Submitting a packet releases money through the sponsor, so only a controller can do it.");
  const { pk, payout: pk0 } = await loadPacket(tx, actor, p.id);
  if (pk.status !== "draft" && pk.status !== "questioned") throw conflict(`Packet is ${pk.status}.`);
  const [portal] = await tx.select({ id: s.portalRun.id }).from(s.portalRun)
    .where(and(eq(s.portalRun.packetId, pk.id), inArray(s.portalRun.status, [...s.PORTAL_RUN_ACTIVE])));
  if (portal) throw conflict("Eve is entering this packet on the sponsor portal. Approve or stop that run instead, so the packet is not submitted twice.");
  const { org: orgNow } = await loadOrgEvent(tx, actor.orgId);
  if ((pk.feesPaidBy ?? "org") !== orgNow.feesPaidBy) {
    // The fee bearer is part of the authorized terms: a policy change after drafting needs a new packet.
    await tx.delete(s.sponsorPacket).where(eq(s.sponsorPacket.id, pk.id));
    await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: pk0.personId, action: "sponsor.withdraw", summary: `Packet withdrawn: fee policy changed from ${pk.feesPaidBy ?? "org"} to ${orgNow.feesPaidBy} after it was drafted. Draft a new packet.`, actor, status: "escalated", tool: "sponsorPacket" });
    return { ok: false, message: `Not submitted: the fee policy changed after this packet was drafted, so it was withdrawn. Draft a new packet with the current terms.`, data: { withdrawn: pk.id } };
  }
  const check = await prepareRelease(tx, actor, pk.payoutId, "sponsor", { batchId, ...checks });
  if (check.kind === "requoted") {
    return { ok: false, message: `Not submitted: the payout was re-quoted (${check.payout.reason}). Draft a new packet for the new terms.`, data: { payoutId: check.payout.id } };
  }
  const payout = check.p;
  if (pk.requestedMinor !== payout.grossMinor - payout.withholdingMinor) throw conflict("The packet no longer matches the payout's terms; draft a new packet.");
  const org = orgNow;
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "payout", objectId: payout.id, requestedBy: payout.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: "approved", reason: `Submitted to sponsor in packet ${pk.id}`, bankVersion: payout.bankVersion });
  const [sent] = await tx.update(s.payout).set({ status: "processing", provider: SPONSOR_PROVIDER, truth: "Simulated", releasedBy: actor.memberId, providerRef: pk.id, attempts: payout.attempts + 1, feeMinor: 0n, netMinor: pk.requestedMinor, destinationNetMinor: sponsorDestination(payout, pk.requestedMinor), reason: `Submitted to ${org.sponsorName || "the fiscal sponsor"} in packet ${pk.id}; awaiting remittance.${sponsorFxNote(payout, pk.requestedMinor)}` })
    .where(and(eq(s.payout.id, payout.id), inArray(s.payout.status, ["proposed", "approved"]))).returning();
  if (!sent) throw conflict("Payout changed while submitting; try again.");
  await postAccrual(tx, sent, actor.memberId, await payoutCategory(tx, sent));
  await tx.update(s.sponsorPacket).set({ status: "submitted", submittedAt: new Date(), dueAt: new Date(Date.now() + org.sponsorTurnaroundDays * 86_400_000) }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: payout.personId, action: "sponsor.submit", summary: `Submitted ${usd(pk.requestedMinor)} to ${org.sponsorName || "the sponsor"}; expected within ${org.sponsorTurnaroundDays} days. Expense and withholding accrued.`, actor, status: "waiting", tool: "sponsorPacket", facts: { payoutId: payout.id, requestedMinor: pk.requestedMinor.toString() } });
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
  // The fee bearer authorized with the packet governs; a later org policy change does not rewrite it.
  const feesPaidBy = pk.feesPaidBy ?? "org";
  const facts = { requestedMinor: pk.requestedMinor.toString(), paidMinor: paid.toString(), payoutId: payout.id, feesPaidBy, orgPolicyNow: org.feesPaidBy };
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
    if (feesPaidBy === "org") {
      throw conflict(`This packet was authorized with the org bearing transfer fees, so the ${usd(short)} shortfall is still owed to the payee. Ask the sponsor to send the difference, then reconcile with the full amount.`);
    }
    reason = `Accepted: sponsor sent ${usd(pk.requestedMinor)} and the payee received ${usd(paid)}; ${usd(short)} was deducted in transit, which the recipient bears under the fee terms authorized with this packet. ${p.note}`;
  }
  const settled = pk.requestedMinor;
  if (settled > 0n) {
    await postJournal(tx, {
      orgId: actor.orgId, memo: `Sponsor paid packet ${pk.id}`, sourceType: "packet", sourceId: pk.id, idempotencyKey: `sponsor-pay:${pk.id}`, createdBy: actor.memberId,
      lines: [
        { account: "2000", debitMinor: settled, currency: "USD", personId: payout.personId, memo: "Payable settled by the sponsor" },
        { account: "1100", creditMinor: settled, currency: "USD", memo: `${org.sponsorName || "Sponsor"} disbursement` },
      ],
    });
  }
  const now = new Date();
  // Net is what the payee received; an accepted shortfall is the recipient-borne fee (AP still settles in full above).
  await tx.update(s.payout).set({ status: "paid", paidAt: now, netMinor: paid, feeMinor: short, destinationNetMinor: sponsorDestination(payout, paid), reason: `${reason}${sponsorFxNote(payout, paid)}` }).where(eq(s.payout.id, payout.id));
  if (payout.claimId) await tx.update(s.claim).set({ status: "paid" }).where(eq(s.claim.id, payout.claimId));
  if (payout.awardId) await tx.update(s.award).set({ status: "paid" }).where(eq(s.award.id, payout.awardId));
  await tx.update(s.sponsorPacket).set({ status: "paid", paidMinor: paid, reason }).where(eq(s.sponsorPacket.id, pk.id));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "packet", objectId: pk.id, personId: payout.personId, action: "sponsor.reconcile", summary: reason, actor, status: "done", tool: "reconcile", facts });
  return ok(reason, { status: "paid" });
}

// ---------------------------------------------------------------- filings

// ------------------------------------------------------------- agent/demo

/** Sanitized context for chase messages: no TINs, bank numbers or addresses. */
export async function missingFormContext(db: Executor, orgId: string) {
  const rows = await db.select({ person: s.person, award: s.award }).from(s.award).innerJoin(s.person, eq(s.person.id, s.award.personId))
    .where(and(eq(s.award.orgId, orgId), eq(s.award.status, "needs_form")));
  const now = new Date();
  const { org } = await loadOrgEvent(db, orgId);
  const out = [];
  for (const { person, award } of rows) {
    const profile = await currentProfile(db, person.id);
    out.push({ personId: person.id, name: person.name, emailMasked: maskEmail(person.email), country: person.country, form: expectedForm(person, org.country), taxStatus: effectiveTaxStatus(profile, now), awardId: award.id, awardTitle: award.title, amountMinor: award.amountMinor.toString(), chaseCount: person.chaseCount, lastChasedAt: person.lastChasedAt?.toISOString() ?? null });
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
  const evt = toEvent(event);
  // Simulated fares timed to this event's check-in and closing, into the venue's city.
  const destination = destinationFor(evt.venue);
  const offers = fixtureOffers(p.origin, evt);
  const result = suggestFlights(offers, evt);
  const key = offerKey();
  // The token binds the server's price, itinerary and this event; flight.request trusts only the token or the fixture table regenerated for the same event.
  const options = key ? signOffers(result.options, key, Date.now(), evt) : result.options;
  const note = destination.recognized ? "" : ` The venue names no city Eve has fares for, so these fares go to ${destination.airport}.`;
  const message = !offers.length
    ? p.origin.toUpperCase() === destination.airport ? `${destination.airport} is the event's own airport; no flight needed.` : `Eve has no fares from ${p.origin.toUpperCase()}. Try ${fixtureOrigins().join(", ")}, or submit your own booking as a travel claim.`
    : result.options.length ? `${result.options.length} option(s) under policy.` : result.reason;
  return ok(`${message}${note}`, { offers: options, rejected: result.rejected, truth: result.truth, destination: destination.airport, destinationRecognized: destination.recognized });
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

const portalRouteOnly: Handler = async () => {
  throw new ActionError(400, "Portal runs are started from POST /api/actions, outside a database transaction.");
};

const handlers: Record<AppAction, Handler> = {
  "org.update": orgUpdate as Handler,
  "event.update": eventUpdate as Handler,
  "budget.update": budgetUpdate as Handler,
  "people.import": peopleImport as Handler,
  "people.markSubmitted": peopleMarkSubmitted as Handler,
  "person.update": personUpdate as Handler,
  "person.setProject": personSetProject as Handler,
  "tax.submit": taxSubmit as Handler,
  "claim.submit": (async (tx, actor, p, prepared) => {
    const { claim, replayed } = await submitClaim(tx, actor, p, prepared as ClaimEvidence);
    return ok(replayed ? "Claim already submitted." : claim.status === "approved" ? "Claim approved and queued for payout." : `Claim ${claim.status}: ${claim.reason}`, { claimId: claim.id, status: claim.status });
  }) as Handler,
  "claim.review": (async (tx, actor, p) => ok("Claim reviewed.", await reviewClaim(tx, actor, p))) as Handler,
  "claim.explain": (async (tx, actor, p) => ok("Thanks. Your answer went to the organizers with your claim.", await explainClaim(tx, actor, p))) as Handler,
  "award.create": awardCreate as Handler,
  "award.choose": awardChoose as Handler,
  "award.split": awardSplit as Handler,
  "award.confirm": awardConfirm as Handler,
  "award.fulfill": awardFulfill as Handler,
  "payout.resolveRule": resolveRule as Handler,
  "payout.propose": (async (tx, actor, p) => {
    const row = await proposePayout(tx, actor, p);
    return ok(row.status === "proposed" ? "Payout proposed for controller release." : `Payout ${row.status}: ${row.reason}`, { payoutId: row.id, status: row.status });
  }) as Handler,
  "payout.release": payoutRelease as Handler,
  "payout.bankChange": (async (tx, actor, p) => {
    assertSelfOrStaff(actor, p.personId);
    const r = await changeBankDetails(tx, actor, p);
    if (r.enrolled) return ok(`Payout account ••${p.last4} added. ${r.requoted} unpaid payout(s) re-quoted; each still needs a controller release.`, r);
    return ok(`Bank change recorded. ${r.frozen.length} payout(s) frozen; verification requested through ${r.sentTo} (delivery pending).`, r);
  }) as Handler,
  "payout.verify": (async (tx, actor, p) => {
    const r = await verifyBankChange(tx, actor, p);
    return { ok: r.ok, message: r.message, data: r.ok ? { payouts: r.payouts } : undefined };
  }) as Handler,
  "payout.retry": (async (tx, actor, p) => {
    const row = await retryPayout(tx, actor, p.id);
    return ok(row.status === "proposed" ? "Re-quoted for a fresh controller release." : `Re-quoted; now ${row.status}: ${row.reason}`, { payoutId: row.id, status: row.status });
  }) as Handler,
  "sponsor.create": sponsorCreate as Handler,
  "sponsor.submit": sponsorSubmit as Handler,
  "sponsor.reconcile": reconcilePacket as Handler,
  // Started, resumed and stopped by the actions route (lib/computer-use/portal-run.ts), never inside a transaction.
  "sponsor.batchRelease": portalRouteOnly,
  "sponsor.batchRetry": portalRouteOnly,
  "sponsor.batchCancel": portalRouteOnly,
  "sponsor.portalStart": portalRouteOnly,
  "sponsor.portalDecide": portalRouteOnly,
  "sponsor.portalStop": portalRouteOnly,
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
  "slack.settings": (async (tx, actor, p) => (await import("@/lib/slack/install")).updateSlackSettings(tx, actor, p)) as Handler,
  "slack.linkCode": (async (tx, actor) => {
    const { code, expiresAt } = await (await import("@/lib/slack/identity")).issueLinkCode(tx, actor);
    return ok(`Type /eve link ${code} in Slack within 10 minutes.`, { code, expiresAt: expiresAt.toISOString() });
  }) as Handler,
  "slack.unlink": (async (tx, actor) => ok((await (await import("@/lib/slack/identity")).unlinkMember(tx, actor)) ? "Slack account unlinked." : "No Slack account was linked.")) as Handler,
  "slack.disconnect": (async (tx, actor) => {
    const { disconnectSlack } = await import("@/lib/slack/install");
    const { result, token } = await disconnectSlack(tx, actor);
    if (token) await (await import("@/lib/slack/api")).slackApi(token, "auth.revoke").catch(() => {});
    return result;
  }) as Handler,
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
