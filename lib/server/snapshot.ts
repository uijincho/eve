// GET /api/app: role-filtered AppSnapshot. Attendees see only their own
// person, claims, awards, payouts, notices, filings and decisions. Staff
// (organizer/controller/auditor) see the org. Raw identifiers never appear:
// tax ids and bank numbers are only ever last 4. Verification codes are never
// shown for real organizations (see bank-verification-delivery.ts); the shared
// demo shows them to the recipient persona as a labeled simulated inbox.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { demoModeEnabled } from "@/lib/auth/session";
import type * as C from "@/lib/contracts";
import { getDb, type Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

import { BOOKS_CURRENCY, iso, loadOrgEvent, str, toAward, toClaim, toEvent, toOrg, toPayout, toPerson, toUsd, type MethodRow, type ProfileRow } from "./core";
import { capInBooks } from "./budget";
import { filingCurrency } from "./filing-currency";
import { loadRules } from "./payouts";
import { loadScoreboardView } from "./scoreboard-view";
import { openSecret } from "./vault";

const DECISION_LIMIT = 300;

export async function buildSnapshot(actor: ActorContext, db: Executor = getDb()): Promise<C.AppSnapshot> {
  const now = new Date();
  const self = actor.role === "attendee";
  if (self && !actor.personId) throw new Error("Attendee membership without a person.");
  const byPerson = <T extends { personId: unknown }>(table: T) => (self ? eq(table.personId as never, actor.personId!) : undefined);
  const orgId = actor.orgId;

  const [
    { org, event }, people, profiles, methods, claims, awards, payouts, budgets, packets, decisions, filings, notices, rules, members,
  ] = await Promise.all([
    loadOrgEvent(db, orgId),
    db.select().from(s.person).where(and(eq(s.person.orgId, orgId), self ? eq(s.person.id, actor.personId!) : undefined)),
    db.select().from(s.taxProfile).where(and(eq(s.taxProfile.orgId, orgId), isNull(s.taxProfile.supersededAt), byPerson(s.taxProfile))),
    db.select().from(s.payoutMethod).where(and(eq(s.payoutMethod.orgId, orgId), inArray(s.payoutMethod.status, ["active", "pending_verification"]), byPerson(s.payoutMethod))),
    db.select().from(s.claim).where(and(eq(s.claim.orgId, orgId), byPerson(s.claim))).orderBy(desc(s.claim.createdAt)),
    db.select().from(s.award).where(and(eq(s.award.orgId, orgId), byPerson(s.award))).orderBy(desc(s.award.createdAt)),
    db.select().from(s.payout).where(and(eq(s.payout.orgId, orgId), byPerson(s.payout))).orderBy(desc(s.payout.createdAt)),
    self ? Promise.resolve([]) : db.select().from(s.budgetLine).where(eq(s.budgetLine.orgId, orgId)),
    self ? Promise.resolve([]) : db.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.orgId, orgId)).orderBy(desc(s.sponsorPacket.createdAt)),
    db.select().from(s.decisionLog).where(and(eq(s.decisionLog.orgId, orgId), byPerson(s.decisionLog))).orderBy(desc(s.decisionLog.createdAt)).limit(DECISION_LIMIT),
    db.select().from(s.filing).where(and(eq(s.filing.orgId, orgId), byPerson(s.filing))),
    self
      ? db.select().from(s.notice).where(and(eq(s.notice.orgId, orgId), eq(s.notice.personId, actor.personId!))).orderBy(desc(s.notice.createdAt)).limit(100)
      : db.select().from(s.notice).where(eq(s.notice.orgId, orgId)).orderBy(desc(s.notice.createdAt)).limit(200),
    loadRules(db),
    demoModeEnabled() ? db.select().from(s.orgMember).where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.demoPersona, true))) : Promise.resolve([]),
  ]);

  const names = new Map(people.map((p) => [p.id, p.name]));
  const profileBy = new Map<string, ProfileRow>(profiles.map((p) => [p.personId, p]));
  const methodBy = new Map<string, MethodRow>();
  for (const m of methods) if (m.status === "active" || !methodBy.has(m.personId)) methodBy.set(m.personId, m);
  const year = now.getUTCFullYear();
  const paidYtd = new Map<string, bigint>();
  const outstanding = new Map<string, bigint>();
  for (const p of payouts) {
    if (p.status === "paid" && p.paidAt && p.paidAt.getUTCFullYear() === year) paidYtd.set(p.personId, (paidYtd.get(p.personId) ?? 0n) + p.grossMinor);
    if (["held", "proposed", "approved", "processing", "frozen"].includes(p.status)) outstanding.set(p.personId, (outstanding.get(p.personId) ?? 0n) + p.netMinor);
  }

  // Budget attribution: claims by category, prizes to "prizes".
  const budgetOut: C.BudgetLine[] = await Promise.all(budgets.map(async (b) => {
    const cap = await capInBooks(db, b.capMinor, org.currency, now);
    let spent = 0n, committed = 0n;
    const payoutByClaim = new Map(payouts.filter((p) => p.claimId).map((p) => [p.claimId!, p]));
    if (b.category === "prizes") {
      for (const p of payouts) {
        if (!p.awardId) continue;
        if (p.status === "paid") spent += p.grossMinor;
        else if (["held", "proposed", "approved", "processing", "frozen"].includes(p.status)) committed += p.grossMinor;
      }
      for (const a of awards) if (!payouts.some((p) => p.awardId === a.id && !["failed", "returned"].includes(p.status)) && a.status !== "paid") committed += (await toUsd(db, a.amountMinor, a.currency, now)).usdMinor;
    } else {
      for (const c of claims) {
        const matches = c.budgetLineId === b.id || (!c.budgetLineId && (c.category === b.category || (b.category === "travel" && c.type === "travel")));
        if (!matches) continue;
        const p = payoutByClaim.get(c.id);
        if (c.status === "paid" || p?.status === "paid") spent += c.usdMinor;
        else if (c.status === "approved") committed += c.usdMinor;
      }
    }
    return { id: b.id, name: b.name, capMinor: str(cap.capMinor), spentMinor: str(spent), committedMinor: str(committed), fundingSource: b.fundingSource, currency: BOOKS_CURRENCY, enteredCapMinor: str(b.capMinor), enteredCurrency: org.currency, fxSource: cap.note };
  }));

  const payoutPerson = new Map(payouts.map((p) => [p.id, p.personId]));
  const noticesOut: C.Notice[] = [];
  // Verification codes are never decrypted into a real org's snapshot, not even for the recipient:
  // a code shown in the session that requested a bank change proves nothing. Only the shared demo
  // shows it, labeled as a simulated channel.
  const simulatedInbox = self && actor.demo && org.isDemo && demoModeEnabled();
  for (const n of notices) {
    let body = n.body;
    if (n.privateVaultId) {
      const code = simulatedInbox && n.personId === actor.personId ? await openSecret(db, orgId, n.privateVaultId) : null;
      body = code
        ? `${body} [Simulated email inbox, demo only] Your confirmation code: ${code}`
        : `${body} (Eve never shows confirmation codes in the app; they go only to the email on file.)`;
    }
    noticesOut.push({ id: n.id, personId: n.personId ?? undefined, channel: n.channel, title: n.title, body, createdAt: n.createdAt.toISOString(), status: n.status });
  }

  const personas: C.Actor[] = members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, personId: m.personId ?? undefined }));
  const scoreboard: C.Scoreboard = self || !org.isDemo
    ? { total: 0, evaluated: 0, caught: 0, missed: 0, falsePositives: 0, wrongfulPayouts: 0, results: [] }
    : await loadScoreboardView(db, orgId);

  return {
    actor: { id: actor.memberId, name: actor.name, email: actor.email, role: actor.role, personId: actor.personId ?? undefined },
    personas,
    org: toOrg(org),
    event: toEvent(event),
    people: people.map((p) => toPerson(p, { profile: profileBy.get(p.id), method: methodBy.get(p.id), paidYtdMinor: paidYtd.get(p.id) ?? 0n, outstandingMinor: outstanding.get(p.id) ?? 0n, now, payerCountry: org.country })),
    claims: claims.map((c) => toClaim(c, names.get(c.personId) ?? "")),
    awards: awards.map((a) => toAward(a, names.get(a.personId) ?? "")),
    payouts: payouts.map((p) => toPayout(p, names.get(p.personId) ?? "")),
    budgets: budgetOut,
    packets: packets.map((pk) => ({
      id: pk.id, payoutId: pk.payoutId, personName: names.get(payoutPerson.get(pk.payoutId) ?? "") ?? "", requestedMinor: str(pk.requestedMinor),
      paidMinor: str(pk.paidMinor), status: pk.status, submittedAt: iso(pk.submittedAt), dueAt: pk.dueAt.toISOString(), reason: pk.reason, documentId: pk.documentId ?? undefined,
    })),
    decisions: decisions.map((d) => ({
      id: d.id, runId: d.runId, objectId: d.objectId, objectType: d.objectType, personName: d.personName, action: d.action, summary: d.summary,
      actor: d.actor, createdAt: d.createdAt.toISOString(), status: d.status, tool: d.tool, ruleId: d.ruleId ?? undefined, ruleVersion: d.ruleVersion ?? undefined,
      facts: d.facts, checks: d.checks ?? undefined, documentId: d.documentId ?? undefined, nextActionAt: iso(d.nextActionAt),
    })),
    filings: filings.map((f) => ({ id: f.id, personId: f.personId, personName: names.get(f.personId) ?? "", year: f.year, form: f.form, grossMinor: str(f.grossMinor), withholdingMinor: str(f.withholdingMinor), currency: filingCurrency(f.form), status: f.status, documentId: f.documentId ?? undefined })),
    rules,
    notices: noticesOut,
    scoreboard,
    demo: actor.demo,
    now: now.toISOString(),
    integrationStatus: [
      { name: "Payouts", mode: "Simulated", detail: "Simulated provider (mock wire fee schedule). No real money moves." },
      { name: "Receipt reading", mode: process.env.ANTHROPIC_API_KEY ? "Live" : "Off", detail: process.env.ANTHROPIC_API_KEY ? "Claude vision extracts facts; checks stay deterministic." : "Manual entry; claims go to review." },
      { name: "Notifications", mode: "Simulated", detail: "Notices are recorded in Eve; no external delivery in demo." },
      { name: "Flights", mode: "Fixture", detail: "Fixture offers; no booking." },
      { name: "Filings", mode: "Draft", detail: "Draft PDFs only. A controller signs; nothing is e-filed." },
    ],
  };
}
