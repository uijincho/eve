// Real HTTP + Workflow DevKit + Postgres + E2B + Claude acceptance check for Eve filling the
// sponsor portal. Uses an isolated, disposable org with a synthetic Canadian winner; never touches
// the shared demo. Needs `pnpm dev` running. Spends E2B and Anthropic credits (about 4 minutes).
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { and, desc, eq } from "drizzle-orm";

loadEnvConfig(process.cwd());

async function main() {
  const base = process.env.EVE_LOCAL_URL ?? "http://localhost:3000";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "This check runs only against a local server.");
  const { getDb } = await import("../lib/db");
  const s = await import("../lib/db/schema");
  const { newId } = await import("../lib/db/ids");
  const { createDemoToken, DEMO_COOKIE } = await import("../lib/auth/session");
  const { purgeOrg } = await import("../lib/server/reset");
  const { Sandbox } = await import("@e2b/desktop");
  const db = getDb();
  const orgId = newId("orgtest"), eventId = newId("event"), personId = newId("person"), organizerId = newId("member"), controllerId = newId("member"), awardId = newId("award");
  const started = Date.now();
  const action = async (memberId: string, name: string, payload: unknown) => {
    const response = await fetch(`${base}/api/actions`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${DEMO_COOKIE}=${createDemoToken(memberId, orgId)}` }, body: JSON.stringify({ action: name, payload }), signal: AbortSignal.timeout(120_000) });
    return { status: response.status, body: await response.json() as { ok: boolean; message: string; data?: Record<string, unknown> } };
  };
  async function until<T>(check: () => Promise<T | null>, label: string, limitMs: number): Promise<T> {
    const end = Date.now() + limitMs;
    while (Date.now() < end) {
      const result = await check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }
  const portalRun = async (packetId: string) => (await db.select().from(s.portalRun).where(eq(s.portalRun.packetId, packetId)).orderBy(desc(s.portalRun.createdAt)).limit(1))[0];
  let printed = 0;
  const progress = async (runId: string | null) => {
    if (!runId) return;
    const steps = await db.select().from(s.decisionLog).where(eq(s.decisionLog.runId, runId)).orderBy(s.decisionLog.createdAt);
    for (; printed < steps.length; printed++) console.log(`  ${steps[printed].status.padEnd(9)} ${steps[printed].summary.slice(0, 130)}`);
  };

  try {
    await db.insert(s.organization).values({ id: orgId, slug: orgId, name: "Synthetic portal acceptance", country: "US", mode: "hybrid", isDemo: true, sponsorName: "Synthetic Community Foundation" });
    await db.insert(s.event).values({ id: eventId, orgId, name: "Portal acceptance", startsAt: new Date("2026-10-24"), endsAt: new Date("2026-10-26"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10"), checkInAt: new Date("2026-10-24"), closingAt: new Date("2026-10-26") });
    await db.insert(s.budgetLine).values({ id: newId("budget"), orgId, eventId, name: "Prizes", category: "prizes", capMinor: 1000000n, fundingSource: "Synthetic test funds" });
    await db.insert(s.person).values({ id: personId, orgId, eventId, name: "Synthetic Winner", email: "winner@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2000-01-01", adult: true, payoutCurrency: "USD" });
    await db.insert(s.orgMember).values([
      { id: organizerId, orgId, role: "organizer", name: "Synthetic Organizer", email: "organizer@example.test", demoPersona: true },
      { id: controllerId, orgId, role: "controller", name: "Synthetic Controller", email: "controller@example.test", demoPersona: true },
    ]);
    await db.insert(s.taxProfile).values({ id: newId("tax"), orgId, personId, form: "W-8BEN", status: "valid", signatureName: "Synthetic Winner", signedAt: new Date("2026-01-01"), expiresAt: new Date("2029-12-31"), treatyCountry: "CA" });
    await db.insert(s.payoutMethod).values({ id: newId("method"), orgId, personId, provider: "simulated", currency: "USD", last4: "4242", status: "active", version: 1, requestedBy: "attendee", verifiedAt: new Date() });
    await db.insert(s.award).values({ id: awardId, orgId, eventId, personId, track: "Acceptance", title: "Synthetic prize", kind: "cash", fulfillment: "cash", amountMinor: 50000n, currency: "USD", status: "ready", dueAt: new Date("2026-11-01"), requestedBy: organizerId });

    const proposed = await action(organizerId, "payout.propose", { sourceType: "award", sourceId: awardId });
    assert.equal(proposed.status, 200, proposed.body.message);
    const [payout] = await db.select().from(s.payout).where(and(eq(s.payout.orgId, orgId), eq(s.payout.awardId, awardId)));
    assert.equal(payout.status, "proposed", `payout should be proposed: ${payout.reason}`);
    const packet = await action(organizerId, "sponsor.create", { payoutId: payout.id });
    assert.equal(packet.status, 200, packet.body.message);
    const packetId = String(packet.body.data?.id);
    console.log(`Packet ${packetId}: ${packet.body.message}`);

    const start = await action(organizerId, "sponsor.portalStart", { id: packetId });
    assert.equal(start.status, 202, start.body.message);
    const runId = String(start.body.data?.runId);
    const twice = await action(organizerId, "sponsor.portalStart", { id: packetId });
    assert.equal(twice.status, 409, "a second live run on the same packet is refused");
    console.log("Portal run started through the real HTTP route; a second start was refused.");

    const waiting = await until(async () => {
      await progress(runId);
      const run = await portalRun(packetId);
      if (run && !(s.PORTAL_RUN_ACTIVE as readonly string[]).includes(run.status)) throw new Error(`The run ended ${run.status}: ${run.error ?? JSON.stringify(run.escalation)}`);
      return run?.status === "awaiting_approval" ? run : null;
    }, "Eve to stop on Review", 10 * 60_000);
    assert.ok(waiting.pagesVisited.includes("documents") && waiting.pagesVisited.includes("review"));
    const mismatches = (waiting.reviewCheck ?? []).filter((c) => !c.ok);
    assert.ok(waiting.reviewCheck?.length, "the Review page was read back");
    assert.equal(mismatches.length, 0, `Review page matches the packet: ${JSON.stringify(mismatches)}`);
    const steps = await db.select().from(s.decisionLog).where(eq(s.decisionLog.runId, runId));
    assert.ok(steps.filter((d) => d.tool === "portalAgent" && d.documentId).length >= 5, "each turn is logged with its screenshot");
    assert.ok(steps.some((d) => JSON.stringify(d.facts).includes("W-8BEN attached")), "the portal's W-8BEN rejection is in the decision log");
    const [stillDraft] = await db.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.id, packetId));
    assert.equal(stillDraft.status, "draft", "nothing is submitted before approval");

    const organizerDecides = await action(organizerId, "sponsor.portalDecide", { id: waiting.id, decision: "approve" });
    assert.equal(organizerDecides.status, 403, "an organizer cannot approve the submission");
    const manual = await action(controllerId, "sponsor.submit", { id: packetId });
    assert.equal(manual.status, 409, "the manual submit is blocked while Eve owns the packet");
    const approve = await action(controllerId, "sponsor.portalDecide", { id: waiting.id, decision: "approve" });
    assert.equal(approve.status, 202, approve.body.message);
    console.log("Organizer approval refused (403), manual submit blocked (409), controller approved (202).");

    const done = await until(async () => {
      await progress(runId);
      const run = await portalRun(packetId);
      if (run && ["failed", "escalated", "rejected", "stopped"].includes(run.status)) throw new Error(`The run ended ${run.status}: ${run.error ?? ""}`);
      // Done means submitted in Eve's books and the desktop closed: the last two steps of the workflow.
      const decided = run?.status === "submitted" && (await db.select().from(s.decisionLog).where(and(eq(s.decisionLog.runId, runId), eq(s.decisionLog.action, "portal.submitted")))).length > 0;
      return decided && run.streamUrl === null ? run : null;
    }, "the portal submission", 5 * 60_000);
    await progress(runId);
    assert.match(done.confirmation ?? "", /^WB-26-\d{5}$/);
    assert.equal(done.approvedBy, controllerId);
    assert.equal(done.streamUrl, null, "the live view is cleared");
    const [submitted] = await db.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.id, packetId));
    assert.equal(submitted.status, "submitted");
    assert.ok(submitted.reason.includes(done.confirmation!), "the packet carries the portal confirmation");
    const [released] = await db.select().from(s.payout).where(eq(s.payout.id, payout.id));
    assert.equal(released.status, "processing");
    assert.equal(released.provider, "sponsor_packet");
    assert.equal(released.releasedBy, controllerId, "released as the approving controller");
    const journal = await db.select().from(s.journalEntry).where(and(eq(s.journalEntry.orgId, orgId), eq(s.journalEntry.sourceId, payout.id)));
    assert.ok(journal.length >= 1, "the accrual posted");
    // The derived portal password never reaches the stored conversation or the decision log.
    const { portalPassword } = await import("../lib/computer-use/portal-run");
    const { MODEL } = await import("../lib/computer-use/agent");
    const secret = portalPassword(done.id);
    const logged = await db.select().from(s.decisionLog).where(eq(s.decisionLog.runId, runId));
    assert.ok(!JSON.stringify(done.state).includes(secret), "the portal password is not in the saved conversation");
    assert.ok(!JSON.stringify(logged).includes(secret), "the portal password is not in the decision log");
    const turns = logged.filter((d) => d.action === "portal.turn");
    assert.ok(turns.every((d) => d.facts.model === MODEL || d.facts.fellBackFrom), `every turn records ${MODEL} as the model that answered`);
    console.log(`Password absent from ${turns.length} turns of conversation and log; every turn answered by ${MODEL}.`);
    if (done.sandboxId) {
      const running = await Sandbox.list({ query: { state: ["running"] } }).nextItems().catch(() => []);
      assert.ok(!running.some((x) => x.sandboxId === done.sandboxId), "the desktop is deleted");
    }
    console.log(JSON.stringify({ ok: true, packetId, confirmation: done.confirmation, turns: done.turns, seconds: Math.round((Date.now() - started) / 1000), usage: done.usage }, null, 2));
  } finally {
    // A failed assertion or interrupted workflow must not leave a billable desktop
    // behind when the disposable organization's rows are removed.
    const desktops = await db.select({ sandboxId: s.portalRun.sandboxId }).from(s.portalRun).where(eq(s.portalRun.orgId, orgId));
    await Promise.all(desktops.flatMap((r) => r.sandboxId ? [Sandbox.kill(r.sandboxId).catch(() => false)] : []));
    await db.transaction((tx) => purgeOrg(tx, orgId, { deleteOrg: true }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
