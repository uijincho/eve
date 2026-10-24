import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

describe.skipIf(!hasDatabase)("fare flag: ask the attendee, then a person decides", { timeout: 120_000 }, () => {
  let orgId = "";
  type Mods = Awaited<ReturnType<typeof load>>;
  let m: Mods;
  const ids = { marcus: "", sam: "", organizer: "", marcusMember: "", samMember: "" };

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      services: await import("@/lib/server/services"),
      snapshot: await import("@/lib/server/snapshot"),
      core: await import("@/lib/server/core"),
    };
  }

  const actor = (memberId: string, role: "attendee" | "organizer", personId: string | null = null) =>
    ({ memberId, orgId, role, name: memberId, email: `${memberId}@example.com`, personId, demo: false, userId: null });
  const run = (a: ReturnType<typeof actor>, action: string, payload: unknown) => m.services.runAuthorizedAction(a, action, payload);

  /** A hand-entered travel claim with a receipt on file, checked by the agent like a live submission. */
  async function submitTravel(personId: string, memberId: string, id: string, usdMinor: bigint) {
    const { db, s, services, core } = m;
    await db.insert(s.claim).values({
      id, orgId, eventId: `${orgId}_evt`, personId, type: "travel", merchant: "Air Canada", category: "travel", amountMinor: usdMinor, currency: "USD", usdMinor,
      fxRate: "1.00000000", fxSource: "No conversion", purchasedAt: new Date("2026-10-03T14:00:00Z"), travelDate: new Date("2026-10-24T08:00:00Z"), cabin: "economy", origin: "yyz",
      nameOnReceipt: personId === ids.marcus ? "Marcus Lee" : "Sam Ortiz", receiptName: `${id}.pdf`, receiptHash: `hash-${id}`,
      extracted: { source: "manual", corroborated: false, mismatches: [] }, status: "submitted", dueAt: new Date("2026-10-27T00:00:00Z"), requestedBy: memberId,
    });
    await services.processClaimById(core.agentActor(orgId), id);
    const [claim] = await db.select().from(s.claim).where(eq(s.claim.id, id));
    return claim;
  }

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("fare");
    const eventId = `${orgId}_evt`;
    await db.insert(s.event).values({ id: eventId, orgId, name: "Fare Hacks", startsAt: new Date("2026-10-24T16:00:00Z"), endsAt: new Date("2026-10-25T22:00:00Z"), venue: "San Francisco", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10T00:00:00Z"), checkInAt: new Date("2026-10-24T20:30:00Z"), closingAt: new Date("2026-10-25T22:00:00Z") });
    Object.assign(ids, { marcus: `${orgId}_marcus`, sam: `${orgId}_sam`, organizer: `${orgId}_dana`, marcusMember: `${orgId}_m_marcus`, samMember: `${orgId}_m_sam` });
    const peers = [28000n, 29000n, 30000n, 30500n, 31000n, 32000n].map((usd, i) => ({ id: `${orgId}_peer${i}`, usd }));
    await db.insert(s.person).values([
      { id: ids.marcus, orgId, eventId, name: "Marcus Lee", email: `marcus.${orgId}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1998-05-14", address: "Toronto", adult: true, payoutCurrency: "USD" },
      { id: ids.sam, orgId, eventId, name: "Sam Ortiz", email: `sam.${orgId}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1995-01-01", address: "Oakland", adult: true, payoutCurrency: "USD" },
      ...peers.map((p, i) => ({ id: p.id, orgId, eventId, name: `Peer ${i}`, email: `peer${i}.${orgId}@example.com`, country: "CA", citizenship: "CA", dateOfBirth: "1999-01-01", address: "Toronto", adult: true, payoutCurrency: "USD" })),
    ]);
    // Other attendees' YYZ fares, about $300.
    await db.insert(s.claim).values(peers.map((p, i) => ({
      id: `${orgId}_pc${i}`, orgId, eventId, personId: p.id, type: "travel" as const, merchant: "Air Canada", category: "travel", amountMinor: p.usd, currency: "USD", usdMinor: p.usd,
      fxRate: "1.00000000", fxSource: "No conversion", purchasedAt: new Date("2026-09-20T12:00:00Z"), travelDate: new Date("2026-10-24T08:00:00Z"), cabin: "economy", origin: "YYZ",
      status: "approved" as const, dueAt: new Date("2026-10-27T00:00:00Z"), requestedBy: "seed",
    })));
    await db.insert(s.orgMember).values([
      { id: ids.organizer, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      { id: ids.marcusMember, orgId, role: "attendee", name: "Marcus Lee", email: `marcus.${orgId}@example.com`, personId: ids.marcus },
      { id: ids.samMember, orgId, role: "attendee", name: "Sam Ortiz", email: `sam.${orgId}@example.com`, personId: ids.sam },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (orgId) await dropTestOrg(orgId);
  }, 120_000);

  it("asks once about a high fare, takes the answer, and leaves the decision to an organizer", async () => {
    const { db, s } = m;
    const marcus = actor(ids.marcusMember, "attendee", ids.marcus);
    const sam = actor(ids.samMember, "attendee", ids.sam);
    const dana = actor(ids.organizer, "organizer");
    const claimId = `${orgId}_c_marcus`;
    const claim = await submitTravel(ids.marcus, ids.marcusMember, claimId, 49500n);
    expect(claim.status, claim.reason).toBe("needs_info");
    expect(claim.checks.find((c) => c.code === "fare_peer")?.passed).toBe(false);
    const review = (claim.extracted as { fareReview?: { question: string; route: string; peerCount: number } }).fareReview!;
    expect(review.route).toBe("YYZ → SFO");
    expect(review.peerCount).toBe(6);
    expect(review.question).toMatch(/about \$185 above what most attendees/);
    const notices = await db.select().from(s.notice).where(eq(s.notice.personId, ids.marcus));
    expect(notices.some((n) => n.body.startsWith(review.question))).toBe(true);

    // The attendee sees the question on their own claim.
    const snap = await m.snapshot.buildSnapshot(marcus);
    expect(snap.claims.find((c) => c.id === claimId)?.fareReview?.question).toBe(review.question);

    // Only the claimant answers; organizers review instead.
    expect((await run(sam, "claim.explain", { id: claimId, explanation: "Not mine" })).status).toBe(403);
    expect((await run(dana, "claim.explain", { id: claimId, explanation: "On their behalf" })).status).toBe(403);
    const answered = await run(marcus, "claim.explain", { id: claimId, explanation: "I was accepted off the waitlist on Oct 2." });
    expect(answered.ok, answered.message).toBe(true);
    expect((await run(marcus, "claim.explain", { id: claimId, explanation: "Again" })).status).toBe(409);

    const [after] = await db.select().from(s.claim).where(eq(s.claim.id, claimId));
    expect(after.status).toBe("escalated");
    expect(after.reviewedBy).toBeNull();
    expect((after.extracted as { fareReview: { explanation: string } }).fareReview.explanation).toBe("I was accepted off the waitlist on Oct 2.");
    const logged = await db.select().from(s.decisionLog).where(eq(s.decisionLog.objectId, claimId));
    expect(logged.map((d) => d.action)).toEqual(expect.arrayContaining(["claim.check", "claim.explain"]));

    const approved = await run(dana, "claim.review", { id: claimId, decision: "approve", reason: "Late waitlist acceptance; fare reasonable for the booking date." });
    expect(approved.ok, approved.message).toBe(true);
  });

  it("does not ask about a fare in line with peers", async () => {
    const sam = actor(ids.samMember, "attendee", ids.sam);
    const claim = await submitTravel(ids.sam, ids.samMember, `${orgId}_c_sam`, 30500n);
    expect(claim.checks.find((c) => c.code === "fare_peer")?.passed).toBe(true);
    expect((claim.extracted as { fareReview?: unknown }).fareReview).toBeUndefined();
    // Hand-entered, so a person still checks it, but nothing is asked.
    expect(claim.status).toBe("escalated");
    expect((await run(sam, "claim.explain", { id: claim.id, explanation: "Nothing to explain" })).status).toBe(409);
  });
});
