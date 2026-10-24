// Scoreboard: compares the answer key (planted errors) with what the system
// actually did: claim statuses and check results, payout states, packet
// reconciliation and filings. Nothing here is hardcoded to pass.
//
// Wrongful payouts are judged from the evidence in force when the money moved,
// not from the answer key alone: a payment released after a bank change was
// verified through the original channel, or after a valid form arrived, is
// legitimate. A payment is wrongful when, at the moment it was authorized,
// the recipient was a minor, a bank change was unresolved, no valid tax form
// was in force (prizes), an unverified rule had not been resolved by a
// controller (prizes), or the claim it pays was auto-approved despite a planted error.

import { and, desc, eq, inArray } from "drizzle-orm";

import type { Scoreboard } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";

import { usd } from "./core";
import { thresholdReached } from "@/lib/tax";

import { formFamily } from "./engines";
import { filingCurrency } from "./filing-currency";

const MOVED = new Set(["processing", "paid"]);
/** Checks that reflect limits, not errors; failing them is not a false positive. */
const NON_ERROR_CHECKS = new Set(["agent_limit", "evidence", "budget"]);

export async function computeScoreboard(db: Executor, orgId: string): Promise<Scoreboard> {
  const [keys, claims, payouts, packets, filings, awards, people, rules, methods, profiles, approvals, evidence] = await Promise.all([
    db.select().from(s.answerKey).where(eq(s.answerKey.orgId, orgId)),
    db.select({ id: s.claim.id, personId: s.claim.personId, status: s.claim.status, checks: s.claim.checks, reviewedBy: s.claim.reviewedBy }).from(s.claim).where(eq(s.claim.orgId, orgId)),
    db.select({ id: s.payout.id, personId: s.payout.personId, claimId: s.payout.claimId, status: s.payout.status, reportingForm: s.payout.reportingForm, reportable: s.payout.reportable, sourceType: s.payout.sourceType, grossMinor: s.payout.grossMinor, paidAt: s.payout.paidAt, ruleId: s.payout.ruleId, ruleVersion: s.payout.ruleVersion, ruleVerified: s.payout.ruleVerified, awardId: s.payout.awardId, createdAt: s.payout.createdAt }).from(s.payout).where(eq(s.payout.orgId, orgId)),
    db.select({ id: s.sponsorPacket.id, status: s.sponsorPacket.status }).from(s.sponsorPacket).where(eq(s.sponsorPacket.orgId, orgId)),
    db.select({ personId: s.filing.personId, form: s.filing.form, year: s.filing.year, grossMinor: s.filing.grossMinor }).from(s.filing).where(eq(s.filing.orgId, orgId)),
    db.select({ personId: s.award.personId, status: s.award.status }).from(s.award).where(eq(s.award.orgId, orgId)),
    db.select({ id: s.person.id, adult: s.person.adult }).from(s.person).where(eq(s.person.orgId, orgId)),
    db.select({ id: s.taxRule.id, version: s.taxRule.version, thresholdMinor: s.taxRule.thresholdMinor }).from(s.taxRule),
    db.select({ personId: s.payoutMethod.personId, version: s.payoutMethod.version, status: s.payoutMethod.status, createdAt: s.payoutMethod.createdAt, verifiedAt: s.payoutMethod.verifiedAt }).from(s.payoutMethod).where(eq(s.payoutMethod.orgId, orgId)),
    db.select({ personId: s.taxProfile.personId, status: s.taxProfile.status, createdAt: s.taxProfile.createdAt, supersededAt: s.taxProfile.supersededAt, expiresAt: s.taxProfile.expiresAt }).from(s.taxProfile).where(eq(s.taxProfile.orgId, orgId)),
    db.select({ objectId: s.approval.objectId, createdAt: s.approval.createdAt }).from(s.approval).where(and(eq(s.approval.orgId, orgId), eq(s.approval.objectType, "payout"), eq(s.approval.decision, "approved"))),
    db.select({ objectId: s.decisionLog.objectId, personId: s.decisionLog.personId, action: s.decisionLog.action, status: s.decisionLog.status, facts: s.decisionLog.facts }).from(s.decisionLog)
      .where(and(eq(s.decisionLog.orgId, orgId), inArray(s.decisionLog.action, ["payout.bankChange", "payout.propose", "payout.requote", "sponsor.reconcile", "payout.resolveRule"]))),
  ]);
  // Threshold cases are evaluated for the current payment year, like taxFor and filings.
  const year = new Date().getUTCFullYear();
  const thresholdOf = new Map(rules.map((r) => [`${r.id}:${r.version}`, r.thresholdMinor]));
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const payoutsByPerson = new Map<string, typeof payouts>();
  for (const p of payouts) payoutsByPerson.set(p.personId, [...(payoutsByPerson.get(p.personId) ?? []), p]);
  const adult = new Map(people.map((p) => [p.id, p.adult]));
  /** When the money moved: the controller's approval (release, sponsor submit, in-kind), else paidAt. */
  const authorizedAt = new Map<string, Date>();
  for (const a of approvals) {
    const cur = authorizedAt.get(a.objectId);
    if (!cur || a.createdAt > cur) authorizedAt.set(a.objectId, a.createdAt);
  }
  const resolvedRule = new Set(evidence.filter((d) => d.action === "payout.resolveRule").map((d) => d.objectId));
  /** Why a moved payout was wrongful at the time it moved, or null when it was legitimately authorized. */
  const wrongfulReason = (p: (typeof payouts)[number]): string | null => {
    if (!MOVED.has(p.status)) return null;
    const at = authorizedAt.get(p.id) ?? p.paidAt ?? p.createdAt;
    if (adult.get(p.personId) === false) return "paid a minor";
    const openChange = methods.some((m) => m.personId === p.personId && m.version > 1 && m.createdAt <= at && (!m.verifiedAt || m.verifiedAt > at));
    if (openChange) return "paid while a bank change was unverified";
    if (p.sourceType === "award") {
      const valid = profiles.some((f) => f.personId === p.personId && f.status === "valid" && f.createdAt <= at && (!f.supersededAt || f.supersededAt > at) && (!f.expiresAt || f.expiresAt > at));
      if (!valid) return "paid without a valid tax form";
      if (!p.ruleVerified && !(p.awardId && resolvedRule.has(p.awardId))) return "paid on an unverified rule without controller resolution";
    }
    if (p.claimId && flaggedClaims.has(p.claimId) && claimById.get(p.claimId)?.reviewedBy === "agent") return "auto-approved a planted error";
    return null;
  };
  const failedCodes = (checks: { code: string; passed: boolean }[]) => checks.filter((c) => !c.passed && !NON_ERROR_CHECKS.has(c.code)).map((c) => c.code);

  const results: Scoreboard["results"] = [];
  const blockedPeople = new Set<string>();
  const flaggedClaims = new Set<string>();
  for (const k of keys) {
    let actual = "not evaluated";
    let passed = false;
    if (k.expected === "flag") {
      flaggedClaims.add(k.objectId);
      const c = claimById.get(k.objectId);
      if (c) {
        const codes = failedCodes(c.checks);
        // Caught = the agent did not approve it and recorded the failing check. A person may still approve it afterwards.
        const agentApproved = c.reviewedBy === "agent";
        const codeOk = !k.expectedCode || codes.includes(k.expectedCode);
        passed = !agentApproved && codes.length > 0 && codeOk;
        actual = `${c.status}${agentApproved ? " (auto-approved)" : c.reviewedBy && ["approved", "paid"].includes(c.status) ? " (approved by a person after review)" : ""}${codes.length ? `; failed ${codes.join(", ")}` : "; no failed checks"}`;
      } else actual = "claim missing";
    } else if (k.expected === "hold" || k.expected === "freeze") {
      blockedPeople.add(k.objectId);
      const ps = payoutsByPerson.get(k.objectId) ?? [];
      const personAwards = awards.filter((a) => a.personId === k.objectId);
      const personClaims = claims.filter((c) => c.personId === k.objectId);
      const wrongful = ps.map(wrongfulReason).filter(Boolean);
      const want = k.expected === "hold" ? ["held", "frozen"] : ["frozen"];
      const stoppedNow = ps.some((p) => want.includes(p.status));
      // Evidence that Eve stopped it at the time, even if it was legitimately resolved and paid since.
      const froze = evidence.some((d) => d.personId === k.objectId && d.action === "payout.bankChange" && Array.isArray(d.facts?.frozen) && (d.facts.frozen as unknown[]).length > 0);
      const held = evidence.some((d) => d.personId === k.objectId && ["payout.propose", "payout.requote"].includes(d.action) && d.status === "escalated");
      if (k.expected === "freeze") passed = wrongful.length === 0 && (stoppedNow || froze);
      else passed = wrongful.length === 0 && (stoppedNow || held || personAwards.some((a) => a.status === "needs_form") || (personClaims.length > 0 && personClaims.every((c) => !["approved", "paid"].includes(c.status))));
      actual = (ps.length ? ps.map((p) => p.status).join(", ") : personAwards.length ? `award ${personAwards.map((a) => a.status).join(", ")}` : personClaims.length ? `claims ${personClaims.map((c) => c.status).join(", ")}` : "nothing proposed")
        + (wrongful.length ? `; wrongful: ${wrongful.join(", ")}` : ps.some((p) => MOVED.has(p.status)) ? "; paid after the hold was resolved" : "");
    } else if (k.expected === "exception") {
      const pk = packets.find((p) => p.id === k.objectId);
      const raised = evidence.some((d) => d.objectId === k.objectId && d.action === "sponsor.reconcile" && d.status === "escalated");
      passed = pk?.status === "exception" || (pk?.status === "paid" && raised);
      actual = pk ? `${pk.status}${pk.status === "paid" && raised ? " (after a recorded exception)" : ""}` : "packet missing";
    } else if ((k.expected === "reportable" || (k.expected === "clean" && k.objectType === "person")) && filingCurrency(formFamily(k.expectedCode ?? "1099-MISC")) !== "USD") {
      // CRA worksheets are CAD while payouts are USD books; comparing them here would mix currencies.
      // Never scored as caught: a person checks the unverified T4A/NR4 draft.
      actual = `not evaluated: ${formFamily(k.expectedCode!)} amounts are CAD (unverified CRA draft); this check compares USD 1099 totals only`;
    } else if (k.expected === "reportable" || (k.expected === "clean" && k.objectType === "person")) {
      // Threshold truth comes from what was actually paid and filed, never from a proposal's flag:
      // reportable = a drafted filing for this form and year whose gross equals the paid same-form
      // total, and that total reaches the rule threshold. clean = paid but below it, and no filing.
      const form = formFamily(k.expectedCode ?? "1099-MISC");
      const paid = (payoutsByPerson.get(k.objectId) ?? []).filter((p) => p.sourceType === "award" && p.status === "paid" && p.paidAt?.getUTCFullYear() === year && formFamily(p.reportingForm ?? "") === form);
      const paidTotal = paid.reduce((sum, p) => sum + p.grossMinor, 0n);
      const threshold = paid.reduce((max, p) => {
        const t = thresholdOf.get(`${p.ruleId}:${p.ruleVersion}`) ?? 0n;
        return t > max ? t : max;
      }, 0n);
      const filed = filings.filter((f) => f.personId === k.objectId && f.year === year && f.form === form);
      const filedGross = filed.reduce((sum, f) => sum + f.grossMinor, 0n);
      const reached = thresholdReached(form, paidTotal, threshold);
      if (k.expected === "reportable") passed = paid.length > 0 && reached && filed.length === 1 && filedGross === paidTotal;
      else passed = paid.length > 0 && !reached && filed.length === 0;
      actual = `${paid.length ? `paid ${usd(paidTotal)} on ${form} in ${year} (threshold ${usd(threshold)})` : `nothing paid on ${form} in ${year} yet`}; ${filed.length ? `${form} drafted for ${usd(filedGross)}` : `no ${form} drafted`}`;
    }
    results.push({ id: k.id, scenario: k.scenario, expected: k.expected + (k.expectedCode ? `:${k.expectedCode}` : ""), actual, passed });
  }

  // Claims by people whose planted error is on the person (e.g. minors) are expected to fail checks too.
  const falsePositives = claims.filter((c) => !flaggedClaims.has(c.id) && !blockedPeople.has(c.personId) && failedCodes(c.checks).length > 0).length;
  const wrongfulPayouts = payouts.filter((p) => wrongfulReason(p) !== null).length;
  const caught = results.filter((r) => r.passed).length;
  return { total: keys.length, evaluated: results.length, caught, missed: results.length - caught, falsePositives, wrongfulPayouts, results };
}

export async function saveScoreboard(db: Executor, orgId: string, b: Scoreboard) {
  await db.insert(s.scoreboardRun).values({ id: newId("sb"), orgId, total: b.total, caught: b.caught, missed: b.missed, falsePositives: b.falsePositives, wrongfulPayouts: b.wrongfulPayouts, results: b.results });
}

export async function lastScoreboardRun(db: Executor, orgId: string) {
  const [row] = await db.select({ runAt: s.scoreboardRun.runAt }).from(s.scoreboardRun).where(eq(s.scoreboardRun.orgId, orgId)).orderBy(desc(s.scoreboardRun.runAt)).limit(1);
  return row?.runAt;
}
