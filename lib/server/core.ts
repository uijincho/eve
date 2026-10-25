// Shared server plumbing: errors, permissions, row -> contract mappers,
// decision log and notices, FX lookup, document storage and draft PDFs.

import { createHash } from "node:crypto";

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

import type { ActorContext } from "@/lib/auth/session";
import type * as C from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { convertMinor as engineConvert } from "@/lib/engines";

// ------------------------------------------------------------------ errors

export class ActionError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409, message: string, public readonly data?: Record<string, unknown>) {
    super(message);
    this.name = "ActionError";
  }
}
export const forbidden = (m: string) => new ActionError(403, m);
export const conflict = (m: string) => new ActionError(409, m);
export const notFound = (m = "Not found.") => new ActionError(404, m);
export const invalid = (m: string) => new ActionError(400, m);

// ------------------------------------------------------------- permissions

type Who = C.Role | "self";

/** Which roles may invoke each action. "self" = attendee acting on their own records (checked in the handler). */
export const ACTION_ROLES: Record<C.AppAction, Who[]> = {
  "org.update": ["organizer"],
  "event.update": ["organizer"],
  "budget.update": ["organizer"],
  "people.import": ["organizer"],
  "people.markSubmitted": ["organizer"],
  "person.update": ["organizer", "self"],
  "person.setProject": ["organizer"],
  "tax.submit": ["organizer", "self"],
  "claim.submit": ["organizer", "self"],
  "claim.review": ["organizer", "controller"],
  "claim.explain": ["self"],
  "award.create": ["organizer"],
  "award.choose": ["organizer", "self"],
  "award.split": ["organizer", "self"],
  "award.confirm": ["self"],
  "award.fulfill": ["controller"],
  "payout.resolveRule": ["controller"],
  "payout.propose": ["organizer", "agent"],
  "payout.release": ["controller"],
  "payout.bankChange": ["organizer", "self"],
  "payout.verify": ["organizer", "controller", "self"],
  "payout.retry": ["controller"],
  "sponsor.create": ["organizer"],
  "sponsor.batchRelease": ["controller"],
  "sponsor.batchRetry": ["controller"],
  "sponsor.batchCancel": ["controller"],
  "sponsor.submit": ["controller"],
  "sponsor.reconcile": ["organizer", "controller"],
  "sponsor.portalStart": ["organizer", "controller"],
  "sponsor.portalDecide": ["controller"],
  "sponsor.portalStop": ["organizer", "controller"],
  "period.lock": ["controller"],
  "filings.generate": ["organizer", "controller"],
  "demo.reset": ["organizer", "controller"],
  "demo.run": ["organizer", "controller"],
  "agent.run": ["organizer", "controller", "agent"],
  "flight.search": ["organizer", "controller", "self"],
  "flight.request": ["organizer", "self"],
  "slack.settings": ["organizer"],
  "slack.linkCode": ["organizer", "controller"],
  "slack.unlink": ["organizer", "controller"],
  "slack.disconnect": ["organizer"],
};

export function assertMayInvoke(actor: ActorContext, action: C.AppAction): void {
  const allowed = ACTION_ROLES[action];
  const ok = allowed.includes(actor.role) || (actor.role === "attendee" && allowed.includes("self"));
  if (!ok) throw forbidden(`${roleLabel(actor.role)} cannot perform ${action}.`);
}

/** Attendees may only touch their own person record. Staff pass through. */
export function assertSelfOrStaff(actor: ActorContext, personId: string): void {
  if (actor.role === "attendee" && actor.personId !== personId) throw forbidden("You can only act on your own records.");
}

export function roleLabel(role: C.Role): string {
  return { attendee: "An attendee", organizer: "An organizer", controller: "A controller", auditor: "An auditor", agent: "The agent" }[role];
}

// ----------------------------------------------------------------- formats

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
export const str = (v: bigint | number | null | undefined) => (v ?? 0).toString();

export function usd(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain ?? ""}`;
}

export function normName(v: string): string {
  return v.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

export function isAdultAt(dateOfBirth: string, at: Date): boolean {
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  const eighteenth = Date.UTC(y + 18, m - 1, d);
  return eighteenth <= at.getTime();
}

// ----------------------------------------------------------------- mappers

export type OrgRow = typeof s.organization.$inferSelect;
export type EventRow = typeof s.event.$inferSelect;
export type PersonRow = typeof s.person.$inferSelect;
export type ProfileRow = typeof s.taxProfile.$inferSelect;
export type MethodRow = typeof s.payoutMethod.$inferSelect;
export type ClaimRow = typeof s.claim.$inferSelect;
export type AwardRow = typeof s.award.$inferSelect;
export type PayoutRow = typeof s.payout.$inferSelect;

export function toOrg(o: OrgRow): C.Organization {
  return {
    id: o.id, name: o.name, country: o.country, mode: o.mode, agentLimitMinor: str(o.agentLimitMinor),
    organizerLimitMinor: str(o.organizerLimitMinor), currency: o.currency, sponsorName: o.sponsorName,
    sponsorTurnaroundDays: o.sponsorTurnaroundDays, feesPaidBy: o.feesPaidBy,
    notificationChannel: o.notificationChannel ?? undefined, policyNotes: o.policyNotes ?? undefined, booksCurrency: BOOKS_CURRENCY,
  };
}

export function toEvent(e: EventRow): C.EventRecord {
  return {
    id: e.id, name: e.name, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), venue: e.venue,
    expectedHeadcount: e.expectedHeadcount, travelCapMinor: str(e.travelCapMinor), economyOnly: e.economyOnly,
    bookingDeadline: e.bookingDeadline.toISOString(), checkInAt: e.checkInAt.toISOString(), closingAt: e.closingAt.toISOString(), locked: e.locked,
  };
}

/** A US citizen or US resident is a US person for a US payer, wherever they live (IRS: W-9, 1099). */
export function isUsPerson(p: Pick<PersonRow, "country" | "citizenship">): boolean {
  return p.country === "US" || p.citizenship === "US";
}

/**
 * Payee jurisdiction for rule selection. A US payer classifies by US-person
 * status (citizenship or residence); a Canadian payer by residence. Payout
 * destination and fees always use the residence country.
 */
export function taxPayeeCountry(payerCountry: string, p: Pick<PersonRow, "country" | "citizenship">): string {
  return payerCountry === "US" && isUsPerson(p) ? "US" : p.country;
}

/** Forms a payer accepts from this person. */
export function acceptedForms(payerCountry: string, p: Pick<PersonRow, "country" | "citizenship">): C.Person["taxForm"][] {
  if (payerCountry === "CA") return ["Residency declaration"];
  return isUsPerson(p) ? ["W-9"] : ["W-8BEN", "W-8BEN-E"];
}

export function expectedForm(p: Pick<PersonRow, "country" | "citizenship">, payerCountry = "US"): C.Person["taxForm"] {
  return acceptedForms(payerCountry, p)[0];
}

export function effectiveTaxStatus(profile: ProfileRow | undefined, now: Date): C.Person["taxStatus"] {
  if (!profile) return "missing";
  if (profile.status === "valid" && profile.expiresAt && profile.expiresAt.getTime() < now.getTime()) return "expired";
  return profile.status;
}

export function hasValidForm(profile: ProfileRow | undefined, now: Date): boolean {
  return effectiveTaxStatus(profile, now) === "valid";
}

/**
 * The form is valid AND still matches the person and payer: the right form
 * for this payer and the signature matching the current legal name. Guards
 * against a profile that went stale without being invalidated.
 */
export function profileValidFor(profile: ProfileRow | undefined, person: Pick<PersonRow, "name" | "country" | "citizenship">, payerCountry: string, now: Date): boolean {
  if (!profile || !hasValidForm(profile, now)) return false;
  if (!acceptedForms(payerCountry, person).includes(profile.form)) return false;
  return !profile.signatureName || normName(profile.signatureName) === normName(person.name);
}

export function toPerson(p: PersonRow, extra: {
  profile?: ProfileRow; method?: MethodRow; paidYtdMinor: bigint; outstandingMinor: bigint; now: Date; payerCountry?: string;
}): C.Person {
  const payerCountry = extra.payerCountry ?? "US";
  const accepted = extra.profile && acceptedForms(payerCountry, p).includes(extra.profile.form);
  const status = effectiveTaxStatus(extra.profile, extra.now);
  return {
    id: p.id, name: p.name, email: p.email, country: p.country, citizenship: p.citizenship, dateOfBirth: p.dateOfBirth,
    address: p.address, role: p.role, adult: p.adult, taxForm: accepted ? extra.profile!.form : expectedForm(p, payerCountry),
    taxStatus: status === "valid" && !profileValidFor(extra.profile, p, payerCountry, extra.now) ? "review" : status, taxSignedAt: iso(extra.profile?.signedAt),
    taxExpiresAt: iso(extra.profile?.expiresAt), taxLast4: extra.profile?.tinLast4 ?? undefined,
    // Payout tax claims a treaty only when an article is named (payouts.ts); the country defaults to residence, as on the form PDF.
    taxTreatyCountry: extra.profile?.treatyArticle ? extra.profile.treatyCountry ?? p.country : undefined,
    ...(extra.profile?.documentId ? { taxDocumentId: extra.profile.documentId, taxDocumentForm: extra.profile.form } : {}),
    payoutCurrency: extra.method?.currency ?? p.payoutCurrency, payoutLast4: extra.method?.last4 ?? "",
    payoutChangedAt: iso(extra.method?.verifiedAt ?? extra.method?.createdAt),
    paidYtdMinor: str(extra.paidYtdMinor), outstandingMinor: str(extra.outstandingMinor), chaseCount: p.chaseCount,
    projectStatus: p.projectStatus, projectUrl: p.projectUrl ?? undefined, projectSource: p.projectSource ?? undefined,
    projectUpdatedAt: iso(p.projectUpdatedAt),
  };
}

export function toClaim(c: ClaimRow, personName: string): C.Claim {
  return {
    id: c.id, personId: c.personId, personName, type: c.type, merchant: c.merchant, description: c.description,
    category: c.category, amountMinor: str(c.amountMinor), currency: c.currency, usdMinor: str(c.usdMinor),
    fxRate: c.fxRate, fxSource: c.fxSource, purchasedAt: c.purchasedAt.toISOString(), travelDate: iso(c.travelDate),
    cabin: c.cabin ?? undefined, origin: c.origin ?? undefined, receiptName: c.receiptName ?? undefined,
    documentId: c.documentId ?? undefined, receiptHash: c.receiptHash ?? undefined, status: c.status, checks: c.checks,
    reason: c.reason, dueAt: c.dueAt.toISOString(), createdAt: c.createdAt.toISOString(), requestedBy: c.requestedBy,
    ...((c.extracted as { fareReview?: C.FareReview } | null)?.fareReview ? { fareReview: (c.extracted as { fareReview: C.FareReview }).fareReview } : {}),
  };
}

export function toAward(a: AwardRow, personName: string): C.Award {
  return {
    id: a.id, personId: a.personId, personName, track: a.track, title: a.title, kind: a.kind, amountMinor: str(a.amountMinor),
    currency: a.currency, fulfillment: a.fulfillment, status: a.status, recommendation: a.recommendation,
    shippingMinor: str(a.shippingMinor), localMinor: str(a.localMinor), teamId: a.teamId ?? undefined,
    splitConfirmed: a.splitConfirmed, dueAt: a.dueAt.toISOString(), requestedBy: a.requestedBy,
  };
}

export function toPayout(p: PayoutRow, personName: string): C.Payout {
  return {
    id: p.id, personId: p.personId, personName, sourceId: (p.claimId ?? p.awardId)!, sourceType: p.sourceType,
    grossMinor: str(p.grossMinor), withholdingMinor: str(p.withholdingMinor), feeMinor: str(p.feeMinor), netMinor: str(p.netMinor),
    currency: p.currency, destinationCurrency: p.destinationCurrency, destinationNetMinor: str(p.destinationNetMinor), fxRate: p.fxRate,
    provider: p.provider, truth: p.truth, status: p.status, reason: p.reason, ruleId: p.ruleId, ruleVersion: p.ruleVersion,
    ruleVerified: p.ruleVerified, requestedBy: p.requestedBy, releasedBy: p.releasedBy ?? undefined, createdAt: p.createdAt.toISOString(),
    dueAt: p.dueAt.toISOString(), paidAt: iso(p.paidAt), providerRef: p.providerRef ?? undefined,
    bankVersion: p.bankVersion == null ? undefined : String(p.bankVersion),
  };
}

// ------------------------------------------------------ org / event context

export async function loadOrgEvent(db: Executor, orgId: string): Promise<{ org: OrgRow; event: EventRow }> {
  const rows = await db.select({ org: s.organization, event: s.event }).from(s.organization)
    .innerJoin(s.event, eq(s.event.orgId, s.organization.id)).where(eq(s.organization.id, orgId))
    .orderBy(desc(s.event.startsAt)).limit(1);
  if (!rows[0]) throw notFound("Organization has no event yet.");
  return rows[0];
}

export async function loadPerson(db: Executor, orgId: string, personId: string, lock = false): Promise<PersonRow> {
  const q = db.select().from(s.person).where(and(eq(s.person.id, personId), eq(s.person.orgId, orgId)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Person not found.");
  return row;
}

export async function currentProfile(db: Executor, personId: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(s.taxProfile)
    .where(and(eq(s.taxProfile.personId, personId), sql`${s.taxProfile.supersededAt} IS NULL`));
  return row;
}

export async function methodsFor(db: Executor, personId: string): Promise<{ active?: MethodRow; pending?: MethodRow }> {
  const rows = await db.select().from(s.payoutMethod)
    .where(and(eq(s.payoutMethod.personId, personId), sql`${s.payoutMethod.status} IN ('active', 'pending_verification')`));
  return { active: rows.find((r) => r.status === "active"), pending: rows.find((r) => r.status === "pending_verification") };
}

// --------------------------------------------------------- decisions/notices

export interface DecisionInput {
  orgId: string; runId?: string; objectType: string; objectId: string; personId?: string | null; personName?: string;
  action: string; summary: string; actor: ActorContext | { memberId: string; role: C.Role; name: string; via?: "slack" };
  status: C.Decision["status"]; tool: string; ruleId?: string | null; ruleVersion?: number | null;
  facts?: Record<string, unknown>; checks?: C.Check[] | null; documentId?: string | null; nextActionAt?: Date | null;
}

export function decisionRow(d: DecisionInput): typeof s.decisionLog.$inferInsert {
  return {
    id: newId("dec"), orgId: d.orgId, runId: d.runId ?? newId("run"), objectType: d.objectType, objectId: d.objectId,
    personId: d.personId ?? null, personName: d.personName ?? "", action: d.action, summary: d.summary,
    actor: d.actor.name, actorRole: d.actor.role, status: d.status, tool: d.tool, ruleId: d.ruleId ?? null,
    ruleVersion: d.ruleVersion ?? null, facts: { ...(d.facts ?? {}), ...("via" in d.actor && d.actor.via ? { via: d.actor.via } : {}) },
    checks: d.checks ?? null, documentId: d.documentId ?? null,
    nextActionAt: d.nextActionAt ?? null,
  };
}

export async function recordDecision(db: Executor, d: DecisionInput): Promise<string> {
  const row = decisionRow(d);
  await db.insert(s.decisionLog).values(row);
  return row.id!;
}

export async function recordNotice(db: Executor, n: { orgId: string; personId?: string | null; channel: string; title: string; body: string; privateVaultId?: string | null; status?: C.Notice["status"] }) {
  const id = newId("ntc");
  await db.insert(s.notice).values({ id, orgId: n.orgId, personId: n.personId ?? null, channel: n.channel, title: n.title, body: n.body, privateVaultId: n.privateVaultId ?? null, status: n.status ?? "simulated" });
  return id;
}

export const AGENT_NAME = "Eve (agent)";

export function agentActor(orgId: string): ActorContext {
  return { memberId: "agent", orgId, role: "agent", name: AGENT_NAME, email: "agent@eve.local", personId: null, demo: false, userId: null };
}

// ---------------------------------------------------------------------- FX

export const FX_FALLBACK_SOURCE = "Seeded reference table";

/** Converts minor units to USD minor units at the latest stored rate on or before the date. */
export async function toUsd(db: Executor, amountMinor: bigint, currency: string, on: Date): Promise<{ usdMinor: bigint; fxRate: string; fxSource: string }> {
  if (currency === "USD") return { usdMinor: amountMinor, fxRate: "1.00000000", fxSource: "No conversion" };
  const [row] = await db.select().from(s.fxRate)
    .where(and(eq(s.fxRate.base, currency), eq(s.fxRate.quote, "USD"), lte(s.fxRate.rateDate, on.toISOString().slice(0, 10))))
    .orderBy(desc(s.fxRate.rateDate)).limit(1);
  if (!row) throw invalid(`No FX rate for ${currency} on ${on.toISOString().slice(0, 10)}.`);
  return { usdMinor: convertMinor(amountMinor, currency, row.rate), fxRate: row.rate, fxSource: `${row.source}, ${row.rateDate}` };
}

/**
 * Books are kept in USD for every organization (BOOKS_CURRENCY). An org whose
 * currency is not USD enters limits, caps and prizes in its own currency; Eve
 * converts them to USD at the latest stored rate when it decides, and records
 * the rate and source. It never compares amounts in two currencies.
 */
export const BOOKS_CURRENCY = "USD";

/** Converts USD minor units into `currency` at the latest stored rate on or before the date (inverse of toUsd). */
export async function fromUsd(db: Executor, usdMinor: bigint, currency: string, on: Date): Promise<{ minor: bigint; fxRate: string; fxSource: string }> {
  if (currency === "USD") return { minor: usdMinor, fxRate: "1.00000000", fxSource: "No conversion" };
  const [row] = await db.select().from(s.fxRate)
    .where(and(eq(s.fxRate.base, currency), eq(s.fxRate.quote, "USD"), lte(s.fxRate.rateDate, on.toISOString().slice(0, 10))))
    .orderBy(desc(s.fxRate.rateDate)).limit(1);
  if (!row) throw invalid(`No FX rate for ${currency} on ${on.toISOString().slice(0, 10)}.`);
  const [whole, frac = ""] = row.rate.split(".");
  const num = BigInt(whole + frac);
  const inverse = { num: (10n ** BigInt(frac.length + 10)) / num, scale: 10 };
  return { minor: engineConvert(usdMinor, "USD", currency, inverse), fxRate: row.rate, fxSource: `${row.source}, ${row.rateDate} (inverse)` };
}

/** "$1,000.00" for USD, "CAD 1,000.00" otherwise. */
export function money(minor: bigint, currency: string): string {
  return currency === "USD" ? usd(minor) : `${currency} ${usd(minor).replace("$", "")}`;
}

/**
 * The org's policy limits and the event's travel cap in book currency (USD).
 * Identity for USD orgs; for others each is converted at today's stored rate.
 */
export async function limitsInBooks<O extends Pick<OrgRow, "currency" | "agentLimitMinor" | "organizerLimitMinor" | "controllerThresholdMinor">, E extends Pick<EventRow, "travelCapMinor">>(db: Executor, org: O, event: E): Promise<{ org: O; event: E; note: string | null }> {
  if (org.currency === BOOKS_CURRENCY) return { org, event, note: null };
  const now = new Date();
  const c = async (v: bigint) => (await toUsd(db, v, org.currency, now)).usdMinor;
  const fx = await toUsd(db, 100n, org.currency, now);
  return {
    org: { ...org, agentLimitMinor: await c(org.agentLimitMinor), organizerLimitMinor: await c(org.organizerLimitMinor), controllerThresholdMinor: await c(org.controllerThresholdMinor) },
    event: { ...event, travelCapMinor: await c(event.travelCapMinor) },
    note: `Books in USD: ${org.currency} limits converted at ${fx.fxRate} (${fx.fxSource}).`,
  };
}

/** Exact conversion to USD via the canonical engine (same rounding the policy checks use). */
export function convertMinor(amountMinor: bigint, currency: string, rate: string): bigint {
  return engineConvert(amountMinor, currency, "USD", rate);
}

// --------------------------------------------------------------- documents

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MIME_MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => Buffer.from(b.subarray(0, 5)).toString("ascii") === "%PDF-",
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => Buffer.from(b.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WEBP",
};

export function validateUpload(bytes: Uint8Array, mimeType: string): void {
  const check = MIME_MAGIC[mimeType];
  if (!check) throw invalid("Upload a PDF, JPEG, PNG, or WebP file.");
  if (bytes.length < 8 || bytes.length > MAX_DOCUMENT_BYTES) throw invalid("Files must be nonempty and at most 8 MB.");
  if (!check(bytes)) throw invalid("The file contents do not match its type.");
}

export async function storeDocument(db: Executor, d: { orgId: string; personId?: string | null; uploadedBy: string; kind: typeof s.document.$inferInsert.kind; name: string; mimeType: string; bytes: Uint8Array }) {
  const id = newId("doc");
  const sha256 = createHash("sha256").update(d.bytes).digest("hex");
  const name = d.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
  await db.insert(s.document).values({ id, orgId: d.orgId, personId: d.personId ?? null, uploadedBy: d.uploadedBy, kind: d.kind, name, mimeType: d.mimeType, sizeBytes: d.bytes.length, sha256, bytes: Buffer.from(d.bytes) });
  return { id, name, sha256, url: `/api/documents/${id}` };
}

/** One-page draft PDF with a DRAFT watermark. Never an e-filed or signed form. */
export async function draftPdf(title: string, rows: [string, string][], footer: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("Eve (draft)");
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ascii = (t: string) => t.replace(/[^\x20-\x7e]/g, "?");
  page.drawText("DRAFT - NOT FILED", { x: 120, y: 360, size: 54, font: bold, color: rgb(0.85, 0.85, 0.85), rotate: degrees(35) });
  page.drawText(ascii(title), { x: 48, y: 740, size: 18, font: bold });
  let y = 700;
  for (const [k, v] of rows) {
    page.drawText(ascii(k), { x: 48, y, size: 10, font: bold });
    page.drawText(ascii(v).slice(0, 80), { x: 220, y, size: 10, font });
    y -= 18;
    if (y < 80) break;
  }
  page.drawText(ascii(footer).slice(0, 110), { x: 48, y: 48, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
  return pdf.save();
}
