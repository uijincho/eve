// CRA T4A "more than CAD 500" at the boundary, through real Postgres: the
// quote (USD books with a converted threshold), the drafted filings (CAD) and
// the scoreboard, which does not score CAD worksheets against USD totals.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ActorContext } from "@/lib/auth/session";

import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

describe.skipIf(!hasDatabase)("CRA T4A threshold boundary (real Postgres)", { timeout: 120_000 }, () => {
  let orgId = "";
  const load = async () => ({
    db: (await import("@/lib/db")).getDb(),
    s: await import("@/lib/db/schema"),
    services: await import("@/lib/server/services"),
    filings: await import("@/lib/server/filings"),
    scoreboard: await import("@/lib/server/scoreboard"),
    rules: (await import("@/lib/engines")).startingRules,
  });
  let m: Awaited<ReturnType<typeof load>>;
  const controller = (): ActorContext => ({ orgId, memberId: `${orgId}_ctl`, role: "controller", name: "Synthetic Controller", email: `ctl.${orgId}@example.test`, personId: null, userId: null, demo: false });
  const organizer = (): ActorContext => ({ ...controller(), memberId: `${orgId}_org`, role: "organizer", email: `org.${orgId}@example.test` });

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("cra-threshold");
    await db.update(s.organization).set({ country: "CA", currency: "CAD" }).where(eq(s.organization.id, orgId));
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Synthetic CAD event", startsAt: new Date("2026-10-24"), endsAt: new Date("2026-10-26"), venue: "Toronto", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10"), checkInAt: new Date("2026-10-24"), closingAt: new Date("2026-10-26") });
    await db.insert(s.fxRate).values({ rateDate: "2026-09-01", base: "CAD", quote: "USD", rate: "0.72876000", source: "Synthetic reference" }).onConflictDoNothing();
    await db.insert(s.taxRule).values(m.rules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
    await db.insert(s.orgMember).values([
      { id: controller().memberId, orgId, role: "controller", name: "Synthetic Controller", email: controller().email },
      { id: organizer().memberId, orgId, role: "organizer", name: "Synthetic Organizer", email: organizer().email },
    ]);
  }, 120_000);
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); }, 120_000);

  /** A CA resident with an active CAD account and a valid residency declaration. */
  async function resident(suffix: string) {
    const { db, s, services } = m;
    const id = `${orgId}_${suffix}`;
    const email = `${suffix}.${orgId}@example.test`;
    await db.insert(s.person).values({ id, orgId, eventId: `${orgId}_evt`, name: `Synthetic ${suffix}`, email, country: "CA", citizenship: "CA", adult: true, dateOfBirth: "2000-01-01", address: "Toronto", payoutCurrency: "CAD" });
    await db.insert(s.payoutMethod).values({ id: `${id}_pm`, orgId, personId: id, currency: "CAD", last4: "1111", status: "active", version: 1, requestedBy: "seed" });
    await db.insert(s.orgMember).values({ id: `${id}_m`, orgId, role: "attendee", name: `Synthetic ${suffix}`, email, personId: id });
    const self: ActorContext = { orgId, memberId: `${id}_m`, role: "attendee", name: suffix, email, personId: id, userId: null, demo: false };
    const r = await services.runAuthorizedAction(self, "tax.submit", { personId: id, form: "Residency declaration", signature: `Synthetic ${suffix}`, certify: true });
    expect(r.data?.status, r.message).toBe("valid");
    return id;
  }

  it("quotes, drafts and scores CAD 500.00 vs 500.01 consistently", async () => {
    const { db, s, services, filings, scoreboard } = m;
    const at = await resident("at500");
    const over = await resident("over500");
    const run = (a: ActorContext, action: string, payload: unknown) => services.runAuthorizedAction(a, action, payload);
    const payoutIds: Record<string, string> = {};
    for (const [personId, amount] of [[at, "50000"], [over, "50001"]] as const) {
      const c = await run(organizer(), "award.create", { personId, track: "Best Hack", title: "Prize", kind: "cash", amountMinor: amount });
      expect(c.ok, c.message).toBe(true);
      const awardId = (c.data!.ids as string[])[0];
      const p = await run(organizer(), "payout.propose", { sourceType: "award", sourceId: awardId });
      expect(p.ok, p.message).toBe(true);
      payoutIds[personId] = p.data!.payoutId as string;
      const r = await run(controller(), "payout.resolveRule", { sourceType: "award", sourceId: awardId, use: "rule", reason: "Synthetic advisor acceptance of ca-ca-prize" });
      expect(r.ok, r.message).toBe(true);
      const rel = await run(controller(), "payout.release", { id: payoutIds[personId] });
      expect(rel.ok, rel.message).toBe(true);
    }
    const row = async (id: string) => (await db.select().from(s.payout).where(eq(s.payout.id, id)))[0];
    expect(await row(payoutIds[at])).toMatchObject({ grossMinor: 36438n, reportable: false, ruleVerified: false, status: "paid" });
    expect(await row(payoutIds[over])).toMatchObject({ grossMinor: 36439n, reportable: true, ruleVerified: false, status: "paid" });

    const result = await db.transaction((tx) => filings.generateFilings(tx, controller(), { year: 2026 }));
    expect(result.data.count).toBe(1);
    const drafts = await db.select().from(s.filing).where(eq(s.filing.orgId, orgId));
    expect(drafts.map((f) => [f.personId, f.form, f.grossMinor, f.status])).toEqual([[over, "T4A", 50001n, "draft"]]);

    await db.insert(s.answerKey).values([
      { id: `${orgId}_k1`, orgId, scenario: "T4A over 500", objectType: "person", objectId: over, expected: "reportable", expectedCode: "T4A", description: "" },
      { id: `${orgId}_k2`, orgId, scenario: "T4A at 500", objectType: "person", objectId: at, expected: "clean", expectedCode: "T4A", description: "" },
    ]);
    const board = await scoreboard.computeScoreboard(db, orgId);
    for (const id of [`${orgId}_k1`, `${orgId}_k2`]) {
      const r = board.results.find((x) => x.id === id)!;
      expect(r.passed).toBe(false);
      expect(r.actual).toMatch(/^not evaluated: T4A amounts are CAD/);
    }
    expect(board.wrongfulPayouts).toBe(0);
  });
});
