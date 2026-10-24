import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestOrg, dropTestOrg, hasDatabase } from "./helpers";
import { getDb } from "../../lib/db";
import { newId } from "../../lib/db/ids";
import * as s from "../../lib/db/schema";
import { recordDailyDigest } from "../../lib/agent/digest";

describe.skipIf(!hasDatabase)("daily finance follow-up", { timeout: 60_000 }, () => {
  let orgId = "", generation = "", overdueId = "";
  const now = new Date("2026-10-24T10:00:00Z");
  let db: ReturnType<typeof getDb>;
  beforeAll(async () => {
    db = getDb();
    orgId = await createTestOrg("digest");
    const [org] = await db.select().from(s.organization).where(eq(s.organization.id, orgId));
    generation = org.createdAt.toISOString();
    const eventId = newId("event"), personId = newId("person");
    await db.insert(s.event).values({ id: eventId, orgId, name: "Synthetic digest event", startsAt: now, endsAt: new Date("2026-10-25T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: now, checkInAt: now, closingAt: now });
    await db.insert(s.person).values({ id: personId, orgId, eventId, name: "Synthetic Recipient", email: "digest@example.test", country: "US", citizenship: "US", dateOfBirth: "2000-01-01", adult: true });
    for (const [index, status, dueAt] of [[0, "submitted", "2026-10-20"], [1, "paid", "2026-10-20"], [2, "submitted", "2026-11-20"]] as const) {
      const awardId = newId("award"), payoutId = newId("payout"), packetId = newId("packet");
      await db.insert(s.award).values({ id: awardId, orgId, eventId, personId, track: "Test", title: "Test", kind: "cash", amountMinor: 10000n, dueAt: now, requestedBy: "requester" });
      await db.insert(s.payout).values({ id: payoutId, orgId, personId, sourceType: "award", awardId, grossMinor: 10000n, withholdingMinor: 0n, feeMinor: 0n, netMinor: 10000n, currency: "USD", destinationCurrency: "USD", destinationNetMinor: 10000n, fxRate: "1", provider: "sponsor_packet", truth: "Simulated", status: status === "paid" ? "paid" : "processing", ruleId: "test", ruleVersion: 1, ruleVerified: true, requestedBy: "requester", idempotencyKey: `${orgId}:${index}`, dueAt: now });
      await db.insert(s.sponsorPacket).values({ id: packetId, orgId, payoutId, requestedMinor: 10000n, status, dueAt: new Date(dueAt), submittedAt: new Date("2026-10-10") });
      if (index === 0) overdueId = packetId;
    }
  }, 60_000);
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); }, 60_000);

  it("deduplicates concurrent daily runs and excludes settled or not-yet-due packets", async () => {
    const [first, retry] = await Promise.all([recordDailyDigest(orgId, generation, now), recordDailyDigest(orgId, generation, now)]);
    expect(first).toEqual(retry);
    expect(first).toHaveLength(2);
    const notices = await db.select().from(s.notice).where(eq(s.notice.orgId, orgId));
    const decisions = await db.select().from(s.decisionLog).where(eq(s.decisionLog.orgId, orgId));
    expect(notices).toHaveLength(2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].objectId).toBe(overdueId);
    expect(decisions[0].facts).toMatchObject({ overdueDays: 4, automatedSponsorContact: false });
  });

  it("stops follow-ups after settlement and ignores an obsolete organization generation", async () => {
    await db.update(s.sponsorPacket).set({ status: "paid" }).where(and(eq(s.sponsorPacket.orgId, orgId), eq(s.sponsorPacket.id, overdueId)));
    expect(await recordDailyDigest(orgId, generation, new Date("2026-10-25T10:00:00Z"))).toHaveLength(1);
    expect(await recordDailyDigest(orgId, "old-generation", now)).toEqual([]);
    expect(await db.select().from(s.decisionLog).where(eq(s.decisionLog.orgId, orgId))).toHaveLength(1);
  });
});
