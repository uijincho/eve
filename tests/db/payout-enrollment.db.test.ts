import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

// First payout account enrollment in a real (non-demo) organization. The
// attendee's own first account activates without a code; every other path
// keeps the freeze and original-email verification.
describe.skipIf(!hasDatabase)("first payout account enrollment against real Postgres", { timeout: 120_000 }, () => {
  let orgId = "";
  let m: Awaited<ReturnType<typeof load>>;
  const names = ["ada", "ben", "cy", "dee", "eli", "fay"] as const;
  const person: Record<(typeof names)[number], string> = { ada: "", ben: "", cy: "", dee: "", eli: "", fay: "" };
  const member: Record<string, string> = {};

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      services: await import("@/lib/server/services"),
    };
  }
  const attendee = (who: (typeof names)[number]) =>
    ({ memberId: member[who], orgId, role: "attendee" as const, name: who, email: `${who}.${orgId}@example.com`, personId: person[who], demo: false, userId: null });
  const organizer = () => ({ memberId: member.dana, orgId, role: "organizer" as const, name: "Dana", email: `dana.${orgId}@example.com`, personId: null, demo: false, userId: null });
  const methods = (personId: string) => m.db.select().from(m.s.payoutMethod).where(eq(m.s.payoutMethod.personId, personId));
  const payoutsOf = (personId: string) => m.db.select().from(m.s.payout).where(eq(m.s.payout.personId, personId));

  beforeAll(async () => {
    m = await load();
    const { db, s, services } = m;
    orgId = await createTestOrg("enroll");
    await db.update(s.organization).set({ isDemo: false, mode: "direct" }).where(eq(s.organization.id, orgId));
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Test Hacks", startsAt: new Date("2026-11-07T16:00:00Z"), endsAt: new Date("2026-11-08T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-30T00:00:00Z"), checkInAt: new Date("2026-11-07T20:30:00Z"), closingAt: new Date("2026-11-08T21:00:00Z") });
    await db.insert(s.budgetLine).values({ id: `${orgId}_bud`, orgId, eventId: `${orgId}_evt`, name: "Prizes", category: "prizes", capMinor: 10_000_000n, fundingSource: "Test" });
    for (const n of names) {
      person[n] = `${orgId}_${n}`;
      member[n] = `${orgId}_m_${n}`;
      await db.insert(s.person).values({ id: person[n], orgId, name: `${n[0].toUpperCase()}${n.slice(1)} Test`, email: `${n}.${orgId.toLowerCase()}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1990-01-01", address: "Oakland, CA", adult: true, payoutCurrency: "USD" });
    }
    member.dana = `${orgId}_m_dana`;
    await db.insert(s.orgMember).values([
      { id: member.dana, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      ...names.map((n) => ({ id: member[n], orgId, role: "attendee" as const, name: n, email: `${n}.${orgId}@example.com`, personId: person[n] })),
    ]);
    // Ben already has a confirmed account; Eli only has a superseded one.
    await db.insert(s.payoutMethod).values([
      { id: `${person.ben}_pm`, orgId, personId: person.ben, currency: "USD", last4: "1111", status: "active", version: 1, requestedBy: "seed", verifiedAt: new Date() },
      { id: `${person.eli}_pm`, orgId, personId: person.eli, currency: "USD", last4: "2222", status: "superseded", version: 1, requestedBy: "seed", verifiedAt: new Date() },
    ]);
    // Ada wins a prize with a valid W-9; with no account the payout is held.
    const tax = await services.runAuthorizedAction(organizer(), "tax.submit", { personId: person.ada, form: "W-9", signature: "Ada Test", tin: "123456789", certify: true });
    expect(tax.ok).toBe(true);
    const award = await services.runAuthorizedAction(organizer(), "award.create", { personId: person.ada, track: "Best Hack", title: "First", kind: "cash", amountMinor: "50000" });
    expect(award.ok).toBe(true);
    const proposed = await services.runAuthorizedAction(organizer(), "payout.propose", { sourceType: "award", sourceId: (award.data!.ids as string[])[0] });
    expect(proposed.data?.status).toBe("held");
  }, 120_000);

  afterAll(async () => {
    if (!orgId) return;
    await m.db.update(m.s.organization).set({ isDemo: true }).where(eq(m.s.organization.id, orgId));
    await dropTestOrg(orgId);
  }, 120_000);

  it("activates the attendee's own first account, re-quotes the held payout and releases nothing", async () => {
    const r = await m.services.runAuthorizedAction(attendee("ada"), "payout.bankChange", { personId: person.ada, last4: "4321", currency: "USD", accountNumber: "0012344321", requestedVia: "portal" });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ enrolled: true, frozen: [], sentTo: null, requoted: 1 });
    expect(r.data).not.toHaveProperty("methodId");
    const [method] = await methods(person.ada);
    expect(method).toMatchObject({ status: "active", version: 1, last4: "4321", provider: "simulated", requestedVia: "portal", requestedBy: member.ada, verifiedBy: member.ada, verificationVaultId: null, verificationSentTo: null });
    const [payout] = await payoutsOf(person.ada);
    expect(payout).toMatchObject({ status: "proposed", releasedBy: null, paidAt: null, payoutMethodId: method.id, bankVersion: 1 });
    const entries = await m.db.select().from(m.s.journalEntry).where(eq(m.s.journalEntry.orgId, orgId));
    expect(entries).toHaveLength(0);
    const [decision] = await m.db.select().from(m.s.decisionLog).where(and(eq(m.s.decisionLog.orgId, orgId), eq(m.s.decisionLog.action, "payout.enroll")));
    expect(decision.summary).toContain("no code was sent");
    expect(decision.facts).toMatchObject({ basis: "initial_self_enrollment", channelVerified: false, truth: "Simulated", methodId: method.id });
    const codeNotices = await m.db.select().from(m.s.notice).where(and(eq(m.s.notice.orgId, orgId), eq(m.s.notice.personId, person.ada)));
    expect(codeNotices.filter((n) => n.privateVaultId)).toHaveLength(0);
  });

  it("sends the same attendee's next change through freeze and original-email verification", async () => {
    const r = await m.services.runAuthorizedAction(attendee("ada"), "payout.bankChange", { personId: person.ada, last4: "8765", currency: "USD", requestedVia: "portal" });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ enrolled: false });
    const rows = await methods(person.ada);
    expect(rows.find((x) => x.status === "pending_verification")?.last4).toBe("8765");
    expect(rows.find((x) => x.status === "active")?.last4).toBe("4321");
    const [payout] = await payoutsOf(person.ada);
    expect(payout.status).toBe("frozen");
  });

  it("keeps verification for an existing account, a superseded history, staff entry and non-portal requests", async () => {
    const ben = await m.services.runAuthorizedAction(attendee("ben"), "payout.bankChange", { personId: person.ben, last4: "9999", currency: "USD" });
    expect(ben.data).toMatchObject({ enrolled: false });
    const eli = await m.services.runAuthorizedAction(attendee("eli"), "payout.bankChange", { personId: person.eli, last4: "9999", currency: "USD" });
    expect(eli.data).toMatchObject({ enrolled: false });
    const byStaff = await m.services.runAuthorizedAction(organizer(), "payout.bankChange", { personId: person.cy, last4: "5555", currency: "USD" });
    expect(byStaff.data).toMatchObject({ enrolled: false });
    const viaEmail = await m.services.runAuthorizedAction(attendee("fay"), "payout.bankChange", { personId: person.fay, last4: "6666", currency: "USD", requestedVia: "email" });
    expect(viaEmail.data).toMatchObject({ enrolled: false });
    for (const p of [person.ben, person.eli, person.cy, person.fay]) {
      expect((await methods(p)).some((x) => x.status === "pending_verification")).toBe(true);
    }
    expect((await methods(person.cy)).some((x) => x.status === "active")).toBe(false);
  });

  it("rejects an attendee enrolling an account for someone else", async () => {
    const r = await m.services.runAuthorizedAction(attendee("dee"), "payout.bankChange", { personId: person.fay, last4: "7777", currency: "USD" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it("lets the owner replace an unconfirmed staff-entered request with their own first account", async () => {
    const r = await m.services.runAuthorizedAction(attendee("cy"), "payout.bankChange", { personId: person.cy, last4: "3333", currency: "USD" });
    expect(r.data).toMatchObject({ enrolled: true });
    const rows = await methods(person.cy);
    expect(rows.find((x) => x.last4 === "5555")?.status).toBe("rejected");
    expect(rows.find((x) => x.last4 === "3333")).toMatchObject({ status: "active", version: 2 });
  });

  it("activates only one account when two first setups race", async () => {
    const [a, b] = await Promise.all([
      m.services.runAuthorizedAction(attendee("dee"), "payout.bankChange", { personId: person.dee, last4: "1212", currency: "USD" }),
      m.services.runAuthorizedAction(attendee("dee"), "payout.bankChange", { personId: person.dee, last4: "3434", currency: "USD" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect([a.data?.enrolled, b.data?.enrolled].sort()).toEqual([false, true]);
    const rows = await methods(person.dee);
    expect(rows.filter((x) => x.status === "active")).toHaveLength(1);
    expect(rows.filter((x) => x.status === "pending_verification")).toHaveLength(1);
  });
});
