// Real HTTP + Workflow DevKit + Postgres acceptance check. Uses an isolated,
// disposable demo org and synthetic recipients; never resets the shared demo.
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";

loadEnvConfig(process.cwd());

async function main() {
  const base = process.env.EVE_LOCAL_URL ?? "http://localhost:3000";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "This check runs only against a local demo server.");
  const { getDb } = await import("../lib/db");
  const s = await import("../lib/db/schema");
  const { newId } = await import("../lib/db/ids");
  const { createDemoToken, DEMO_COOKIE } = await import("../lib/auth/session");
  const { purgeOrg } = await import("../lib/server/reset");
  const db = getDb();
  const orgId = newId("orgtest"), eventId = newId("event"), personId = newId("person"), organizerId = newId("member"), controllerId = newId("member"), awardId = newId("award");
  const action = async (memberId: string, name: string, payload: unknown) => {
    const response = await fetch(`${base}/api/actions`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${DEMO_COOKIE}=${createDemoToken(memberId, orgId)}` }, body: JSON.stringify({ action: name, payload }), signal: AbortSignal.timeout(120_000) });
    const body = await response.json();
    return { status: response.status, body };
  };
  async function until<T>(check: () => Promise<T | null>, label: string): Promise<T> {
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const result = await check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }
  try {
    await db.insert(s.organization).values({ id: orgId, slug: orgId, name: "Synthetic workflow acceptance", country: "US", mode: "direct", isDemo: true });
    await db.insert(s.event).values({ id: eventId, orgId, name: "Workflow acceptance", startsAt: new Date("2026-10-24"), endsAt: new Date("2026-10-26"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10"), checkInAt: new Date("2026-10-24"), closingAt: new Date("2026-10-26") });
    await db.insert(s.budgetLine).values({ id: newId("budget"), orgId, eventId, name: "Prizes", category: "prizes", capMinor: 1000000n, fundingSource: "Synthetic test funds" });
    await db.insert(s.person).values({ id: personId, orgId, eventId, name: "Synthetic Winner", email: "winner@example.test", country: "US", citizenship: "US", dateOfBirth: "2000-01-01", adult: true, payoutCurrency: "USD" });
    await db.insert(s.orgMember).values([
      { id: organizerId, orgId, role: "organizer", name: "Synthetic Organizer", email: "organizer@example.test", demoPersona: true },
      { id: controllerId, orgId, role: "controller", name: "Synthetic Controller", email: "controller@example.test", demoPersona: true },
    ]);
    await db.insert(s.taxProfile).values({ id: newId("tax"), orgId, personId, form: "W-9", status: "valid", signatureName: "Synthetic Winner", tinLast4: "1234", signedAt: new Date("2026-01-01") });
    await db.insert(s.payoutMethod).values({ id: newId("method"), orgId, personId, provider: "simulated", currency: "USD", last4: "4242", status: "active", version: 1, requestedBy: "attendee", verifiedAt: new Date() });
    await db.insert(s.award).values([awardId, newId("award")].map((id) => ({ id, orgId, eventId, personId, track: "Acceptance", title: "Synthetic prize", kind: "cash" as const, fulfillment: "cash" as const, amountMinor: 50000n, currency: "USD", status: "ready" as const, dueAt: new Date("2026-11-01"), requestedBy: organizerId })));
    const started = await action(organizerId, "agent.run", { kind: "claims" });
    assert.equal(started.status, 202, started.body.message);
    const runId = started.body.data.runId as string;
    console.log("Background run accepted through the real HTTP route.");
    const run = await until(async () => {
      const [row] = await db.select().from(s.agentRun).where(eq(s.agentRun.id, runId));
      if (row?.status === "failed") throw new Error(row.summary);
      return row?.status === "done" ? row : null;
    }, "durable review");
    assert.match(run.summary, /proposed 2 prize payout/);
    const payouts = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
    assert.equal(payouts.length, 2);
    const [payout] = await db.select().from(s.payout).where(and(eq(s.payout.orgId, orgId), eq(s.payout.awardId, awardId)));
    assert.equal(payout.status, "proposed");
    assert.equal(payout.releasedBy, null);
    const denied = await action(organizerId, "payout.release", { id: payout.id });
    assert.equal(denied.status, 403);
    console.log("Durable agent proposed the prize and could not release it; organizer release denied.");
    const accepted = await action(controllerId, "payout.release", { ids: payouts.map((p) => p.id) });
    assert.equal(accepted.status, 202, accepted.body.message);
    await until(async () => {
      const rows = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
      return rows.every((row) => row.status === "paid") ? rows : null;
    }, "controller hook release");
    const replay = await action(controllerId, "payout.release", { ids: payouts.map((p) => p.id) });
    assert.equal(replay.status, 200);
    const approvals = await db.select().from(s.approval).where(eq(s.approval.orgId, orgId));
    const journals = await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId));
    const requests = await db.select().from(s.decisionLog).where(and(eq(s.decisionLog.orgId, orgId), eq(s.decisionLog.tool, "queueControllerRelease")));
    assert.equal(approvals.length, 2);
    assert.equal(journals.length, 4);
    assert.equal(requests.length, 2);
    assert(requests.every((request) => request.actorRole === "controller" && request.facts.approverId === controllerId));
    console.log("Controller hooks paid the two-payout batch once; retry produced no extra approvals or journals. All money simulated.");
    const entered = await action(organizerId, "award.create", { personId, track: "Automatic event", title: "Winner-entry trigger", kind: "cash", amountMinor: "25000" });
    assert.equal(entered.status, 200, entered.body.message);
    const automaticAwardId = entered.body.data.ids[0] as string;
    const automatic = await until(async () => {
      const [row] = await db.select().from(s.payout).where(and(eq(s.payout.orgId, orgId), eq(s.payout.awardId, automaticAwardId)));
      return row ?? null;
    }, "automatic winner-entry review");
    assert.equal(automatic.status, "proposed");
    assert.equal(automatic.releasedBy, null);
    await until(async () => {
      const runs = await db.select().from(s.agentRun).where(and(eq(s.agentRun.orgId, orgId), eq(s.agentRun.kind, "awards")));
      return runs.some((row) => row.status === "done") ? true : null;
    }, "automatic review completion");
    console.log("Entering a winner triggered a durable payout proposal without pressing Run Eve; money stayed behind controller approval.");
  } finally {
    await db.transaction((tx) => purgeOrg(tx, orgId, { deleteOrg: true }));
    await db.$pool.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Workflow acceptance failed."); process.exitCode = 1; });
