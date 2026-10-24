// Sponsor packets carry their own amounts: the sponsor sends gross less
// withholding with no Eve provider fee, so the packet PDF, the submitted
// payout and the reconciled payout must show that amount converted at the
// payout's locked rate, not the direct-wire quote's fee-deducted figure. An
// accepted shortfall records what the payee actually received.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

vi.mock("@/lib/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf")>();
  return { ...actual, renderPayoutPacket: vi.fn(actual.renderPayoutPacket) };
});

describe.skipIf(!hasDatabase)("sponsor packet destination amounts (real Postgres)", { timeout: 180_000 }, () => {
  let m: {
    db: ReturnType<typeof import("@/lib/db").getDb>;
    s: typeof import("@/lib/db/schema");
    services: typeof import("@/lib/server/services");
    engines: typeof import("@/lib/server/engines");
    pdf: typeof import("@/lib/pdf");
    convert: typeof import("@/lib/engines/money").convertMinor;
    payoutFees: typeof import("@/lib/client/derive").payoutFees;
  };
  let orgId = "";
  const actor = (memberId: string, role: "attendee" | "organizer" | "controller", personId: string | null = null, email = `${memberId}@example.com`) =>
    ({ memberId, orgId, role, name: memberId, email, personId, demo: false, userId: null });
  const run = (a: ReturnType<typeof actor>, action: string, payload: unknown) => m.services.runAuthorizedAction(a, action, payload);
  const dana = () => actor(`${orgId}_dana`, "organizer");
  const ari = () => actor(`${orgId}_ari`, "controller");
  let n = 0;

  beforeAll(async () => {
    m = {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      services: await import("@/lib/server/services"),
      engines: await import("@/lib/server/engines"),
      pdf: await import("@/lib/pdf"),
      convert: (await import("@/lib/engines/money")).convertMinor,
      payoutFees: (await import("@/lib/client/derive")).payoutFees,
    };
    const { db, s } = m;
    orgId = await createTestOrg("sponsor-dest");
    // Recipient bears fees, so the direct-wire quote deducts the provider fee from net and destination.
    await db.update(s.organization).set({ mode: "hybrid", feesPaidBy: "recipient", sponsorName: "Test Sponsor" }).where(eq(s.organization.id, orgId));
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Sponsor Hacks", startsAt: new Date("2026-10-24T16:00:00Z"), endsAt: new Date("2026-10-25T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-12-31T00:00:00Z"), checkInAt: new Date("2026-10-24T20:30:00Z"), closingAt: new Date("2026-10-25T22:00:00Z") });
    await db.insert(s.taxRule).values(m.engines.startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
    await db.insert(s.orgMember).values([
      { id: `${orgId}_dana`, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      { id: `${orgId}_ari`, orgId, role: "controller", name: "Ari", email: `ari.${orgId}@example.com` },
    ]);
  }, 120_000);
  afterAll(async () => {
    if (orgId) await dropTestOrg(orgId);
  }, 120_000);

  const payoutRow = async (id: string) => (await m.db.select().from(m.s.payout).where(eq(m.s.payout.id, id)))[0];
  const packetRow = async (id: string) => (await m.db.select().from(m.s.sponsorPacket).where(eq(m.s.sponsorPacket.id, id)))[0];

  /** US payee (W-9, no withholding) paid in `currency`, with a proposed award payout. */
  async function proposed(currency: string, amount: string) {
    const { db, s } = m;
    const id = `${orgId}_p${++n}`;
    const email = `p${n}.${orgId}@example.com`;
    await db.insert(s.person).values({ id, orgId, name: `Payee ${n}`, email, country: "US", citizenship: "US", dateOfBirth: "1995-01-01", address: "Oakland, CA", adult: true, payoutCurrency: currency });
    await db.insert(s.payoutMethod).values({ id: `${id}_pm`, orgId, personId: id, currency, last4: "1111", status: "active", version: 1, requestedBy: "seed" });
    await db.insert(s.orgMember).values({ id: `${id}_m`, orgId, role: "attendee", name: `Payee ${n}`, email, personId: id });
    const self = actor(`${id}_m`, "attendee", id, email);
    const tax = await run(self, "tax.submit", { personId: id, form: "W-9", signature: `Payee ${n}`, tin: `123-45-${String(6000 + n)}`, certify: true });
    expect(tax.ok, tax.message).toBe(true);
    const aw = await run(dana(), "award.create", { personId: id, track: "Track", title: "Prize", kind: "cash", amountMinor: amount });
    expect(aw.ok, aw.message).toBe(true);
    const pr = await run(dana(), "payout.propose", { sourceType: "award", sourceId: (aw.data!.ids as string[])[0] });
    expect(pr.ok, pr.message).toBe(true);
    const pid = pr.data!.payoutId as string;
    const quoted = await payoutRow(pid);
    expect(quoted.status).toBe("proposed");
    expect(quoted.withholdingMinor).toBe(0n);
    return { pid, quoted };
  }

  /** Drafts and submits a packet; returns the packet id and the PDF amounts. */
  async function sendToSponsor(pid: string) {
    const render = vi.mocked(m.pdf.renderPayoutPacket);
    render.mockClear();
    const created = await run(dana(), "sponsor.create", { payoutId: pid });
    expect(created.ok, created.message).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    const amounts = render.mock.calls[0][0].amounts;
    const sub = await run(ari(), "sponsor.submit", { id: created.data!.id as string });
    expect(sub.ok, sub.message).toBe(true);
    return { pk: created.data!.id as string, amounts };
  }

  async function balances(pid: string, pk: string) {
    const { db, s } = m;
    const lines = await db.select({ account: s.journalLine.accountId, d: s.journalLine.debitMinor, c: s.journalLine.creditMinor, src: s.journalEntry.sourceId })
      .from(s.journalLine).innerJoin(s.journalEntry, eq(s.journalEntry.id, s.journalLine.entryId)).where(eq(s.journalEntry.orgId, orgId));
    const mine = lines.filter((l) => l.src === pid || l.src === pk);
    const bal = (code: string) => mine.filter((l) => l.account.endsWith(`:${code}`)).reduce((x, l) => x + l.d - l.c, 0n);
    return { ap: bal("2000"), due: bal("1100"), expense: bal("5100"), fees: bal("5300") };
  }

  for (const currency of ["CAD", "USD"]) {
    it(`${currency}: packet PDF, submitted and fully reconciled payout use the sponsor amount at the locked rate`, async () => {
      const { pid, quoted } = await proposed(currency, "10000");
      const expected = m.convert(10000n, "USD", currency, quoted.fxRate);
      // The direct-wire quote deducted the recipient's provider fee; the sponsor path has none.
      expect(quoted.netMinor).toBeLessThan(10000n);
      expect(quoted.destinationNetMinor).not.toBe(expected);
      const { pk, amounts } = await sendToSponsor(pid);
      expect(amounts).toMatchObject({ grossMinor: "10000", withholdingMinor: "0", feeMinor: "0", netMinor: "10000", destinationCurrency: currency, destinationNetMinor: expected.toString(), fxRate: quoted.fxRate });
      expect(Boolean(amounts.fxSource)).toBe(currency !== "USD");
      const sent = await payoutRow(pid);
      expect(sent).toMatchObject({ status: "processing", grossMinor: 10000n, withholdingMinor: 0n, feeMinor: 0n, netMinor: 10000n, destinationNetMinor: expected, fxRate: quoted.fxRate });
      const full = await run(dana(), "sponsor.reconcile", { id: pk, paidMinor: "10000" });
      expect(full.data?.status, full.message).toBe("paid");
      const paid = await payoutRow(pid);
      expect(paid).toMatchObject({ status: "paid", grossMinor: 10000n, withholdingMinor: 0n, feeMinor: 0n, netMinor: 10000n, destinationNetMinor: expected, fxRate: quoted.fxRate });
      if (currency !== "USD") expect(paid.reason).toContain(`1 USD = ${quoted.fxRate} ${currency}`);
      expect(await balances(pid, pk)).toEqual({ ap: 0n, due: -10000n, expense: 10000n, fees: 0n });
    });

    it(`${currency}: an accepted recipient-borne shortfall records the received net, the fee and the converted destination`, async () => {
      const { pid, quoted } = await proposed(currency, "20000");
      const { pk } = await sendToSponsor(pid);
      const accept = await run(ari(), "sponsor.reconcile", { id: pk, paidMinor: "17500", acceptShortfall: true, note: "Intermediary bank deduction" });
      expect(accept.data?.status, accept.message).toBe("paid");
      const paid = await payoutRow(pid);
      const received = m.convert(17500n, "USD", currency, quoted.fxRate);
      expect(paid).toMatchObject({ status: "paid", grossMinor: 20000n, withholdingMinor: 0n, feeMinor: 2500n, netMinor: 17500n, destinationNetMinor: received, fxRate: quoted.fxRate });
      expect(paid.reason).toMatch(/recipient bears/);
      if (currency !== "USD") expect(paid.reason).toContain(`1 USD = ${quoted.fxRate} ${currency}`);
      // The whole fee is the recipient's; the org bore none of it.
      expect(m.payoutFees({ grossMinor: paid.grossMinor.toString(), withholdingMinor: paid.withholdingMinor.toString(), netMinor: paid.netMinor.toString(), feeMinor: paid.feeMinor.toString() })).toEqual({ recipient: 2500n, org: 0n });
      expect(await packetRow(pk)).toMatchObject({ status: "paid", requestedMinor: 20000n, paidMinor: 17500n });
      // The sponsor sent the full request: AP settles in full, no org fee expense posts.
      expect(await balances(pid, pk)).toEqual({ ap: 0n, due: -20000n, expense: 20000n, fees: 0n });
    });
  }
});
