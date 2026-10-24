import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestOrg, dropTestOrg, hasDatabase } from "./helpers";
import { getDb } from "../../lib/db";
import * as s from "../../lib/db/schema";
import { newId } from "../../lib/db/ids";
import { buildPayout, loadPayoutContext, sourceFromAward } from "../../lib/server/payouts";
import { executeControllerApproval, payoutQuoteFingerprint, recordApprovalWait } from "../../lib/agent/payout-approval";
import { startingRules } from "../../lib/engines";

describe.skipIf(!hasDatabase)("durable controller release against Postgres", { timeout: 60_000 }, () => {
  let db: ReturnType<typeof getDb>;
  let orgId = "", personId = "", eventId = "", memberId = "";
  beforeAll(async () => {
    vi.stubEnv("EVE_DEMO_MODE", "true");
    db = getDb();
    orgId = await createTestOrg("workflow-release");
    personId = newId("ptest"); eventId = newId("etest"); memberId = newId("mtest");
    await db.insert(s.event).values({ id: eventId, orgId, name: "Workflow test", startsAt: new Date("2026-10-24"), endsAt: new Date("2026-10-26"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10"), checkInAt: new Date("2026-10-24"), closingAt: new Date("2026-10-26") });
    await db.insert(s.person).values({ id: personId, orgId, eventId, name: "Synthetic Recipient", email: "recipient@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2000-01-01", adult: true, payoutCurrency: "CAD" });
    await db.insert(s.orgMember).values({ id: memberId, orgId, role: "controller", name: "Synthetic Controller", email: "controller@example.test", demoPersona: true });
    await db.insert(s.taxProfile).values({ id: newId("tax"), orgId, personId, form: "W-8BEN", status: "valid", signatureName: "Synthetic Recipient", signedAt: new Date("2026-01-01"), expiresAt: new Date("2029-12-31T23:59:59Z") });
    await db.insert(s.payoutMethod).values({ id: newId("method"), orgId, personId, provider: "simulated", currency: "CAD", last4: "4242", status: "active", version: 1, requestedBy: "attendee", verifiedAt: new Date() });
  }, 60_000);
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); vi.unstubAllEnvs(); }, 60_000);

  async function proposed(requestedBy = "separate-requester") {
    const [award] = await db.insert(s.award).values({ id: newId("award"), orgId, eventId, personId, track: "Test prize", title: "Cash prize", kind: "cash", amountMinor: 125000n, currency: "USD", fulfillment: "cash", status: "ready", dueAt: new Date("2026-11-01"), requestedBy }).returning();
    const context = await loadPayoutContext(db, orgId, personId);
    context.rules = startingRules;
    const { row } = buildPayout(context, sourceFromAward(award), requestedBy);
    const [payout] = await db.insert(s.payout).values(row).returning();
    expect(payout.status).toBe("proposed");
    const target = { orgId, payoutId: payout.id, quoteFingerprint: payoutQuoteFingerprint(payout) };
    return { payout, target, approval: { memberId, quoteFingerprint: target.quoteFingerprint } };
  }

  it("serializes concurrent deliveries into one release, approval and pair of journals", async () => {
    const { payout, target, approval } = await proposed();
    const [first, replay, reminder] = await Promise.all([
      executeControllerApproval(target, approval, "wf-test-release"),
      executeControllerApproval(target, approval, "wf-test-release"),
      recordApprovalWait(target, "wf-test-release", 1),
    ]);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(typeof reminder).toBe("boolean"); // Either reminder-first or release-first is valid.
    const approvals = await db.select().from(s.approval).where(eq(s.approval.objectId, payout.id));
    const journals = await db.select().from(s.journalEntry).where(and(eq(s.journalEntry.orgId, orgId), eq(s.journalEntry.sourceId, payout.id)));
    expect(approvals).toHaveLength(1);
    expect(journals).toHaveLength(2);
  });
  it("cannot release a quote whose bank version changed after approval", async () => {
    const { payout, target, approval } = await proposed();
    await db.update(s.payout).set({ bankVersion: 2 }).where(eq(s.payout.id, payout.id));
    await expect(executeControllerApproval(target, approval, "wf-test-stale")).rejects.toThrow("fresh controller release");
    const [unchanged] = await db.select().from(s.payout).where(eq(s.payout.id, payout.id));
    expect(unchanged.status).toBe("proposed");
    expect(unchanged.releasedBy).toBeNull();
  });
  it("rechecks controller membership at execution instead of trusting the hook payload", async () => {
    const { target, approval } = await proposed();
    await db.update(s.orgMember).set({ role: "organizer" }).where(eq(s.orgMember.id, memberId));
    await expect(executeControllerApproval(target, approval, "wf-test-revoked")).rejects.toThrow("no longer has controller");
    await db.update(s.orgMember).set({ role: "controller" }).where(eq(s.orgMember.id, memberId));
  });
  it("does not permit a controller to release their own request through a hook", async () => {
    const { target, approval } = await proposed(memberId);
    await expect(executeControllerApproval(target, approval, "wf-test-self")).rejects.toThrow("own payout");
  });
  it("rejects an unlinked staff member whose email matches the recipient", async () => {
    const { target, approval } = await proposed();
    await db.update(s.orgMember).set({ email: "recipient@example.test", personId: null }).where(eq(s.orgMember.id, memberId));
    try {
      await expect(executeControllerApproval(target, approval, "wf-test-self-email")).rejects.toThrow("recipient");
      const [unchanged] = await db.select().from(s.payout).where(eq(s.payout.id, target.payoutId));
      expect(unchanged.status).toBe("proposed");
      expect(unchanged.releasedBy).toBeNull();
    } finally {
      await db.update(s.orgMember).set({ email: "controller@example.test" }).where(eq(s.orgMember.id, memberId));
    }
  });
});
