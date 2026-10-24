import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

// A real organization whose event is not Cal Hacks weekend: fixture fares must
// be timed to it, go to its city, and stay bound to it at request time.
describe.skipIf(!hasDatabase)("event-relative flight offers against real Postgres", { timeout: 120_000 }, () => {
  let orgId = "";
  let m: Awaited<ReturnType<typeof load>>;
  const ids = { kim: "", kimMember: "", organizer: "" };

  async function load() {
    return { db: (await import("@/lib/db")).getDb(), s: await import("@/lib/db/schema"), services: await import("@/lib/server/services") };
  }
  const kim = () => ({ memberId: ids.kimMember, orgId, role: "attendee" as const, name: "Kim", email: `kim.${orgId}@example.com`, personId: ids.kim, demo: false, userId: null });
  const dana = () => ({ memberId: ids.organizer, orgId, role: "organizer" as const, name: "Dana", email: `dana.${orgId}@example.com`, personId: null, demo: false, userId: null });

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("flightevt");
    await db.update(s.organization).set({ isDemo: false, country: "CA", currency: "CAD" }).where(eq(s.organization.id, orgId));
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "North Hacks", startsAt: new Date("2026-11-20T13:00:00Z"), endsAt: new Date("2026-11-22T23:00:00Z"), venue: "MaRS Centre, Toronto, ON", travelCapMinor: 60000n, bookingDeadline: new Date("2026-11-10T00:00:00Z"), checkInAt: new Date("2026-11-20T14:00:00Z"), closingAt: new Date("2026-11-22T21:00:00Z") });
    await db.insert(s.budgetLine).values({ id: `${orgId}_bud`, orgId, eventId: `${orgId}_evt`, name: "Travel", category: "travel", capMinor: 10_000_000n, fundingSource: "Test" });
    Object.assign(ids, { kim: `${orgId}_kim`, kimMember: `${orgId}_m_kim`, organizer: `${orgId}_m_dana` });
    await db.insert(s.person).values({ id: ids.kim, orgId, name: "Kim Lee", email: `kim.${orgId.toLowerCase()}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1995-01-01", address: "Brooklyn, NY", adult: true, payoutCurrency: "USD" });
    await db.insert(s.orgMember).values([
      { id: ids.organizer, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      { id: ids.kimMember, orgId, role: "attendee", name: "Kim Lee", email: `kim.${orgId}@example.com`, personId: ids.kim },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!orgId) return;
    await m.db.update(m.s.organization).set({ isDemo: true }).where(eq(m.s.organization.id, orgId));
    await dropTestOrg(orgId);
  }, 120_000);

  type Offer = { id: string; destination: string; departAt: string; arriveAt: string; totalMinor: string; offerToken?: string };

  it("suggests signed, simulated fares into the venue city before this event's check-in", async () => {
    const r = await m.services.runAuthorizedAction(kim(), "flight.search", { origin: "JFK", personId: ids.kim });
    expect(r.ok, r.message).toBe(true);
    const offers = r.data!.offers as Offer[];
    expect(offers.length).toBeGreaterThan(0);
    expect(r.data).toMatchObject({ truth: "Simulated", destination: "YYZ", destinationRecognized: true });
    for (const o of offers) {
      expect(o.destination).toBe("YYZ");
      expect(o.offerToken).toMatch(/^v1\./);
      expect(Date.parse(o.arriveAt)).toBeLessThan(Date.parse("2026-11-20T14:00:00Z"));
      expect(o.departAt.startsWith("2026-11-")).toBe(true);
    }
    const local = await m.services.runAuthorizedAction(kim(), "flight.search", { origin: "YYZ" });
    expect(local.data!.offers).toEqual([]);
    expect(local.message).toMatch(/event's own airport/);
  });

  it("books the searched itinerary, then rejects the old token once the event moves", async () => {
    const { db, s, services } = m;
    const search = await services.runAuthorizedAction(kim(), "flight.search", { origin: "JFK" });
    const offer = (search.data!.offers as Offer[])[0];
    // Another offer's token cannot be replayed under this offer's id.
    const other = (search.data!.offers as Offer[])[1];
    const swapped = await services.runAuthorizedAction(kim(), "flight.request", { offerId: offer.id, origin: "JFK", offerToken: other.offerToken });
    expect(swapped.status).toBe(400);

    const req = await services.runAuthorizedAction(kim(), "flight.request", { offerId: offer.id, origin: "JFK", offerToken: offer.offerToken, amountMinor: "100" });
    expect(req.ok, req.message).toBe(true);
    const [claim] = await db.select().from(s.claim).where(eq(s.claim.id, req.data!.claimId as string));
    expect(claim.amountMinor).toBe(BigInt(offer.totalMinor));
    expect(claim.travelDate?.toISOString()).toBe(new Date(offer.departAt).toISOString());
    const ev = claim.extracted as { offer: { destination: string; source: string; truth: string; policyOk: boolean } };
    expect(ev.offer).toMatchObject({ destination: "YYZ", source: "signed", truth: "Simulated", policyOk: true });
    expect(await db.select().from(s.payout).where(eq(s.payout.claimId, claim.id))).toHaveLength(0);

    // The organizer moves check-in a day later; a fare quoted for the old dates is stale.
    const moved = await services.runAuthorizedAction(dana(), "event.update", { checkInAt: "2026-11-21T14:00:00Z" });
    expect(moved.ok, moved.message).toBe(true);
    const stale = await services.runAuthorizedAction(kim(), "flight.request", { offerId: offer.id, origin: "JFK", offerToken: offer.offerToken });
    expect(stale.status).toBe(400);
    expect(stale.message).toMatch(/different event dates/);
  });
});
