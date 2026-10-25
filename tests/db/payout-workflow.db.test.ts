import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestOrg, dropTestOrg, hasDatabase } from "./helpers";
import { getDb } from "../../lib/db";
import * as s from "../../lib/db/schema";
import { newId } from "../../lib/db/ids";
import { buildPayout, loadPayoutContext, sourceFromAward } from "../../lib/server/payouts";
import { executeControllerApproval, payoutQuoteFingerprint, recordApprovalWait } from "../../lib/agent/payout-approval";
import { startingRules } from "../../lib/engines";
import { queueControllerRelease } from "@/lib/agent/release";

const workflow = vi.hoisted(() => ({ resumeHook: vi.fn(), start: vi.fn(), getHookByToken: vi.fn() }));
vi.mock("workflow/api", () => workflow);
vi.mock("@/workflows/payout-approval", () => ({ payoutApprovalWorkflow: vi.fn() }));

describe.skipIf(!hasDatabase)("durable controller release against Postgres", { timeout: 60_000 }, () => {
  let db: ReturnType<typeof getDb>;
  let orgId = "", personId = "", eventId = "", memberId = "";
  beforeAll(async () => {
    vi.stubEnv("EVE_DEMO_MODE", "true");
    db = getDb();
    await db.insert(s.fxRate).values({ rateDate: "2026-09-01", base: "CAD", quote: "USD", rate: "0.72876000", source: "Synthetic reference" }).onConflictDoNothing();
    await db.insert(s.taxRule).values(startingRules.map((rule) => ({ ...rule, thresholdMinor: BigInt(rule.thresholdMinor), effectiveTo: rule.effectiveTo ?? null }))).onConflictDoNothing();
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
    expect(payout.reason).toContain(`Destination quote: 1 USD = ${Number(payout.fxRate)} CAD`);
    expect(payout.reason).toContain("including 2% FX spread");
    expect(payout.reason).toContain("2026-10-23");
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

  const controller = () => ({ orgId, memberId, role: "controller" as const, name: "Synthetic Controller", email: "controller@example.test", personId: null, userId: null, demo: true });
  async function bulk(count: number) {
    const { payout } = await proposed();
    if (count === 1) return [payout];
    const [source] = await db.select().from(s.award).where(eq(s.award.id, payout.awardId!));
    const awards = await db.insert(s.award).values(Array.from({ length: count - 1 }, () => ({ ...source, id: newId("award") }))).returning();
    const rest = await db.insert(s.payout).values(awards.map((award) => ({ ...payout, id: newId("pay"), awardId: award.id, idempotencyKey: newId("key") }))).returning();
    return [payout, ...rest];
  }
  it("queues 200 payouts with one SQL read and one audit insert", async () => {
    const payouts = await bulk(200);
    workflow.resumeHook.mockReset().mockImplementation(async (token: string) => ({ runId: token }));
    const query = vi.spyOn(db.$pool, "query");
    try {
      const result = await queueControllerRelease(controller(), payouts.map((p) => p.id));
      expect(result).toMatchObject({ ok: true, status: 202, data: { failed: [] } });
      expect(result.data!.queued).toHaveLength(200);
      expect(workflow.resumeHook).toHaveBeenCalledTimes(200);
      expect(query).toHaveBeenCalledTimes(2);
    } finally { query.mockRestore(); }
  });
  it("pins later quotes before earlier hooks can re-quote them", async () => {
    const payouts = await bulk(6);
    const last = payouts[5];
    let changed = false;
    workflow.resumeHook.mockReset().mockImplementation(async (token: string) => {
      if (!changed) {
        changed = true;
        await db.update(s.payout).set({ bankVersion: 2 }).where(eq(s.payout.id, last.id));
      }
      return { runId: token };
    });
    const result = await queueControllerRelease(controller(), payouts.map((p) => p.id));
    expect(result.data!.queued).toHaveLength(6);
    expect(workflow.resumeHook).toHaveBeenCalledWith(
      expect.stringContaining(last.id), { memberId, quoteFingerprint: payoutQuoteFingerprint(last) },
    );
    await expect(executeControllerApproval(
      { orgId, payoutId: last.id, quoteFingerprint: payoutQuoteFingerprint(last) },
      { memberId, quoteFingerprint: payoutQuoteFingerprint(last) }, "stale-bulk",
    )).rejects.toThrow("fresh controller release");
  });
  it("deduplicates IDs and reports partial queue failures", async () => {
    const payouts = await bulk(2);
    workflow.resumeHook.mockReset().mockImplementation(async (token: string) => {
      if (token.includes(payouts[1].id)) throw new Error("unavailable");
      return { runId: token };
    });
    const result = await queueControllerRelease(controller(), [payouts[0].id, payouts[0].id, payouts[1].id, "missing"]);
    expect(result).toMatchObject({ ok: true, status: 202 });
    expect(result.data!.queued).toHaveLength(1);
    expect(result.data!.failed).toHaveLength(2);
    expect(result.message).toContain("2 payouts were not queued");
    expect(workflow.resumeHook).toHaveBeenCalledTimes(2);
  });
});
