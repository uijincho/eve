/** Real HTTP + Workflow + Browser Use acceptance check with a disposable demo organization. */
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";

loadEnvConfig(process.cwd());

async function main() {
  const base = process.env.EVE_LOCAL_URL || "http://localhost:3006";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Run this check against a local server exposed by a temporary HTTPS tunnel.");
  const { getDb } = await import("../lib/db");
  const s = await import("../lib/db/schema");
  const { newId } = await import("../lib/db/ids");
  const { createDemoToken, DEMO_COOKIE } = await import("../lib/auth/session");
  const { runAuthorizedAction } = await import("../lib/server/services");
  const { batchQuoteKey } = await import("../lib/disbursement");
  const { purgeOrg } = await import("../lib/server/reset");
  const { closeCloudBatch } = await import("../lib/browser-use/batch");
  const { getRun } = await import("workflow/api");
  const db = getDb();
  const orgId = newId("orgtest"), eventId = newId("event"), organizerId = newId("member"), controllerId = newId("member");
  let batchId = "", runId = "";
  try {
    await db.insert(s.organization).values({ id: orgId, slug: orgId, name: "Synthetic Browser Use acceptance", country: "US", mode: "sponsor", sponsorName: "Fictional Westbrook", isDemo: true });
    const now = new Date();
    await db.insert(s.event).values({ id: eventId, orgId, name: "Cloud acceptance", startsAt: now, endsAt: now, venue: "Test", travelCapMinor: 50000n, bookingDeadline: now, checkInAt: now, closingAt: now });
    await db.insert(s.orgMember).values([
      { id: organizerId, orgId, role: "organizer", name: "Test Organizer", email: "organizer@example.test", demoPersona: true },
      { id: controllerId, orgId, role: "controller", name: "Test Controller", email: "controller@example.test", demoPersona: true },
    ]);
    const actor = { memberId: organizerId, orgId, role: "organizer" as const, name: "Test Organizer", email: "organizer@example.test", personId: null, userId: null, demo: true };
    for (let i = 1; i <= 2; i++) {
      const personId = newId("person"), awardId = newId("award");
      await db.insert(s.person).values({ id: personId, orgId, eventId, name: `Synthetic Recipient ${i}`, email: `recipient${i}@example.test`, country: "US", citizenship: "US", dateOfBirth: "2000-01-01", adult: true, payoutCurrency: "USD" });
      await db.insert(s.taxProfile).values({ id: newId("tax"), orgId, personId, form: "W-9", status: "valid", signatureName: `Synthetic Recipient ${i}`, tinLast4: "1234", signedAt: now });
      await db.insert(s.payoutMethod).values({ id: newId("method"), orgId, personId, currency: "USD", last4: "4242", status: "active", version: 1, requestedBy: "seed", verifiedAt: now });
      await db.insert(s.award).values({ id: awardId, orgId, eventId, personId, track: "Acceptance", title: "Synthetic prize", kind: "cash", fulfillment: "cash", amountMinor: 1000n, currency: "USD", status: "ready", dueAt: now, requestedBy: organizerId });
      const proposed = await runAuthorizedAction(actor, "payout.propose", { sourceType: "award", sourceId: awardId });
      assert(proposed.ok, proposed.message);
    }
    const payouts = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
    const response = await fetch(`${base}/api/actions`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${DEMO_COOKIE}=${createDemoToken(controllerId, orgId)}` },
      body: JSON.stringify({ action: "sponsor.batchRelease", payload: { payouts: payouts.map((p) => ({ id: p.id, quote: batchQuoteKey(p) })) } }), signal: AbortSignal.timeout(120_000) });
    const result = await response.json();
    assert.equal(response.status, 202, result.message);
    batchId = result.data.batchId; runId = result.data.runId;
    console.log(`Accepted synthetic two-payment batch ${batchId}.`);
    const deadline = Date.now() + 10 * 60_000;
    let previous = "";
    while (Date.now() < deadline) {
      const [batch] = await db.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, batchId));
      const state = batch.state as Record<string, unknown> | null;
      const progress = `${batch.status}${state?.runId ? ` cloud=${state.runId}` : ""}`;
      if (progress !== previous) { console.log(progress); previous = progress; }
      if (batch.status === "failed") throw new Error(batch.error || "Cloud batch failed.");
      if (batch.status === "submitted") {
        assert(batch.confirmation);
        const rows = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
        assert(rows.every((p) => p.status === "processing"));
        const entries = await db.select().from(s.journalEntry).where(eq(s.journalEntry.orgId, orgId));
        assert.equal(entries.length, 2);
        console.log(`Verified ${batch.confirmation}: one cloud run, two processing payouts, two accruals. No real funds moved.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Timed out waiting for Browser Use.");
  } finally {
    if (runId) await getRun(runId).cancel().catch(() => undefined);
    if (batchId) await closeCloudBatch({ orgId, batchId }).catch(() => undefined);
    await db.transaction((tx) => purgeOrg(tx, orgId, { deleteOrg: true }));
    await db.$pool.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
