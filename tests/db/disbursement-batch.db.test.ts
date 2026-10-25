import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";
import { batchQuoteKey } from "@/lib/disbursement";

const computer = vi.hoisted(() => ({ portalImports: vi.fn(), portalRecords: vi.fn(), authorizePortalBatch: vi.fn() }));
vi.mock("@/lib/computer-use/computer", async (original) => ({ ...await original<typeof import("@/lib/computer-use/computer")>(), ...computer }));
vi.mock("@e2b/desktop", () => ({ Sandbox: { connect: vi.fn(async () => ({})), kill: vi.fn() } }));
const workflow = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "bulk-workflow" })) }));
vi.mock("workflow/api", () => ({ ...workflow, getHookByToken: vi.fn(), resumeHook: vi.fn() }));
vi.mock("@/workflows/disbursement", () => ({ disbursementWorkflow: vi.fn() }));

// Real release gates, row locks, bundle generation and ledger savepoints; no model/desktop credits.
describe.skipIf(!hasDatabase)("bulk sponsor releases", { timeout: 180000 }, () => {
  let orgId = "", n = 0;
  let db: ReturnType<typeof import("@/lib/db").getDb>;
  let s: typeof import("@/lib/db/schema");
  let services: typeof import("@/lib/server/services");
  let batch: typeof import("@/lib/computer-use/batch-run");
  const actor = (role: "organizer" | "controller") => ({ orgId, memberId: `${orgId}_${role}`, role, name: role, email: `${role}@example.test`, personId: null, userId: null, demo: false });
  beforeAll(async () => {
    db = (await import("@/lib/db")).getDb(); s = await import("@/lib/db/schema"); services = await import("@/lib/server/services"); batch = await import("@/lib/computer-use/batch-run");
    vi.stubEnv("E2B_API_KEY", "unused"); vi.stubEnv("ANTHROPIC_API_KEY", "unused");
    orgId = await createTestOrg("bulk");
    await db.update(s.organization).set({ mode: "sponsor", sponsorName: "Test Sponsor" }).where(eq(s.organization.id, orgId));
    const at = new Date();
    await db.insert(s.event).values({ id: `${orgId}_event`, orgId, name: "Bulk test", startsAt: at, endsAt: at, venue: "Test", travelCapMinor: 50000n, bookingDeadline: at, checkInAt: at, closingAt: at });
    await db.insert(s.orgMember).values(["organizer", "controller"].map((role) => ({ id: `${orgId}_${role}`, orgId, role: role as "organizer" | "controller", name: role, email: `${role}@example.test` })));
    const { startingRules } = await import("@/lib/server/engines");
    await db.insert(s.taxRule).values(startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
  });
  afterAll(async () => { vi.unstubAllEnvs(); if (orgId) await dropTestOrg(orgId); });
  async function proposed() {
    const id = `${orgId}_person${++n}`;
    await db.insert(s.person).values({ id, orgId, name: `Recipient ${n}`, email: `recipient${n}@example.test`, country: "US", citizenship: "US", dateOfBirth: "1990-01-01", adult: true, payoutCurrency: "USD" });
    await db.insert(s.payoutMethod).values({ id: `${id}_method`, orgId, personId: id, currency: "USD", last4: "4242", version: 1, status: "active", requestedBy: "seed" });
    const form = await services.runAuthorizedAction(actor("organizer"), "tax.submit", { personId: id, form: "W-9", signature: `Recipient ${n}`, tin: `123-45-${String(7000 + n)}`, certify: true });
    expect(form.ok, form.message).toBe(true);
    const award = await services.runAuthorizedAction(actor("organizer"), "award.create", { personId: id, track: "Best test", title: "Prize", kind: "cash", amountMinor: "10000" });
    const result = await services.runAuthorizedAction(actor("organizer"), "payout.propose", { sourceType: "award", sourceId: (award.data!.ids as string[])[0] });
    expect(result.ok, result.message).toBe(true);
    const [p] = await db.select().from(s.payout).where(eq(s.payout.id, String(result.data!.payoutId)));
    return { id: p.id, quote: batchQuoteKey(p) };
  }
  it("requires a controller and binds release to the displayed quote", async () => {
    const p = await proposed();
    expect(await batch.releaseBatch(actor("organizer"), { payouts: [p] })).toMatchObject({ status: 403 });
    expect(await batch.releaseBatch(actor("controller"), { payouts: [{ ...p, quote: "stale" }] })).toMatchObject({ ok: false, status: 409 });
    expect(workflow.start).not.toHaveBeenCalled();
  });
  it("generates packets and starts exactly one task for multiple payouts, with no premature accrual", async () => {
    const payouts = [await proposed(), await proposed()];
    const result = await batch.releaseBatch(actor("controller"), { payouts });
    expect(result.ok, result.message).toBe(true);
    expect(workflow.start).toHaveBeenCalledTimes(1);
    const target = { orgId, batchId: String(result.data!.batchId) };
    expect(await batch.beginBatch(target, "test-preparation")).toHaveLength(2);
    for (const p of payouts) await batch.prepareBatchItem(target, p.id);
    // Replaying a completed preparation step must not duplicate its packet.
    await batch.prepareBatchItem(target, payouts[0].id);
    expect(await batch.prepareBatchBundle(target)).toBe(true);
    const rows = await batch.batchesFor(orgId);
    const b = rows.find((row) => row.id === result.data!.batchId)!;
    expect(b).toMatchObject({ count: 2, netMinor: "20000", status: "preparing" });
    expect(await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId))).toHaveLength(0);
    for (const id of b.packetIds) {
      expect((await services.runAuthorizedAction(actor("controller"), "sponsor.submit", { id })).ok).toBe(false);
    }
    const duplicate = await batch.releaseBatch(actor("controller"), { payouts });
    expect(duplicate.ok).toBe(false); expect(workflow.start).toHaveBeenCalledTimes(1);
    expect((await batch.cancelBatch(actor("controller"), b.id)).ok).toBe(true);
    expect((await batch.releaseBatch(actor("controller"), { payouts })).ok).toBe(true);
    expect(workflow.start).toHaveBeenCalledTimes(2);
  });
  it("checks every imported row, submits all payouts atomically and settles only on remittance", async () => {
    const payouts = [await proposed(), await proposed()];
    const released = await batch.releaseBatch(actor("controller"), { payouts });
    expect(released.ok, released.message).toBe(true);
    const target = { orgId, batchId: String(released.data!.batchId) };
    await batch.beginBatch(target, "test-settlement");
    for (const p of payouts) await batch.prepareBatchItem(target, p.id);
    await batch.prepareBatchBundle(target);
    const [b] = await db.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, target.batchId));
    const { newAgentState } = await import("@/lib/computer-use/turn");
    await db.update(s.disbursementBatch).set({ status: "filling", sandboxId: "synthetic", state: { agent: newAgentState("test", "") } }).where(eq(s.disbursementBatch.id, b.id));
    const receipt = { batchId: b.id, manifestHash: b.manifestHash, manifest: b.manifest, confirmation: "WB-26-11111" };
    const wrong = structuredClone(receipt); wrong.manifest.payments[0].name = "Wrong recipient";
    computer.portalImports.mockResolvedValue({ [b.id]: wrong });
    await expect(batch.authorizeBatch(target)).rejects.toThrow(/differs/);
    expect(computer.authorizePortalBatch).not.toHaveBeenCalled();
    computer.portalImports.mockResolvedValue({ [b.id]: receipt });
    expect(await batch.authorizeBatch(target)).toBe(true);
    expect(computer.authorizePortalBatch).toHaveBeenCalledTimes(1);
    expect((await batch.cancelBatch(actor("controller"), b.id)).ok).toBe(false);
    computer.portalRecords.mockResolvedValue([receipt]);
    await batch.finishBatch(target);
    const entries = await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId));
    expect(entries).toHaveLength(2);
    await batch.finishBatch(target);
    expect(await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId))).toHaveLength(2);
    for (const p of payouts) expect((await db.select().from(s.payout).where(eq(s.payout.id, p.id)))[0].status).toBe("processing");
    const paid = await services.runAuthorizedAction(actor("organizer"), "sponsor.reconcile", { id: b.evidence[0].packetId, paidMinor: "10000" });
    expect(paid.ok, paid.message).toBe(true);
    expect((await db.select().from(s.payout).where(eq(s.payout.id, b.evidence[0].payoutId)))[0].status).toBe("paid");
  });
  it("keeps a failed launch reserved and retries the same batch identity", async () => {
    const p = await proposed(); workflow.start.mockRejectedValueOnce(new Error("offline"));
    const result = await batch.releaseBatch(actor("controller"), { payouts: [p] });
    expect(result).toMatchObject({ ok: false, status: 503 });
    const id = String(result.data!.batchId);
    expect((await batch.batchesFor(orgId)).find((b) => b.id === id)).toMatchObject({ canRetry: true, count: 1 });
    const retry = await batch.retryBatch(actor("controller"), id);
    expect(retry.ok, retry.message).toBe(true);
    expect(retry.data!.batchId).toBe(id);
    await db.update(s.disbursementBatch).set({ status: "failed", state: { submissionAuthorized: true } }).where(eq(s.disbursementBatch.id, id));
    expect((await batch.retryBatch(actor("controller"), id)).ok).toBe(false);
    expect((await batch.cancelBatch(actor("controller"), id)).ok).toBe(false);
  });
});
