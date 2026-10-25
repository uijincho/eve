import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";
import { batchQuoteKey } from "@/lib/disbursement";

const computer = vi.hoisted(() => ({ portalImports: vi.fn(), portalRecords: vi.fn(), authorizePortalBatch: vi.fn() }));
vi.mock("@/lib/computer-use/computer", async (original) => ({ ...await original<typeof import("@/lib/computer-use/computer")>(), ...computer }));
vi.mock("@e2b/desktop", () => ({ Sandbox: { connect: vi.fn(async () => ({})), kill: vi.fn() } }));
const workflow = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "bulk-workflow" })) }));
const cloud = vi.hoisted(() => ({ cloudRequest: vi.fn(), uploadBundle: vi.fn() }));
vi.mock("@/lib/browser-use/client", async (original) => ({ ...await original<typeof import("@/lib/browser-use/client")>(), ...cloud }));
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
    vi.stubEnv("BROWSER_USE_API_KEY", "unused"); vi.stubEnv("EVE_APP_URL", "https://eve.example.test");
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
    // Exact release terms must still be enforced by the single policy pass.
    const [original] = await db.select().from(s.payout).where(eq(s.payout.id, payouts[0].id));
    await db.update(s.payout).set({ bankVersion: original.bankVersion! + 1 }).where(eq(s.payout.id, original.id));
    await expect(batch.authorizeBatch(target)).rejects.toThrow(/re-quoted/);
    expect(computer.authorizePortalBatch).not.toHaveBeenCalled();
    expect((await batch.batchesFor(orgId)).find((row) => row.id === b.id)).toMatchObject({ validating: true });
    await db.update(s.payout).set({ bankVersion: original.bankVersion }).where(eq(s.payout.id, original.id));
    // Concurrent/replayed deliveries can both observe "filling" before either
    // gets the finance lock. The second must reuse the first authorization.
    expect(await Promise.all([batch.authorizeBatch(target), batch.authorizeBatch(target)])).toEqual([true, true]);
    expect(computer.authorizePortalBatch).toHaveBeenCalledTimes(2);
    expect((await batch.cancelBatch(actor("controller"), b.id)).ok).toBe(false);
    computer.portalRecords.mockResolvedValue([receipt]);
    // A policy change after portal authorization must roll back all local
    // settlement, even when an earlier payment in the batch already passed.
    const [last] = await db.select().from(s.payout).where(eq(s.payout.id, payouts[1].id));
    await db.update(s.payout).set({ bankVersion: last.bankVersion! + 1 }).where(eq(s.payout.id, last.id));
    await expect(batch.finishBatch(target)).rejects.toThrow(/re-quoted/);
    expect(await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId))).toHaveLength(0);
    expect((await db.select().from(s.payout).where(eq(s.payout.id, original.id)))[0].status).toBe("proposed");
    await db.update(s.payout).set({ bankVersion: last.bankVersion }).where(eq(s.payout.id, last.id));
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
  it("runs one cloud task and accepts only the unchanged authorized bundle through the private portal", async () => {
    const { preflightCloudBatch, startCloudBatch, pollCloudBatch, finishCloudBatch, closeCloudBatch } = await import("@/lib/browser-use/batch");
    const { handleBatchPortal } = await import("@/lib/browser-use/portal");
    const { cloudState, portalKey } = await import("@/lib/browser-use/state");
    const payouts = [await proposed(), await proposed()];
    const released = await batch.releaseBatch(actor("controller"), { payouts });
    expect(released.ok, released.message).toBe(true);
    const target = { orgId, batchId: String(released.data!.batchId) };
    await batch.beginBatch(target, "cloud-test");
    for (const p of payouts) await batch.prepareBatchItem(target, p.id);
    await batch.prepareBatchBundle(target);
    expect(await preflightCloudBatch(target)).toBe(true);
    cloud.cloudRequest.mockImplementation(async (path: string) => {
      if (path === "/workspaces") return { id: "workspace-test" };
      if (path === "/runs") return { id: "run-test", sessionId: "session-test", workspaceId: "workspace-test", status: "running" };
      if (path.endsWith("/status")) return { status: "running" };
      if (path.includes("/events")) return { events: [{ id: 1, type: "browser.ready", data: { live_view_url: "https://live.browser-use.com/test", browser_session_id: "browser-test" } }], nextAfter: 1, hasMore: false };
      return {};
    });
    cloud.uploadBundle.mockResolvedValue({ id: "file-test", path: "uploads/batch.zip" });
    await startCloudBatch(target);
    await startCloudBatch(target);
    expect(cloud.cloudRequest.mock.calls.filter(([path]) => path === "/runs")).toHaveLength(1);
    expect(await pollCloudBatch(target)).toBe("continue");
    const [b] = await db.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, target.batchId));
    const state = cloudState(b.state)!;
    const token = portalKey(b.id, state.attempt, "link");
    const base = `https://eve.example.test/api/sponsor-portal/${b.id}/${token}`;
    let cookie = "";
    const call = (endpoint: string, body: BodyInit, contentType = "application/json") => handleBatchPortal(new Request(`${base}/${endpoint}`, {
      method: "POST", headers: { "content-type": contentType, cookie, origin: "https://eve.example.test" }, body,
    }), { batchId: b.id, token, path: endpoint.split("/") });
    expect((await call("api/bulk-submit", JSON.stringify({ batchId: b.id }))).status).toBe(401);
    expect((await handleBatchPortal(new Request(base), { batchId: b.id, token: "wrong" })).status).toBe(404);
    // A proxy may give Next an internal URL while the browser sends the public Origin.
    const login = await handleBatchPortal(new Request(`http://localhost:3006${new URL(base).pathname}/api/login`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://eve.example.test" },
      body: JSON.stringify({ username: "eve.calhacks", password: portalKey(b.id, state.attempt, "login") }),
    }), { batchId: b.id, token, path: ["api", "login"] });
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await call("api/bulk-submit", JSON.stringify({ batchId: b.id }))).status).toBe(409);
    expect((await call("api/bulk-import", "wrong zip", "application/zip")).status).toBe(422);
    const [doc] = await db.select().from(s.document).where(eq(s.document.id, b.documentId!));
    const imported = await call("api/bulk-import", new Uint8Array(doc.bytes).buffer, "application/zip");
    expect(imported.status).toBe(200);
    expect((await imported.json()).manifestHash).toBe(b.manifestHash);
    const [p] = await db.select().from(s.payout).where(eq(s.payout.id, payouts[0].id));
    await db.update(s.payout).set({ bankVersion: p.bankVersion! + 1 }).where(eq(s.payout.id, p.id));
    expect((await call("api/bulk-submit", JSON.stringify({ batchId: b.id }))).status).toBe(409);
    await db.update(s.payout).set({ bankVersion: p.bankVersion }).where(eq(s.payout.id, p.id));
    const submissions = await Promise.all([call("api/bulk-submit", JSON.stringify({ batchId: b.id })), call("api/bulk-submit", JSON.stringify({ batchId: b.id }))]);
    expect(submissions.map((r) => r.status)).toEqual([200, 200]);
    const receipts = await Promise.all(submissions.map((r) => r.json()));
    expect(receipts[0].confirmation).toBe(receipts[1].confirmation);
    expect(await pollCloudBatch(target)).toBe("submitted");
    await finishCloudBatch(target);
    await finishCloudBatch(target);
    expect((await batch.batchesFor(orgId)).find((row) => row.id === b.id)).toMatchObject({ status: "submitted", provider: "browser-use" });
    for (const row of payouts) expect((await db.select().from(s.payout).where(eq(s.payout.id, row.id)))[0].status).toBe("processing");
    await closeCloudBatch(target);
    expect(cloud.cloudRequest).toHaveBeenCalledWith("/runs/run-test/cancel", {});
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
