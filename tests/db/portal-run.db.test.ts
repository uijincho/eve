import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

const workflow = vi.hoisted(() => ({ start: vi.fn(), resumeHook: vi.fn() }));
vi.mock("workflow/api", () => ({ ...workflow, getHookByToken: vi.fn() }));
vi.mock("@/workflows/sponsor-portal", () => ({ sponsorPortalWorkflow: vi.fn() }));
vi.mock("@/lib/computer-use/documents", () => ({ samplePdf: vi.fn(async () => new Uint8Array()) }));

// Use real row locks/unique indexes; stub the workflow service and PDF generation.
describe.skipIf(!hasDatabase)("portal run reservation and cancellation", { timeout: 60_000 }, () => {
  let orgId = "";
  let db: ReturnType<typeof import("@/lib/db").getDb>;
  let s: typeof import("@/lib/db/schema");
  let portal: typeof import("@/lib/computer-use/portal-run");
  const actor = () => ({ memberId: `${orgId}_organizer`, orgId, role: "organizer" as const, name: "Organizer", email: "organizer@example.test", personId: null, demo: false, userId: null });
  const packetId = () => `${orgId}_packet`;
  const rows = () => db.select().from(s.portalRun).where(eq(s.portalRun.orgId, orgId));

  beforeAll(async () => {
    db = (await import("@/lib/db")).getDb();
    s = await import("@/lib/db/schema");
    portal = await import("@/lib/computer-use/portal-run");
    // The workflow SDK is mocked; no E2B or Anthropic credentials are used.
    vi.stubEnv("E2B_API_KEY", "test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    vi.stubEnv("EVE_VAULT_KEY", "test");
    orgId = await createTestOrg("portal-reservation");
    const at = new Date();
    await db.insert(s.event).values({ id: `${orgId}_event`, orgId, name: "Test event", startsAt: at, endsAt: at, venue: "Test", travelCapMinor: 10000n, bookingDeadline: at, checkInAt: at, closingAt: at });
    await db.insert(s.person).values({ id: `${orgId}_person`, orgId, name: "Test payee", email: "payee@example.test", country: "CA", citizenship: "CA", dateOfBirth: "1995-01-01", adult: true });
    await db.insert(s.award).values({ id: `${orgId}_award`, orgId, eventId: `${orgId}_event`, personId: `${orgId}_person`, track: "Prize", title: "Test", kind: "cash", amountMinor: 10000n, dueAt: at, requestedBy: actor().memberId });
    await db.insert(s.payout).values({ id: `${orgId}_payout`, orgId, personId: `${orgId}_person`, sourceType: "award", awardId: `${orgId}_award`, grossMinor: 10000n, withholdingMinor: 0n, feeMinor: 0n, netMinor: 10000n, currency: "USD", destinationCurrency: "USD", destinationNetMinor: 10000n, fxRate: "1", provider: "simulated", truth: "Simulated", status: "proposed", ruleId: "test", ruleVersion: 1, ruleVerified: false, requestedBy: actor().memberId, idempotencyKey: orgId, dueAt: at });
    await db.insert(s.sponsorPacket).values({ id: packetId(), orgId, payoutId: `${orgId}_payout`, requestedMinor: 10000n, dueAt: at });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (orgId) await dropTestOrg(orgId);
  });

  it("releases the reservation after a failed launch and permits retry", async () => {
    workflow.start.mockRejectedValueOnce(new Error("Workflow service unavailable"));
    expect(await portal.startPortalRun(actor(), packetId())).toMatchObject({ ok: false, status: 503 });
    expect((await rows())[0]).toMatchObject({ status: "failed", workflowRunId: null, stopRequested: true });
    workflow.start.mockResolvedValue({ runId: "workflow-test" });
    expect(await portal.startPortalRun(actor(), packetId())).toMatchObject({ ok: true, status: 202 });
    const active = (await rows()).filter((r) => r.status === "starting");
    expect(active).toHaveLength(1);
    expect(await portal.startPortalRun(actor(), packetId())).toMatchObject({ ok: false, status: 409 });
  });

  it("delivers a stop to the hook even before the run enters its approval wait", async () => {
    const active = (await rows()).find((r) => r.status === "starting")!;
    await db.update(s.portalRun).set({ status: "filling" }).where(eq(s.portalRun.id, active.id));
    workflow.resumeHook.mockResolvedValue(undefined);
    expect(await portal.stopPortalRun(actor(), active.id)).toMatchObject({ ok: true, status: 202 });
    expect(workflow.resumeHook).toHaveBeenCalledWith(portal.portalToken({ orgId, portalRunId: active.id }), expect.objectContaining({ decision: "reject", memberId: actor().memberId }));
    expect((await rows()).find((r) => r.id === active.id)?.stopRequested).toBe(true);
    await db.update(s.portalRun).set({ status: "stopped" }).where(eq(s.portalRun.id, active.id));
  });

  it("rechecks the draft under the packet lock when a manual submission wins", async () => {
    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const manual = db.transaction(async (tx) => {
      await tx.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.id, packetId())).for("update");
      await tx.update(s.sponsorPacket).set({ status: "submitted" }).where(eq(s.sponsorPacket.id, packetId()));
      locked();
      await release;
    });
    await acquired;
    const before = workflow.start.mock.calls.length;
    let packetRead!: () => void;
    const read = new Promise<void>((resolve) => { packetRead = resolve; });
    const { samplePdf } = await import("@/lib/computer-use/documents");
    vi.mocked(samplePdf).mockImplementationOnce(async () => {
      packetRead();
      return new Uint8Array();
    });
    const starting = portal.startPortalRun(actor(), packetId());
    // The packet loader has read the old draft before the other transaction commits.
    try {
      await Promise.race([read, starting.then(() => { throw new Error("Start returned before loading the draft packet."); })]);
    } finally {
      unlock();
      await manual;
    }
    expect(await starting).toMatchObject({ ok: false, status: 409 });
    expect(workflow.start).toHaveBeenCalledTimes(before);
    expect((await rows()).some((r) => (s.PORTAL_RUN_ACTIVE as readonly string[]).includes(r.status))).toBe(false);
  });
});
