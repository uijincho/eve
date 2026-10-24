// Scoreboard: compares the answer key (planted errors) with what the system
// actually did: claim statuses and check results, payout states, packet
// reconciliation and filings. Nothing here is hardcoded to pass.

import { desc, eq } from "drizzle-orm";

import type { Scoreboard } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";

const MOVED = new Set(["processing", "paid"]);
/** Checks that reflect limits, not errors; failing them is not a false positive. */
const NON_ERROR_CHECKS = new Set(["agent_limit", "evidence", "budget"]);

export async function computeScoreboard(db: Executor, orgId: string): Promise<Scoreboard> {
  const [keys, claims, payouts, packets, filings, awards, people] = await Promise.all([
    db.select().from(s.answerKey).where(eq(s.answerKey.orgId, orgId)),
    db.select({ id: s.claim.id, personId: s.claim.personId, status: s.claim.status, checks: s.claim.checks }).from(s.claim).where(eq(s.claim.orgId, orgId)),
    db.select({ id: s.payout.id, personId: s.payout.personId, claimId: s.payout.claimId, status: s.payout.status, reportingForm: s.payout.reportingForm, reportable: s.payout.reportable }).from(s.payout).where(eq(s.payout.orgId, orgId)),
    db.select({ id: s.sponsorPacket.id, status: s.sponsorPacket.status }).from(s.sponsorPacket).where(eq(s.sponsorPacket.orgId, orgId)),
    db.select({ personId: s.filing.personId, form: s.filing.form }).from(s.filing).where(eq(s.filing.orgId, orgId)),
    db.select({ personId: s.award.personId, status: s.award.status }).from(s.award).where(eq(s.award.orgId, orgId)),
    db.select({ id: s.person.id, adult: s.person.adult }).from(s.person).where(eq(s.person.orgId, orgId)),
  ]);
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const payoutsByPerson = new Map<string, typeof payouts>();
  for (const p of payouts) payoutsByPerson.set(p.personId, [...(payoutsByPerson.get(p.personId) ?? []), p]);
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
        const stopped = !["approved", "paid"].includes(c.status);
        const codeOk = !k.expectedCode || codes.includes(k.expectedCode);
        passed = stopped && codes.length > 0 && codeOk;
        actual = `${c.status}${codes.length ? `; failed ${codes.join(", ")}` : "; no failed checks"}`;
      } else actual = "claim missing";
    } else if (k.expected === "hold" || k.expected === "freeze") {
      blockedPeople.add(k.objectId);
      const ps = payoutsByPerson.get(k.objectId) ?? [];
      const personAwards = awards.filter((a) => a.personId === k.objectId);
      const personClaims = claims.filter((c) => c.personId === k.objectId);
      const moved = ps.filter((p) => MOVED.has(p.status));
      const want = k.expected === "hold" ? ["held", "frozen"] : ["frozen"];
      const stopped = ps.filter((p) => want.includes(p.status));
      if (k.expected === "freeze") passed = stopped.length > 0 && moved.length === 0;
      else passed = moved.length === 0 && (stopped.length > 0 || personAwards.some((a) => a.status === "needs_form") || (personClaims.length > 0 && personClaims.every((c) => !["approved", "paid"].includes(c.status))));
      actual = ps.length ? ps.map((p) => p.status).join(", ") : personAwards.length ? `award ${personAwards.map((a) => a.status).join(", ")}` : personClaims.length ? `claims ${personClaims.map((c) => c.status).join(", ")}` : "nothing proposed";
    } else if (k.expected === "exception") {
      const pk = packets.find((p) => p.id === k.objectId);
      passed = pk?.status === "exception";
      actual = pk ? pk.status : "packet missing";
    } else if (k.expected === "reportable") {
      const ps = payoutsByPerson.get(k.objectId) ?? [];
      const filed = filings.filter((f) => f.personId === k.objectId);
      const formPrefix = k.expectedCode ?? "1099";
      passed = filed.some((f) => f.form.startsWith(formPrefix)) || ps.some((p) => !["failed", "returned"].includes(p.status) && p.reportable && Boolean(p.reportingForm?.startsWith(formPrefix)));
      actual = filed.length ? `filing ${filed.map((f) => f.form).join(", ")}` : ps.length ? `payouts ${ps.map((p) => `${p.status}${p.reportable ? ` (reportable ${p.reportingForm?.split(" ")[0]})` : ""}`).join(", ")}` : "no payouts";
    }
    results.push({ id: k.id, scenario: k.scenario, expected: k.expected + (k.expectedCode ? `:${k.expectedCode}` : ""), actual, passed });
  }

  // Claims by people whose planted error is on the person (e.g. minors) are expected to fail checks too.
  const falsePositives = claims.filter((c) => !flaggedClaims.has(c.id) && !blockedPeople.has(c.personId) && failedCodes(c.checks).length > 0).length;
  const minors = new Set(people.filter((p) => !p.adult).map((p) => p.id));
  const wrongfulPayouts = payouts.filter((p) => MOVED.has(p.status) && (blockedPeople.has(p.personId) || minors.has(p.personId) || (p.claimId != null && flaggedClaims.has(p.claimId)))).length;
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
