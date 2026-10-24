// Regression tests for the independent financial review: server-verified
// flight requests, same-form YTD under re-quote, beneficiary self-release,
// physical fulfillment as reportable income, sponsor packet ownership and
// ledger, award mutation locks, threshold-backed scoreboard, budget caps.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

type Role = "attendee" | "organizer" | "controller" | "auditor";

async function load() {
  return {
    db: (await import("@/lib/db")).getDb(),
    s: await import("@/lib/db/schema"),
    services: await import("@/lib/server/services"),
    payouts: await import("@/lib/server/payouts"),
    scoreboard: await import("@/lib/server/scoreboard"),
    engines: await import("@/lib/server/engines"),
  };
}
type Mods = Awaited<ReturnType<typeof load>>;

/** Disposable demo org with rules, FX, an event, and staff members. */
async function setupOrg(m: Mods, label: string) {
  const { db, s } = m;
  const orgId = await createTestOrg(label);
  await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Review Hacks", startsAt: new Date("2026-10-24T16:00:00Z"), endsAt: new Date("2026-10-25T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-12-31T00:00:00Z"), checkInAt: new Date("2026-10-24T20:30:00Z"), closingAt: new Date("2026-10-25T22:00:00Z") });
  await db.insert(s.taxRule).values(m.engines.startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
  await db.insert(s.fxRate).values([
    { rateDate: "2026-09-01", base: "CAD", quote: "USD", rate: "0.72876000", source: "test" },
    { rateDate: "2026-09-01", base: "GBP", quote: "USD", rate: "1.27000000", source: "test" },
  ]).onConflictDoNothing();
  const members = { dana: `${orgId}_dana`, dana2: `${orgId}_dana2`, ari: `${orgId}_ari`, ari2: `${orgId}_ari2` };
  await db.insert(s.orgMember).values([
    { id: members.dana, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
    { id: members.dana2, orgId, role: "organizer", name: "Dana Two", email: `dana2.${orgId}@example.com` },
    { id: members.ari, orgId, role: "controller", name: "Ari", email: `ari.${orgId}@example.com` },
    { id: members.ari2, orgId, role: "controller", name: "Ari Two", email: `ari2.${orgId}@example.com` },
  ]);
  const actor = (memberId: string, role: Role, personId: string | null = null, email = `${memberId}@example.com`) =>
    ({ memberId, orgId, role, name: memberId, email, personId, demo: false, userId: null });
  const run = (a: ReturnType<typeof actor>, action: string, payload: unknown) => m.services.runAuthorizedAction(a, action, payload);
  let n = 0;
  /** Person + attendee member + active bank method. */
  async function person(name: string, country: string, opts: { currency?: string; email?: string } = {}) {
    const id = `${orgId}_p${++n}`;
    const email = opts.email ?? `p${n}.${orgId}@example.com`;
    await db.insert(s.person).values({ id, orgId, name, email, country, citizenship: country, dateOfBirth: "1995-01-01", address: country === "US" ? "Oakland, CA" : "Abroad", adult: true, payoutCurrency: opts.currency ?? "USD" });
    await db.insert(s.payoutMethod).values({ id: `${id}_pm`, orgId, personId: id, currency: opts.currency ?? "USD", last4: "1111", status: "active", version: 1, requestedBy: "seed" });
    const memberId = `${id}_m`;
    await db.insert(s.orgMember).values({ id: memberId, orgId, role: "attendee", name, email, personId: id });
    return { id, email, self: actor(memberId, "attendee", id, email) };
  }
  return {
    orgId, members, actor, run, person,
    dana: actor(members.dana, "organizer"), dana2: actor(members.dana2, "organizer"),
    ari: actor(members.ari, "controller"), ari2: actor(members.ari2, "controller"),
  };
}

describe.skipIf(!hasDatabase)("independent financial review fixes (real Postgres)", { timeout: 180_000 }, () => {
  let m: Mods;
  let t: Awaited<ReturnType<typeof setupOrg>>;

  beforeAll(async () => {
    m = await load();
    t = await setupOrg(m, "review");
  }, 120_000);
  afterAll(async () => {
    if (t?.orgId) await dropTestOrg(t.orgId);
  }, 120_000);

  const payoutRow = async (id: string) => (await m.db.select().from(m.s.payout).where(eq(m.s.payout.id, id)))[0];
  const award = async (who: { id: string }, amount: string, extra: Record<string, unknown> = {}) => {
    const r = await t.run(t.dana, "award.create", { personId: who.id, track: "Track", title: "Prize", kind: "cash", amountMinor: amount, ...extra });
    expect(r.ok, r.message).toBe(true);
    return (r.data!.ids as string[])[0];
  };
  const propose = async (awardId: string, by = t.dana) => {
    const r = await t.run(by, "payout.propose", { sourceType: "award", sourceId: awardId });
    expect(r.ok, r.message).toBe(true);
    return r.data!.payoutId as string;
  };
  const w9 = async (p: { id: string; self: unknown }, name: string, tin?: string) => {
    const r = await t.run(p.self as never, "tax.submit", { personId: p.id, form: "W-9", signature: name, certify: true, ...(tin ? { tin } : {}) });
    expect(r.ok, r.message).toBe(true);
  };

  it("1: flight requests use only the server's offer, never pay the attendee, and dedupe", async () => {
    const { db, s } = m;
    const kim = await t.person("Kim Lee", "CA", { currency: "CAD" });
    // A made-up offer with an invented price is rejected outright.
    const fake = await t.run(kim.self, "flight.request", { offerId: "off_made_up", origin: "YYZ", carrier: "Fake Air", departAt: "2026-10-23T11:30:00Z", amountMinor: "29898" });
    expect(fake.status).toBe(400);
    expect(fake.message).toMatch(/not issued by this server/);
    const forged = await t.run(kim.self, "flight.request", { offerId: "off_made_up", origin: "YYZ", offerToken: "v1.e30.AAAA" });
    expect(forged.status).toBe(400);
    // A fixture offer: the client's carrier/price are ignored and reported as mismatches.
    const req = await t.run(kim.self, "flight.request", { offerId: "fx_YYZ_1", origin: "YYZ", carrier: "Fake Air", amountMinor: "100" });
    expect(req.ok, req.message).toBe(true);
    const [claim] = await db.select().from(s.claim).where(eq(s.claim.id, req.data!.claimId as string));
    expect(claim.amountMinor).toBe(48900n);
    expect(claim.currency).toBe("CAD");
    expect(claim.merchant).toMatch(/^Air Canada/);
    expect(claim.status).toBe("escalated"); // the agent never approves an org booking
    const ev = claim.extracted as { source: string; mismatches: string[]; offer: { id: string } };
    expect(ev.source).toBe("org_booking");
    expect(ev.offer.id).toBe("fx_YYZ_1");
    expect(ev.mismatches.join(" ")).toMatch(/amount 100/);
    expect(await db.select().from(s.payout).where(eq(s.payout.claimId, claim.id))).toHaveLength(0);
    // Same offer replays; another offer is a duplicate booking.
    const again = await t.run(kim.self, "flight.request", { offerId: "fx_YYZ_1", origin: "YYZ" });
    expect(again.data?.claimId).toBe(claim.id);
    expect((await t.run(kim.self, "flight.request", { offerId: "fx_YYZ_2", origin: "YYZ" })).status).toBe(409);
    // A client cannot forge an org booking through claim.submit.
    const forgedClaim = await t.run(kim.self, "claim.submit", { type: "travel", category: "org_booked_flight", merchant: "X", amountMinor: "100", currency: "USD", purchasedAt: "2026-10-01T00:00:00Z" });
    expect(forgedClaim.status).toBe(400);
    // Organizer approval books it (Simulated) and never creates an attendee payout.
    const approved = await t.run(t.dana, "claim.review", { id: claim.id, decision: "approve", reason: "Book it" });
    expect(approved.ok, approved.message).toBe(true);
    const [after] = await db.select().from(s.claim).where(eq(s.claim.id, claim.id));
    expect(after.status).toBe("paid");
    expect(after.reason).toMatch(/simulated/i);
    expect(await db.select().from(s.payout).where(eq(s.payout.claimId, claim.id))).toHaveLength(0);
    const [entry] = await db.select().from(s.journalEntry).where(eq(s.journalEntry.idempotencyKey, `org-booking:${claim.id}`));
    const lines = await db.select().from(s.journalLine).where(eq(s.journalLine.entryId, entry.id));
    expect(lines.map((l) => [l.accountId.split(":")[1], l.debitMinor, l.creditMinor]).sort()).toEqual([["1000", 0n, claim.usdMinor], ["5000", claim.usdMinor, 0n]]);
    // proposePayout refuses an org booking even if called directly.
    expect((await t.run(t.dana, "payout.propose", { sourceType: "claim", sourceId: claim.id })).status).toBe(409);
  });

  it("2: two no-TIN prizes cannot both release at 0% withholding; the second is re-quoted and needs a fresh release", async () => {
    const sam = await t.person("Sam Ortiz", "US");
    await w9(sam, "Sam Ortiz"); // no TIN
    const a1 = await propose(await award(sam, "150000"));
    const a2 = await propose(await award(sam, "150000"));
    expect((await payoutRow(a1)).withholdingMinor).toBe(0n);
    expect((await payoutRow(a2)).withholdingMinor).toBe(0n);
    const stale = m.payouts.termsKey(await payoutRow(a2));
    expect((await t.run(t.ari, "payout.release", { id: a1 })).ok).toBe(true);
    const b = await payoutRow(a2);
    // 150,000 + 150,000 crosses the $2,000 backup-withholding threshold: 24% of the second payment.
    expect(b.withholdingMinor).toBe(36000n);
    expect(b.reportable).toBe(true);
    expect(b.status).toBe("proposed");
    expect(b.releasedBy).toBeNull();
    // An approval for the old terms cannot pay the new ones.
    const err = await m.db.transaction((tx) => m.payouts.releasePayout(tx, t.ari, a2, { expectTerms: stale })).catch((e: Error) => e.message);
    expect(err).toMatch(/re-quoted/);
    const rel = await t.run(t.ari, "payout.release", { id: a2 });
    expect(rel.ok, rel.message).toBe(true);
    const paid = await payoutRow(a2);
    expect(paid.status).toBe("paid");
    expect(paid.withholdingMinor).toBe(36000n);
  });

  it("2b: a tax form change re-quotes proposed payouts, and release recomputes tax under the person lock", async () => {
    const lee = await t.person("Lee Park", "US");
    await w9(lee, "Lee Park"); // no TIN: a $2,500 prize is backup-withheld
    const id = await propose(await award(lee, "250000"));
    expect((await payoutRow(id)).withholdingMinor).toBe(60000n);
    await w9(lee, "Lee Park", "123-45-6789");
    const requoted = await payoutRow(id);
    expect(requoted.withholdingMinor).toBe(0n);
    expect(requoted.status).toBe("proposed");
    // Tamper with the stored quote: release must not pay it as stored.
    await m.db.update(m.s.payout).set({ withholdingMinor: 1000n, netMinor: 249000n }).where(eq(m.s.payout.id, id));
    const out = await m.db.transaction((tx) => m.payouts.releasePayout(tx, t.ari, id));
    expect(out.status).toBe("proposed");
    expect(out.withholdingMinor).toBe(0n);
    expect((await payoutRow(id)).paidAt).toBeNull();
    expect((await t.run(t.ari, "payout.release", { id })).ok).toBe(true);
  });

  it("3: a staff member can never authorize money to themselves, linked or matched by email", async () => {
    const { db, s } = m;
    // Controller linked to a person record.
    const wren = await t.person("Wren Hale", "US");
    await w9(wren, "Wren Hale", "111-22-3333");
    const linked = t.actor(t.members.ari2, "controller", wren.id, `ari2.${t.orgId}@example.com`);
    const id1 = await propose(await award(wren, "50000"));
    const r1 = await t.run(linked, "payout.release", { id: id1 });
    expect(r1.status).toBe(403);
    expect(r1.message).toMatch(/recipient/);
    // Onboarded staff have personId NULL; the imported person shares the email.
    const cole = await t.person("Cole Byrd", "US", { email: `cole.${t.orgId}@example.com` });
    await w9(cole, "Cole Byrd", "222-33-4444");
    const coleCtl = t.actor(`${t.orgId}_cole_ctl`, "controller", null, ` COLE.${t.orgId}@Example.com `);
    await db.insert(s.orgMember).values({ id: coleCtl.memberId, orgId: t.orgId, role: "controller", name: "Cole (controller)", email: `cole.ctl.${t.orgId}@example.com` });
    const id2 = await propose(await award(cole, "40000"));
    const r2 = await t.run(coleCtl, "payout.release", { id: id2 });
    expect(r2.status).toBe(403);
    // Own claim review (controller path, above the organizer limit) is blocked by email too.
    await db.insert(s.claim).values({ id: `${t.orgId}_cole_clm`, orgId: t.orgId, eventId: `${t.orgId}_evt`, personId: cole.id, type: "expense", merchant: "Staples", category: "supplies", amountMinor: 250000n, currency: "USD", usdMinor: 250000n, fxRate: "1", fxSource: "No conversion", purchasedAt: new Date("2026-10-20T00:00:00Z"), status: "escalated", dueAt: new Date("2026-11-01T00:00:00Z"), requestedBy: `${cole.id}_m` });
    const rev = await t.run(coleCtl, "claim.review", { id: `${t.orgId}_cole_clm`, decision: "approve", reason: "mine" });
    expect(rev.status).toBe(403);
    // Organizers cannot create or request their own award.
    const self = await t.run(t.actor(t.members.dana2, "organizer", null, cole.email), "award.create", { personId: cole.id, track: "T", title: "Self", kind: "cash", amountMinor: "100" });
    expect(self.status).toBe(403);
    const awardId = await award(cole, "1000");
    expect((await t.run(t.actor(t.members.dana2, "organizer", cole.id), "payout.propose", { sourceType: "award", sourceId: awardId })).status).toBe(403);
    // An unrelated controller still can.
    expect((await t.run(t.ari, "payout.release", { id: id2 })).ok).toBe(true);
  });

  it("4: physical fulfillment counts FMV toward the 1099-MISC, grosses up non-US withholding, and is final", async () => {
    const { db, s } = m;
    const una = await t.person("Una Diaz", "US");
    await w9(una, "Una Diaz", "333-44-5555");
    const itemId = await award(una, "150000", { kind: "item", title: "Laptop" });
    expect((await t.run(t.dana, "award.fulfill", { id: itemId })).status).toBe(403); // organizers cannot
    expect((await t.run(t.ari, "award.fulfill", { id: itemId })).status).toBe(409); // choose first
    expect((await t.run(una.self, "award.choose", { id: itemId, fulfillment: "ship" })).ok).toBe(true);
    const f = await t.run(t.ari, "award.fulfill", { id: itemId });
    expect(f.ok, f.message).toBe(true);
    expect(f.data).toMatchObject({ fmvMinor: "150000", grossMinor: "150000", withholdingMinor: "0", truth: "Simulated", reportable: false });
    expect((await t.run(una.self, "award.choose", { id: itemId, fulfillment: "cash" })).status).toBe(409);
    expect((await t.run(t.ari, "award.fulfill", { id: itemId })).status).toBe(409);
    const cash = await propose(await award(una, "100000"));
    expect((await payoutRow(cash)).reportable).toBe(true); // 150,000 FMV + 100,000 cash
    expect((await t.run(t.ari, "payout.release", { id: cash })).ok).toBe(true);
    await t.run(t.dana, "filings.generate", { year: 2026 });
    const [misc] = await db.select().from(s.filing).where(eq(s.filing.personId, una.id));
    expect(misc.form).toBe("1099-MISC");
    expect(misc.grossMinor).toBe(250000n);

    // Non-US: the org pays 30% on top; reported income is FMV + tax.
    const ana = await t.person("Ana Costa", "GB", { currency: "GBP" });
    expect((await t.run(ana.self, "tax.submit", { personId: ana.id, form: "W-8BEN", signature: "Ana Costa", certify: true })).ok).toBe(true);
    const mac = await award(ana, "129900", { kind: "item", title: "MacBook Air" });
    await t.run(ana.self, "award.choose", { id: mac, fulfillment: "local" });
    const g = await t.run(t.ari, "award.fulfill", { id: mac });
    expect(g.ok, g.message).toBe(true);
    const gross = BigInt(g.data!.grossMinor as string), wh = BigInt(g.data!.withholdingMinor as string);
    expect(gross - wh).toBe(129900n);
    expect(wh).toBe((gross * 3000n + 5000n) / 10000n);
    const [entry] = await db.select().from(s.journalEntry).where(eq(s.journalEntry.idempotencyKey, `inkind:${mac}`));
    const lines = await db.select().from(s.journalLine).where(eq(s.journalLine.entryId, entry.id));
    expect(lines.map((l) => [l.accountId.split(":")[1], l.debitMinor, l.creditMinor]).sort()).toEqual([["1000", 0n, 129900n], ["2100", 0n, wh], ["5100", gross, 0n]]);
    await t.run(t.dana, "filings.generate", { year: 2026 });
    const [k] = await db.select().from(s.filing).where(eq(s.filing.personId, ana.id));
    expect(k).toMatchObject({ form: "1042-S", grossMinor: gross, withholdingMinor: wh });

    // Missing form or an unverified treaty rule: held, nothing recorded.
    const noForm = await t.person("Nia Oke", "US");
    const nf = await award(noForm, "5000", { kind: "item", title: "Headphones" });
    await t.run(noForm.self, "award.choose", { id: nf, fulfillment: "ship" });
    const held = await t.run(t.ari, "award.fulfill", { id: nf });
    expect(held.status).toBe(409);
    expect(held.message).toMatch(/held/i);
    const can = await t.person("Cam Roy", "CA", { currency: "CAD" });
    await t.run(can.self, "tax.submit", { personId: can.id, form: "W-8BEN", signature: "Cam Roy", certify: true, treatyCountry: "CA", treatyArticle: "XXII" });
    const tr = await award(can, "5000", { kind: "item", title: "Switch" });
    await t.run(can.self, "award.choose", { id: tr, fulfillment: "local" });
    expect((await t.run(t.ari, "award.fulfill", { id: tr })).message).toMatch(/unverified/);
    expect(await db.select().from(s.payout).where(eq(s.payout.awardId, tr))).toHaveLength(0);
  });

  it("5: a sponsor packet owns its payout exclusively and the ledger balances through remittance", async () => {
    const { db, s } = m;
    const pat = await t.person("Pat Quinn", "US");
    await w9(pat, "Pat Quinn", "444-55-6666");
    const pid = await propose(await award(pat, "100000"));
    const created = await t.run(t.dana, "sponsor.create", { payoutId: pid });
    expect(created.ok, created.message).toBe(true);
    const packetId = created.data!.id as string;
    expect((await t.run(t.dana, "sponsor.create", { payoutId: pid })).status).toBe(409);
    const direct = await t.run(t.ari, "payout.release", { id: pid });
    expect(direct.status).toBe(409);
    expect(direct.message).toMatch(/sponsor packet/);
    expect((await t.run(t.dana, "sponsor.submit", { id: packetId })).status).toBe(403);
    expect((await t.run(t.dana, "sponsor.reconcile", { id: packetId, paidMinor: "100000" })).status).toBe(409); // not submitted
    const sub = await t.run(t.ari, "sponsor.submit", { id: packetId });
    expect(sub.ok, sub.message).toBe(true);
    const inFlight = await payoutRow(pid);
    expect(inFlight).toMatchObject({ status: "processing", provider: "sponsor_packet", releasedBy: t.members.ari });
    expect((await t.run(t.ari, "payout.release", { id: pid })).status).toBe(409);
    expect((await t.run(t.ari, "sponsor.submit", { id: packetId })).status).toBe(409);

    // $970 on $1,000: exception, nothing posted.
    const short = await t.run(t.dana, "sponsor.reconcile", { id: packetId, paidMinor: "97000" });
    expect(short.data?.status).toBe("exception");
    expect(await db.select().from(s.journalEntry).where(eq(s.journalEntry.idempotencyKey, `sponsor-pay:${packetId}`))).toHaveLength(0);
    expect((await t.run(t.dana, "sponsor.reconcile", { id: packetId, paidMinor: "97000", acceptShortfall: true, note: "fee" })).status).toBe(403);
    expect((await t.run(t.ari, "sponsor.reconcile", { id: packetId, paidMinor: "97000", acceptShortfall: true })).status).toBe(400);
    const orgFees = await t.run(t.ari, "sponsor.reconcile", { id: packetId, paidMinor: "97000", acceptShortfall: true, note: "wire fee" });
    expect(orgFees.status).toBe(409); // org bears fees: the $30 is still owed to Pat
    // Sponsor sends the difference: full settlement.
    const full = await t.run(t.dana, "sponsor.reconcile", { id: packetId, paidMinor: "100000" });
    expect(full.data?.status).toBe("paid");
    expect((await t.run(t.dana, "sponsor.reconcile", { id: packetId, paidMinor: "100000" })).status).toBe(409);
    expect((await payoutRow(pid)).status).toBe("paid");
    // AP to Pat nets to zero; Due from sponsor is credited the full request.
    const lines = await db.select({ account: s.journalLine.accountId, d: s.journalLine.debitMinor, c: s.journalLine.creditMinor, src: s.journalEntry.sourceId })
      .from(s.journalLine).innerJoin(s.journalEntry, eq(s.journalEntry.id, s.journalLine.entryId)).where(eq(s.journalEntry.orgId, t.orgId));
    const mine = lines.filter((l) => l.src === pid || l.src === packetId);
    const bal = (code: string) => mine.filter((l) => l.account.endsWith(`:${code}`)).reduce((x, l) => x + l.d - l.c, 0n);
    expect(bal("2000")).toBe(0n);
    expect(bal("1100")).toBe(-100000n);
    expect(bal("5100")).toBe(100000n);
    expect(await db.select().from(s.journalEntry).where(eq(s.journalEntry.idempotencyKey, `payment:${pid}`))).toHaveLength(0); // never paid twice
    // A paid payout cannot get a packet; a direct-mode org cannot draft one.
    expect((await t.run(t.dana, "sponsor.create", { payoutId: pid })).status).toBe(409);
    const pid2 = await propose(await award(pat, "5000"));
    await db.update(s.organization).set({ mode: "direct" }).where(eq(s.organization.id, t.orgId));
    expect((await t.run(t.dana, "sponsor.create", { payoutId: pid2 })).message).toMatch(/pays directly/);
    await db.update(s.organization).set({ mode: "sponsor" }).where(eq(s.organization.id, t.orgId));
    expect((await t.run(t.ari, "payout.release", { id: pid2 })).message).toMatch(/fiscal sponsor/);
    await db.update(s.organization).set({ mode: "hybrid" }).where(eq(s.organization.id, t.orgId));
  });

  it("6: live payouts lock award fulfillment and splits; release rechecks the source", async () => {
    const { db, s } = m;
    const x = await t.person("Xia Wu", "US");
    const y = await t.person("Yan Li", "US");
    await w9(x, "Xia Wu", "555-66-7777");
    await w9(y, "Yan Li", "666-77-8888");
    const team = await t.run(t.dana, "award.create", { teamPersonIds: [x.id, y.id], track: "AI", title: "Team", kind: "cash", amountMinor: "20000" });
    const [ax, ay] = team.data!.ids as string[];
    expect((await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: ax })).status).toBe(409); // unconfirmed
    await t.run(x.self, "award.confirm", { id: ax });
    await t.run(y.self, "award.confirm", { id: ay });
    const px = await propose(ax);
    const split = await t.run(x.self, "award.split", { teamId: team.data!.teamId, splits: [{ personId: x.id, bps: 9000 }, { personId: y.id, bps: 1000 }] });
    expect(split.status).toBe(409);
    expect(split.message).toMatch(/locked/);
    // A tampered source (split no longer confirmed) cannot be released.
    await db.update(s.award).set({ splitConfirmed: false }).where(eq(s.award.id, ay));
    expect((await t.run(t.ari, "payout.release", { id: px })).message).toMatch(/confirm the prize split/);
    await db.update(s.award).set({ splitConfirmed: true }).where(eq(s.award.id, ay));
    // Item switched to cash with a held payout: the choice is locked.
    const z = await t.person("Zed Fox", "US");
    const item = await award(z, "30000", { kind: "item", title: "Drone" });
    await t.run(z.self, "award.choose", { id: item, fulfillment: "cash" });
    const held = await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: item });
    expect(held.data?.status).toBe("held");
    const [a] = await db.select().from(s.award).where(eq(s.award.id, item));
    expect(a.status).toBe("needs_form");
    expect((await t.run(z.self, "award.choose", { id: item, fulfillment: "ship" })).status).toBe(409);
  });

  it("7: the scoreboard's reportable cases need a threshold-backed filing; below-threshold cases need none", async () => {
    const { db, s } = m;
    const q = await t.person("Quin Ash", "US");
    await w9(q, "Quin Ash", "777-88-9999");
    const small = await propose(await award(q, "75000"));
    await t.run(t.ari, "payout.release", { id: small });
    const r = await t.person("Rae Kim", "US");
    await w9(r, "Rae Kim", "888-99-0000");
    const big = await propose(await award(r, "250000")); // reportable once paid, not before
    const keys = [
      { id: `${t.orgId}_k1`, orgId: t.orgId, scenario: "Below threshold", objectType: "person" as const, objectId: q.id, expected: "clean" as const, expectedCode: "1099-MISC", description: "" },
      { id: `${t.orgId}_k2`, orgId: t.orgId, scenario: "Over threshold", objectType: "person" as const, objectId: r.id, expected: "reportable" as const, expectedCode: "1099-MISC", description: "" },
      { id: `${t.orgId}_k3`, orgId: t.orgId, scenario: "Wrong form", objectType: "person" as const, objectId: r.id, expected: "reportable" as const, expectedCode: "1099-NEC", description: "" },
    ];
    await db.insert(s.answerKey).values(keys);
    await t.run(t.dana, "filings.generate", { year: 2026 });
    let board = await m.scoreboard.computeScoreboard(db, t.orgId);
    const res = (id: string) => board.results.find((x) => x.id === id)!;
    expect(res(`${t.orgId}_k1`).passed).toBe(true);
    expect(res(`${t.orgId}_k2`).passed).toBe(false); // proposed and flagged reportable is not a filing
    expect(res(`${t.orgId}_k2`).actual).toMatch(/nothing paid/);
    await t.run(t.ari, "payout.release", { id: big });
    await t.run(t.dana, "filings.generate", { year: 2026 });
    board = await m.scoreboard.computeScoreboard(db, t.orgId);
    expect(res(`${t.orgId}_k2`).passed).toBe(true);
    expect(res(`${t.orgId}_k3`).passed).toBe(false);
    await db.delete(s.answerKey).where(eq(s.answerKey.orgId, t.orgId));
  });
});

describe.skipIf(!hasDatabase)("budget caps (real Postgres)", { timeout: 180_000 }, () => {
  let m: Mods;
  let t: Awaited<ReturnType<typeof setupOrg>>;
  beforeAll(async () => {
    m = await load();
    t = await setupOrg(m, "budget");
  }, 120_000);
  afterAll(async () => {
    if (t?.orgId) await dropTestOrg(t.orgId);
  }, 120_000);

  it("blocks prize proposals, claim approvals and releases that would exceed a line, serialized per org", async () => {
    const { db, s } = m;
    await db.insert(s.budgetLine).values([
      { id: `${t.orgId}_prizes`, orgId: t.orgId, eventId: `${t.orgId}_evt`, name: "Prizes", category: "prizes", capMinor: 100000n, fundingSource: "Sponsor" },
      { id: `${t.orgId}_supplies`, orgId: t.orgId, eventId: `${t.orgId}_evt`, name: "Supplies", category: "supplies", capMinor: 10000n, fundingSource: "General" },
    ]);
    const a = await t.person("Abe Hill", "US");
    await t.run(a.self, "tax.submit", { personId: a.id, form: "W-9", signature: "Abe Hill", certify: true, tin: "123-45-0000" });
    const mk = async (amount: string) => (await t.run(t.dana, "award.create", { personId: a.id, track: "T", title: "P", kind: "cash", amountMinor: amount })).data!.ids as string[];
    const [w1] = await mk("60000");
    const [w2] = await mk("50000");
    const ok1 = await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: w1 });
    expect(ok1.ok).toBe(true);
    const over = await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: w2 });
    expect(over.status).toBe(409);
    expect(over.message).toMatch(/exceed the Prizes budget.*\$400\.00 left/);
    // Lowering the cap after proposal blocks the release too.
    await db.update(s.budgetLine).set({ capMinor: 50000n }).where(eq(s.budgetLine.id, `${t.orgId}_prizes`));
    expect((await t.run(t.ari, "payout.release", { id: ok1.data!.payoutId })).message).toMatch(/exceed the Prizes budget/);
    // Two concurrent proposals against $1,000 of room for $600 each: exactly one succeeds.
    await db.update(s.budgetLine).set({ capMinor: 160000n }).where(eq(s.budgetLine.id, `${t.orgId}_prizes`));
    const [c1] = await mk("60000");
    const [c2] = await mk("60000");
    const both = await Promise.all([c1, c2].map((id) => t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: id })));
    expect(both.map((r) => r.ok).sort()).toEqual([false, true]);
    // Claims: an escalated claim over the line cannot be approved.
    await db.insert(s.claim).values({ id: `${t.orgId}_c`, orgId: t.orgId, eventId: `${t.orgId}_evt`, personId: a.id, type: "expense", merchant: "Staples", category: "supplies", amountMinor: 12000n, currency: "USD", usdMinor: 12000n, fxRate: "1", fxSource: "No conversion", purchasedAt: new Date("2026-10-20T00:00:00Z"), status: "escalated", dueAt: new Date("2026-11-01T00:00:00Z"), requestedBy: `${a.id}_m` });
    const rev = await t.run(t.dana, "claim.review", { id: `${t.orgId}_c`, decision: "approve", reason: "ok" });
    expect(rev.status).toBe(409);
    expect(rev.message).toMatch(/Supplies budget/);
  });
});

describe.skipIf(!hasDatabase)("tax identity, unverified-rule resolution and scoreboard evidence (real Postgres)", { timeout: 240_000 }, () => {
  let m: Mods;
  let t: Awaited<ReturnType<typeof setupOrg>>;
  beforeAll(async () => {
    m = await load();
    t = await setupOrg(m, "taxid");
  }, 120_000);
  afterAll(async () => {
    if (t?.orgId) await dropTestOrg(t.orgId);
  }, 120_000);
  const payoutRow = async (id: string) => (await m.db.select().from(m.s.payout).where(eq(m.s.payout.id, id)))[0];
  const award = async (personId: string, amount: string, extra: Record<string, unknown> = {}) => {
    const r = await t.run(t.dana, "award.create", { personId, track: "Track", title: "Prize", kind: "cash", amountMinor: amount, ...extra });
    expect(r.ok, r.message).toBe(true);
    return (r.data!.ids as string[])[0];
  };

  it("treats a US citizen living in Canada as a US person, and holds the wrong form for the payer", async () => {
    const { db, s } = m;
    const amy = await t.person("Amy Stone", "CA", { currency: "CAD" });
    await db.update(s.person).set({ citizenship: "US" }).where(eq(s.person.id, amy.id));
    expect((await t.run(amy.self, "tax.submit", { personId: amy.id, form: "W-9", signature: "Amy Stone", tin: "123-45-1111", certify: true })).data?.status).toBe("valid");
    const p1 = await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: await award(amy.id, "250000") });
    const row = await payoutRow(p1.data!.payoutId as string);
    expect(row).toMatchObject({ ruleId: "us-us-prize", withholdingMinor: 0n, reportable: true, destinationCurrency: "CAD" });
    expect(row.reportingForm).toMatch(/^1099-MISC/);
    // A residency declaration is not a US payer's form.
    const ben = await t.person("Ben Hart", "GB", { currency: "GBP" });
    const decl = await t.run(ben.self, "tax.submit", { personId: ben.id, form: "Residency declaration", signature: "Ben Hart", certify: true });
    expect(decl.data?.status).toBe("review");
    expect((await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: await award(ben.id, "10000") })).data?.status).toBe("held");
    // Changing residence after signing invalidates the form and holds the proposal.
    await t.run(amy.self, "person.update", { id: amy.id, citizenship: "CA" });
    const after = await payoutRow(p1.data!.payoutId as string);
    expect(after.status).toBe("held");
    const [profile] = await db.select().from(s.taxProfile).where(eq(s.taxProfile.personId, amy.id));
    expect(profile.status).toBe("review");
  });

  it("resolves an unverified-rule hold per source with a reason, never bypassing a missing form, and needs a separate release", async () => {
    const { db, s } = m;
    const cara = await t.person("Cara Lane", "CA", { currency: "CAD" });
    await t.run(cara.self, "tax.submit", { personId: cara.id, form: "W-8BEN", signature: "Cara Lane", certify: true, treatyCountry: "CA", treatyArticle: "XXII" });
    const awardId = await award(cara.id, "100000");
    const pid = (await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: awardId })).data!.payoutId as string;
    expect(await payoutRow(pid)).toMatchObject({ status: "held", ruleId: "us-ca-prize-treaty", ruleVerified: false });
    expect((await t.run(t.dana, "payout.resolveRule", { sourceType: "award", sourceId: awardId, use: "default", reason: "Advisor says treaty does not cover prizes" })).status).toBe(403);
    expect((await t.run(t.ari, "payout.resolveRule", { sourceType: "award", sourceId: awardId, use: "default", reason: "short" })).status).toBe(400);
    const res = await t.run(t.ari, "payout.resolveRule", { sourceType: "award", sourceId: awardId, use: "default", reason: "Advisor: Article XXII lets the US tax the prize; withhold the 30% default" });
    expect(res.ok, res.message).toBe(true);
    const resolved = await payoutRow(pid);
    expect(resolved).toMatchObject({ status: "proposed", ruleId: "us-nonus-prize", ruleVerified: true, withholdingMinor: 30000n, releasedBy: null });
    const [ov] = await db.select().from(s.taxRuleOverride).where(eq(s.taxRuleOverride.sourceId, awardId));
    expect(ov).toMatchObject({ ruleId: "us-ca-prize-treaty", decision: "default", appliedRuleId: "us-nonus-prize", approvedBy: t.members.ari });
    expect((await t.run(t.ari, "payout.release", { id: pid })).ok).toBe(true); // separate release step
    // A new form makes the resolution lapse for the next payment from a new award.
    const second = await award(cara.id, "5000");
    await t.run(t.ari, "payout.resolveRule", { sourceType: "award", sourceId: second, use: "rule", reason: "Accept treaty claim per advisor memo 12" });
    const p2 = (await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: second })).data!.payoutId as string;
    expect(await payoutRow(p2)).toMatchObject({ status: "proposed", ruleId: "us-ca-prize-treaty", ruleVerified: false, withholdingMinor: 0n });
    await t.run(cara.self, "tax.submit", { personId: cara.id, form: "W-8BEN", signature: "Cara Lane", certify: true, treatyCountry: "CA", treatyArticle: "XXII" });
    const lapsed = await payoutRow(p2);
    expect(lapsed.status).toBe("held");
    expect(lapsed.reason).toMatch(/no longer applies/);
    // No form: cannot be resolved.
    const dee = await t.person("Dee Moss", "CA", { currency: "CAD" });
    const noForm = await award(dee.id, "5000");
    expect((await t.run(t.ari, "payout.resolveRule", { sourceType: "award", sourceId: noForm, use: "rule", reason: "Please just pay this one" })).message).toMatch(/cannot override a missing form/);
  });

  it("does not count a payment released after a verified bank change as wrongful", async () => {
    const { db, s } = m;
    const jo = await t.person("Jo Park", "US");
    await t.run(jo.self, "tax.submit", { personId: jo.id, form: "W-9", signature: "Jo Park", tin: "123-45-2222", certify: true });
    const pid = (await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: await award(jo.id, "20000") })).data!.payoutId as string;
    await t.run(t.dana, "payout.bankChange", { personId: jo.id, last4: "9902", currency: "USD", requestedVia: "email" });
    await db.insert(s.answerKey).values({ id: `${t.orgId}_kf`, orgId: t.orgId, scenario: "Bank change", objectType: "person", objectId: jo.id, expected: "freeze", description: "" });
    let board = await m.scoreboard.computeScoreboard(db, t.orgId);
    expect(board.results.find((r) => r.id === `${t.orgId}_kf`)?.passed).toBe(true);
    // Verify with the code from the vault (the original channel), then release.
    const [pending] = await db.select().from(s.payoutMethod).where(eq(s.payoutMethod.personId, jo.id));
    const methods = await db.select().from(s.payoutMethod).where(eq(s.payoutMethod.personId, jo.id));
    const pm = methods.find((x) => x.status === "pending_verification") ?? pending;
    const { openSecret } = await import("@/lib/server/vault");
    const code = await m.db.transaction((tx) => openSecret(tx, t.orgId, pm.verificationVaultId!));
    expect((await t.run(jo.self, "payout.verify", { id: jo.id, confirmation: code })).ok).toBe(true);
    expect((await t.run(t.ari, "payout.release", { id: pid })).ok).toBe(true);
    board = await m.scoreboard.computeScoreboard(db, t.orgId);
    expect(board.wrongfulPayouts).toBe(0);
    expect(board.results.find((r) => r.id === `${t.orgId}_kf`)?.passed).toBe(true);
    await db.delete(s.answerKey).where(eq(s.answerKey.orgId, t.orgId));
  });
});

describe.skipIf(!hasDatabase)("CAD organization (real Postgres)", { timeout: 240_000 }, () => {
  let m: Mods;
  let t: Awaited<ReturnType<typeof setupOrg>>;
  beforeAll(async () => {
    m = await load();
    t = await setupOrg(m, "cad");
    await m.db.update(m.s.organization).set({ country: "CA", currency: "CAD" }).where(eq(m.s.organization.id, t.orgId));
  }, 120_000);
  afterAll(async () => {
    if (t?.orgId) await dropTestOrg(t.orgId);
  }, 120_000);

  it("creates CAD cash and item prizes, converts them to the USD books, and resolves CA rules explicitly", async () => {
    const { db, s } = m;
    const eli = await t.person("Eli Ross", "CA", { currency: "CAD" });
    expect((await t.run(eli.self, "tax.submit", { personId: eli.id, form: "W-8BEN", signature: "Eli Ross", certify: true })).data?.status).toBe("review"); // wrong form for a CA payer
    expect((await t.run(eli.self, "tax.submit", { personId: eli.id, form: "Residency declaration", signature: "Eli Ross", certify: true })).data?.status).toBe("valid");
    const cash = await t.run(t.dana, "award.create", { personId: eli.id, track: "Best Hack", title: "First", kind: "cash", amountMinor: "100000" });
    expect(cash.ok, cash.message).toBe(true);
    const cashId = (cash.data!.ids as string[])[0];
    const [a] = await db.select().from(s.award).where(eq(s.award.id, cashId));
    expect(a.currency).toBe("CAD");
    expect((await t.run(t.dana, "award.create", { personId: eli.id, track: "Judge stipend", title: "Judge", kind: "cash", amountMinor: "20000" })).ok).toBe(true);
    const item = await t.run(t.dana, "award.create", { personId: eli.id, track: "Hardware", title: "Switch", kind: "item", amountMinor: "45000" });
    expect(item.ok, item.message).toBe(true);
    expect((await t.run(t.dana, "award.create", { personId: eli.id, track: "X", title: "Y", kind: "cash", amountMinor: "100", currency: "EUR" })).status).toBe(400);
    const pid = (await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: cashId })).data!.payoutId as string;
    const p = (await db.select().from(s.payout).where(eq(s.payout.id, pid)))[0];
    expect(p.grossMinor).toBe(72876n); // CAD 1,000.00 at 0.72876 into USD books
    expect(p.currency).toBe("USD");
    expect(p.ruleId).toBe("ca-ca-prize");
    expect(p.status).toBe("held");
    expect(p.reason).toMatch(/CAD 1,000.00 converted/);
    const r = await t.run(t.ari, "payout.resolveRule", { sourceType: "award", sourceId: cashId, use: "rule", reason: "Advisor: contest prize, no withholding, T4A review at year end" });
    expect(r.ok, r.message).toBe(true);
    expect((await db.select().from(s.payout).where(eq(s.payout.id, pid)))[0].status).toBe("proposed");
    // CA reimbursements now name a real (unverified) rule and are not held for it.
    await db.insert(s.claim).values({ id: `${t.orgId}_c`, orgId: t.orgId, eventId: `${t.orgId}_evt`, personId: eli.id, type: "expense", merchant: "Staples", category: "supplies", amountMinor: 5000n, currency: "CAD", usdMinor: 3644n, fxRate: "0.72876000", fxSource: "test", purchasedAt: new Date("2026-10-20T00:00:00Z"), status: "escalated", dueAt: new Date("2026-11-01T00:00:00Z"), requestedBy: `${eli.id}_m` });
    expect((await t.run(t.dana, "claim.review", { id: `${t.orgId}_c`, decision: "approve", reason: "ok" })).ok).toBe(true);
    const [cp] = await db.select().from(s.payout).where(eq(s.payout.claimId, `${t.orgId}_c`));
    expect(cp).toMatchObject({ ruleId: "ca-any-reimbursement", status: "proposed" });
    // Budget caps entered in CAD are compared in USD books.
    await db.insert(s.budgetLine).values({ id: `${t.orgId}_pz`, orgId: t.orgId, eventId: `${t.orgId}_evt`, name: "Prizes", category: "prizes", capMinor: 110000n, fundingSource: "x" });
    const big = (await t.run(t.dana, "award.create", { personId: eli.id, track: "Best Design", title: "First", kind: "cash", amountMinor: "50000" })).data!.ids as string[];
    const over = await t.run(t.dana, "payout.propose", { sourceType: "award", sourceId: big[0] });
    expect(over.status).toBe(409); // CAD 1,100 cap = USD 801.64; 728.76 + 364.38 exceeds it
    expect(over.message).toMatch(/converted to USD books/);
  });
});
