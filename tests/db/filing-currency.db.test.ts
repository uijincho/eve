import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { startingRules } from "@/lib/engines";
import { buildSnapshot } from "@/lib/server/snapshot";
import { generateFilings } from "@/lib/server/filings";
import type { ActorContext } from "@/lib/auth/session";

describe.skipIf(!hasDatabase)("CAD reports and USD functional books", { timeout: 90_000 }, () => {
  const db = getDb();
  let orgId = "";
  let actor: ActorContext;
  beforeAll(async () => {
    orgId = await createTestOrg("cad-report");
    await db.update(s.organization).set({ country: "CA", currency: "CAD" }).where(eq(s.organization.id, orgId));
    const eventId = `${orgId}_event`;
    actor = { orgId, memberId: `${orgId}_controller`, role: "controller", name: "Synthetic Controller", email: "controller@example.test", personId: null, userId: null, demo: false };
    await db.insert(s.orgMember).values({ id: actor.memberId, orgId, role: actor.role, name: actor.name, email: actor.email });
    await db.insert(s.event).values({ id: eventId, orgId, name: "Synthetic CAD event", startsAt: new Date("2026-10-24"), endsAt: new Date("2026-10-26"), venue: "Toronto", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10"), checkInAt: new Date("2026-10-24"), closingAt: new Date("2026-10-26") });
    await db.insert(s.budgetLine).values({ id: `${orgId}_budget`, orgId, eventId, name: "Prizes", category: "prizes", capMinor: 200000n, fundingSource: "Synthetic" });
    await db.insert(s.fxRate).values({ rateDate: "2026-09-01", base: "CAD", quote: "USD", rate: "0.72876000", source: "Synthetic reference" }).onConflictDoNothing();
    await db.insert(s.taxRule).values(startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor) }))).onConflictDoNothing();
    for (const [suffix, country] of [["resident", "CA"], ["nonresident", "US"]]) {
      const personId = `${orgId}_${suffix}`;
      await db.insert(s.person).values({ id: personId, orgId, eventId, name: `Synthetic ${suffix}`, email: `${suffix}@example.test`, country, citizenship: country, adult: true, dateOfBirth: "2000-01-01" });
      const awardId = `${personId}_award`;
      const grossCad = suffix === "resident" ? 100001n : 2n;
      const grossUsd = suffix === "resident" ? 72877n : 1n;
      await db.insert(s.award).values({ id: awardId, orgId, eventId, personId, track: "Synthetic", title: "CAD prize", kind: "cash", fulfillment: "cash", amountMinor: grossCad, currency: "CAD", status: "paid", dueAt: new Date("2026-10-24"), requestedBy: "synthetic-organizer" });
      await db.insert(s.payout).values({ id: `${personId}_payout`, orgId, personId, sourceType: "award", awardId, grossMinor: grossUsd, withholdingMinor: 0n, feeMinor: 0n, netMinor: grossUsd, currency: "USD", destinationCurrency: "CAD", destinationNetMinor: grossCad, fxRate: "1", provider: "mock_wire", truth: "Simulated", status: "paid", ruleId: country === "CA" ? "ca-ca-prize" : "ca-nonca-prize", ruleVersion: 1, ruleVerified: false, reportingForm: country === "CA" ? "T4A (box to verify)" : "NR4 (to verify)", reportable: true, requestedBy: "synthetic-organizer", releasedBy: actor.memberId, idempotencyKey: `${personId}_paid`, dueAt: new Date("2026-10-24"), paidAt: new Date("2026-10-24T12:00:00Z") });
    }
    await db.insert(s.award).values({ id: `${orgId}_unpaid`, orgId, eventId, personId: `${orgId}_resident`, track: "Synthetic", title: "CAD pending prize", kind: "cash", fulfillment: "cash", amountMinor: 100000n, currency: "CAD", status: "ready", dueAt: new Date("2026-10-24"), requestedBy: "synthetic-organizer" });
  }, 90_000);
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); }, 90_000);

  it("stores CRA drafts in CAD and preserves original cents despite USD rounding", async () => {
    const result = await db.transaction((tx) => generateFilings(tx, actor, { year: 2026 }));
    expect(result.data.count).toBe(2);
    const rows = await db.select().from(s.filing).where(eq(s.filing.orgId, orgId));
    expect(rows.find((f) => f.form === "T4A")?.grossMinor).toBe(100001n);
    // 2 CAD cents rounds to 1 USD cent; a round trip would incorrectly report only 1 CAD cent.
    expect(rows.find((f) => f.form === "NR4")?.grossMinor).toBe(2n);
    expect(rows.every((f) => f.status === "draft" && f.documentId)).toBe(true);
    for (const f of rows) {
      const [doc] = await db.select().from(s.document).where(eq(s.document.id, f.documentId!));
      expect(Buffer.from(doc.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("reports budget caps, commitments and spent in USD while retaining CAD input values", async () => {
    const snapshot = await buildSnapshot(actor);
    expect(snapshot.org.currency).toBe("CAD");
    expect(snapshot.org.booksCurrency).toBe("USD");
    expect(snapshot.people.every((p) => p.taxForm === "Residency declaration" && p.taxStatus === "missing")).toBe(true);
    expect(snapshot.budgets[0]).toMatchObject({ currency: "USD", capMinor: "145752", spentMinor: "72878", committedMinor: "72876", enteredCurrency: "CAD", enteredCapMinor: "200000" });
    expect(snapshot.filings.map((f) => f.currency)).toEqual(["CAD", "CAD"]);
    expect(snapshot.people.find((p) => p.id.endsWith("_resident"))?.paidYtdMinor).toBe("72877");
  });
});
