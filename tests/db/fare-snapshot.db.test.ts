import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

describe.skipIf(!hasDatabase)("market fare snapshots", { timeout: 120_000 }, () => {
  let orgId = "";
  let eventId = "";
  type Mods = Awaited<ReturnType<typeof load>>;
  let m: Mods;
  const now = new Date("2026-09-01T12:00:00Z");

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      fares: await import("@/lib/server/fares"),
      services: await import("@/lib/server/services"),
      core: await import("@/lib/server/core"),
    };
  }

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("fares");
    eventId = `${orgId}_evt`;
    await db.insert(s.event).values({ id: eventId, orgId, name: "Fare Hacks", startsAt: new Date("2026-10-24T16:00:00Z"), endsAt: new Date("2026-10-25T22:00:00Z"), venue: "San Francisco", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10T00:00:00Z"), checkInAt: new Date("2026-10-24T20:30:00Z"), closingAt: new Date("2026-10-25T22:00:00Z") });
    await db.insert(s.person).values({ id: `${orgId}_p`, orgId, eventId, name: "Wei Zhang", email: `wei.${orgId}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1998-05-14", address: "Seattle", adult: true, payoutCurrency: "USD" });
  }, 120_000);

  afterAll(async () => {
    if (orgId) await dropTestOrg(orgId);
  }, 120_000);

  it("captures simulated insights once a day per route, and not after the event starts", async () => {
    const { db, s, fares } = m;
    expect(await fares.captureFareInsights(orgId, "sea", { now, env: {} })).toBe("captured");
    expect(await fares.captureFareInsights(orgId, "SEA", { now, env: {} })).toBe("exists");
    expect(await fares.captureFareInsights(orgId, "SFO", { now, env: {} })).toBe("unavailable");
    expect(await fares.captureFareInsights(orgId, "not-an-airport", { now, env: {} })).toBe("unavailable");
    expect(await fares.captureFareInsights(orgId, "JFK", { now: new Date("2026-10-25T00:00:00Z"), env: {} })).toBe("event_started");
    const rows = await db.select().from(s.fareSnapshot).where(eq(s.fareSnapshot.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "SEA", destination: "SFO", kind: "insights", capturedOn: "2026-09-01", source: "fixture", truth: "Simulated" });
    expect(rows[0].history).toHaveLength(60);
  });

  it("flags a claim against the stored typical high and asks about it", async () => {
    const { db, s, services, core } = m;
    const id = `${orgId}_c`;
    await db.insert(s.claim).values({
      id, orgId, eventId, personId: `${orgId}_p`, type: "travel", merchant: "Alaska Airlines", category: "travel", amountMinor: 28500n, currency: "USD", usdMinor: 28500n,
      fxRate: "1.00000000", fxSource: "No conversion", purchasedAt: new Date("2026-09-20T14:00:00Z"), travelDate: new Date("2026-10-24T08:00:00Z"), cabin: "economy", origin: "SEA",
      nameOnReceipt: "Wei Zhang", receiptName: "alaska.pdf", receiptHash: `hash-${id}`, extracted: { source: "manual", corroborated: false, mismatches: [] },
      status: "submitted", dueAt: new Date("2026-10-27T00:00:00Z"), requestedBy: "seed",
    });
    await services.processClaimById(core.agentActor(orgId), id);
    const [claim] = await db.select().from(s.claim).where(eq(s.claim.id, id));
    const market = claim.checks.find((c) => c.code === "fare_market");
    expect(market?.passed, market?.detail).toBe(false);
    // No peers on this route, so only the market comparison speaks.
    expect(claim.checks.find((c) => c.code === "fare_peer")).toBeUndefined();
    expect(claim.status).toBe("needs_info");
    const review = (claim.extracted as { fareReview: { question: string; market: { basis: string; capturedOn: string; truth: string } } }).fareReview;
    expect(review.market).toMatchObject({ basis: "typical_high", capturedOn: "2026-09-01", truth: "Simulated" });
    expect(review.question).toMatch(/above the typical price for that route around your booking date/);
  });

  it("tracks the cheapest fare nightly for every origin in the event", async () => {
    const { db, s, fares } = m;
    const first = await fares.trackCheapestFares(orgId, { now, env: {} });
    expect(first).toMatchObject({ recorded: 1, existing: 0, failed: 0, eventStarted: false });
    expect((await fares.trackCheapestFares(orgId, { now, env: {} })).existing).toBe(1);
    expect((await fares.trackCheapestFares(orgId, { now: new Date("2026-09-02T12:00:00Z"), env: {} })).recorded).toBe(1);
    expect((await fares.trackCheapestFares(orgId, { now: new Date("2026-10-25T00:00:00Z"), env: {} })).eventStarted).toBe(true);
    const rows = await db.select().from(s.fareSnapshot).where(and(eq(s.fareSnapshot.eventId, eventId), eq(s.fareSnapshot.kind, "cheapest")));
    expect(rows.map((r) => [r.origin, r.capturedOn, r.lowestMinor])).toEqual(expect.arrayContaining([["SEA", "2026-09-01", 14900n], ["SEA", "2026-09-02", 14900n]]));
  });
});
