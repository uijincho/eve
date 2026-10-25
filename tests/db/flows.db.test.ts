import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { and, createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

describe.skipIf(!hasDatabase)("business flows against real Postgres", { timeout: 120_000 }, () => {
  let orgId = "";
  type Mods = Awaited<ReturnType<typeof load>>;
  let m: Mods;
  const ids = { priya: "", sam: "", organizer: "", controller: "", auditor: "", priyaMember: "", samMember: "" };

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      services: await import("@/lib/server/services"),
      snapshot: await import("@/lib/server/snapshot"),
      session: await import("@/lib/auth/session"),
      vault: await import("@/lib/server/vault"),
      engines: await import("@/lib/server/engines"),
    };
  }

  const actor = (memberId: string, role: "attendee" | "organizer" | "controller" | "auditor", personId: string | null = null) =>
    ({ memberId, orgId, role, name: memberId, email: `${memberId}@example.com`, personId, demo: false, userId: null });
  const run = (a: ReturnType<typeof actor>, action: string, payload: unknown) => m.services.runAuthorizedAction(a, action, payload);

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("flows");
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Test Hacks", startsAt: new Date("2026-10-24T16:00:00Z"), endsAt: new Date("2026-10-25T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-10T00:00:00Z"), checkInAt: new Date("2026-10-24T20:30:00Z"), closingAt: new Date("2026-10-25T22:00:00Z") });
    await db.insert(s.taxRule).values(m.engines.startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
    await db.insert(s.fxRate).values({ rateDate: "2026-09-01", base: "CAD", quote: "USD", rate: "0.72876000", source: "test" }).onConflictDoNothing();
    ids.priya = `${orgId}_priya`;
    ids.sam = `${orgId}_sam`;
    await db.insert(s.person).values([
      { id: ids.priya, orgId, name: "Priya Raman", email: `priya.${orgId}@example.com`, country: "CA", citizenship: "CA", dateOfBirth: "1999-04-12", address: "Toronto", adult: true, payoutCurrency: "CAD" },
      { id: ids.sam, orgId, name: "Sam Ortiz", email: `sam.${orgId}@example.com`, country: "US", citizenship: "US", dateOfBirth: "1995-01-01", address: "Oakland", adult: true, payoutCurrency: "USD" },
    ]);
    for (const [pid, cur, last4] of [[ids.priya, "CAD", "2208"], [ids.sam, "USD", "1111"]] as const) {
      await db.insert(s.payoutMethod).values({ id: `${pid}_pm`, orgId, personId: pid, currency: cur, last4, status: "active", version: 1, requestedBy: "seed" });
    }
    Object.assign(ids, { organizer: `${orgId}_dana`, controller: `${orgId}_ari`, auditor: `${orgId}_mei`, priyaMember: `${orgId}_m_priya`, samMember: `${orgId}_m_sam` });
    await db.insert(s.orgMember).values([
      { id: ids.organizer, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      { id: ids.controller, orgId, role: "controller", name: "Ari", email: `ari.${orgId}@example.com` },
      { id: ids.auditor, orgId, role: "auditor", name: "Mei", email: `mei.${orgId}@example.com` },
      { id: ids.priyaMember, orgId, role: "attendee", name: "Priya Raman", email: `priya.${orgId}@example.com`, personId: ids.priya },
      { id: ids.samMember, orgId, role: "attendee", name: "Sam Ortiz", email: `sam.${orgId}@example.com`, personId: ids.sam },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (orgId) await dropTestOrg(orgId);
  }, 120_000);

  it("rejects unauthorized roles, payload roles and cross-person attendee actions", async () => {
    const dana = actor(ids.organizer, "organizer");
    const ari = actor(ids.controller, "controller");
    const mei = actor(ids.auditor, "auditor");
    const priya = actor(ids.priyaMember, "attendee", ids.priya);
    expect((await run(mei, "org.update", { name: "Hacked" })).status).toBe(403);
    expect((await run(ari, "payout.propose", { sourceId: "x", sourceType: "claim" })).status).toBe(403);
    expect((await run(priya, "payout.release", { id: "x" })).status).toBe(403);
    expect((await run(priya, "award.create", { personId: ids.priya, track: "t", title: "t", kind: "cash", amountMinor: "100" })).status).toBe(403);
    expect((await run(dana, "org.update", { name: "X", role: "controller" })).status).toBe(400);
    expect((await run(priya, "person.update", { id: ids.sam, address: "Elsewhere" })).status).toBe(403);
    expect((await run(priya, "tax.submit", { personId: ids.sam, form: "W-9", signature: "Sam Ortiz", certify: true })).status).toBe(403);
  });

  it("runs the international prize end to end with controller-only release and a balanced ledger", async () => {
    const { db, s } = m;
    const dana = actor(ids.organizer, "organizer");
    const ari = actor(ids.controller, "controller");
    const priya = actor(ids.priyaMember, "attendee", ids.priya);
    const created = await run(dana, "award.create", { personId: ids.priya, track: "First Overall", title: "MacBook Air", kind: "item", amountMinor: "129900" });
    expect(created.ok).toBe(true);
    const awardId = (created.data!.ids as string[])[0];
    const [a1] = await db.select().from(s.award).where(eq(s.award.id, awardId));
    expect(a1.status).toBe("needs_form");

    expect((await run(dana, "payout.propose", { sourceId: awardId, sourceType: "award" })).status).toBe(409); // item not converted to cash
    expect((await run(priya, "award.choose", { id: awardId, fulfillment: "cash" })).ok).toBe(true);
    expect((await run(priya, "tax.submit", { personId: ids.priya, form: "W-8BEN", signature: "Wrong Name", certify: true })).message).toMatch(/review/);
    const tax = await run(priya, "tax.submit", { personId: ids.priya, form: "W-8BEN", signature: "priya raman", certify: true });
    expect(tax.data?.status).toBe("valid");

    const proposed = await run(dana, "payout.propose", { sourceId: awardId, sourceType: "award" });
    expect(proposed.data?.status).toBe("proposed");
    const payoutId = proposed.data!.payoutId as string;
    const [p] = await db.select().from(s.payout).where(eq(s.payout.id, payoutId));
    expect(p.withholdingMinor).toBe(38970n);
    expect(p.ruleId).toBe("us-nonus-prize");
    expect(p.destinationCurrency).toBe("CAD");
    expect((await run(dana, "payout.propose", { sourceId: awardId, sourceType: "award" })).status).toBe(409); // one live payout per source

    expect((await run(dana, "payout.release", { id: payoutId })).status).toBe(403);
    const released = await run(ari, "payout.release", { id: payoutId });
    expect(released.ok).toBe(true);
    expect((await run(ari, "payout.release", { id: payoutId })).status).toBe(409); // never twice

    const entries = await db.select().from(s.journalEntry).where(eq(s.journalEntry.sourceId, payoutId));
    expect(entries.map((e) => e.idempotencyKey).sort()).toEqual([`accrual:${payoutId}`, `payment:${payoutId}`]);
    const approvals = await db.select().from(s.approval).where(eq(s.approval.objectId, payoutId));
    expect(approvals[0].approverId).toBe(ids.controller);

    const filings = await run(dana, "filings.generate", { year: 2026 });
    expect(filings.data?.count).toBeGreaterThanOrEqual(1);
    const [filing] = await db.select().from(s.filing).where(eq(s.filing.personId, ids.priya));
    expect(filing.form).toBe("1042-S");
    expect(filing.withholdingMinor).toBe(38970n);
  });

  it("rejects release by the requester even if a controller is recorded as requester", async () => {
    const { db, s } = m;
    const dana = actor(ids.organizer, "organizer");
    const ari = actor(ids.controller, "controller");
    const created = await run(dana, "award.create", { personId: ids.sam, track: "Best Hack", title: "Cash", kind: "cash", amountMinor: "50000" });
    const awardId = (created.data!.ids as string[])[0];
    // Sam has no W-9 yet: payout is held, not defaulted.
    const held = await run(dana, "payout.propose", { sourceId: awardId, sourceType: "award" });
    expect(held.data?.status).toBe("held");
    expect((await run(ari, "payout.release", { id: held.data!.payoutId })).status).toBe(409);
    await db.update(s.payout).set({ requestedBy: ids.controller, status: "proposed" }).where(eq(s.payout.id, held.data!.payoutId as string));
    const self = await run(ari, "payout.release", { id: held.data!.payoutId });
    expect(self.status).toBe(403);
    expect(self.message).toMatch(/requested this payout/);
  });

  it("freezes payouts on a bank change and only unfreezes with the code sent to the original contact", async () => {
    const { db, s, vault } = m;
    const dana = actor(ids.organizer, "organizer");
    const ari = actor(ids.controller, "controller");
    const priya = actor(ids.priyaMember, "attendee", ids.priya);
    const sam = actor(ids.samMember, "attendee", ids.sam);
    const created = await run(dana, "award.create", { personId: ids.priya, track: "Hardware", title: "2nd place", kind: "cash", amountMinor: "150000" });
    const awardId = (created.data!.ids as string[])[0];
    const proposed = await run(dana, "payout.propose", { sourceId: awardId, sourceType: "award" });
    const payoutId = proposed.data!.payoutId as string;

    // A "winner" emails new details; the organizer records it.
    const change = await run(dana, "payout.bankChange", { personId: ids.priya, last4: "9902", currency: "CAD", requestedVia: "email", accountNumber: "0012349902" });
    expect(change.ok).toBe(true);
    expect((change.data!.frozen as string[])).toContain(payoutId);
    expect(JSON.stringify(change)).not.toContain("0012349902");
    expect((await run(ari, "payout.release", { id: payoutId })).status).toBe(409);

    // The attacker cannot redirect the code: payloads with an address are rejected outright.
    expect((await run(dana, "payout.verify", { id: ids.priya, confirmation: "000000", email: "attacker@example.com" })).status).toBe(400);
    const wrong = await run(dana, "payout.verify", { id: ids.priya, confirmation: "000000" });
    expect(wrong.ok).toBe(false);
    // Another attendee cannot verify Priya's change.
    expect((await run(sam, "payout.verify", { id: ids.priya, confirmation: "123456" })).status).toBe(403);

    // No real session ever sees the code, not even Priya's; it goes only to her original email.
    const [pending] = await db.select().from(s.payoutMethod).where(and(eq(s.payoutMethod.personId, ids.priya), eq(s.payoutMethod.status, "pending_verification")));
    const code = (await vault.openSecret(db, orgId, pending.verificationVaultId!))!; // stands in for Priya's inbox
    const own = await m.snapshot.buildSnapshot(priya);
    expect(JSON.stringify(own)).not.toContain(code);
    expect(own.notices.find((n) => n.title.includes("Confirm your new payout account"))!.body).toContain("never shows confirmation codes");
    // The shared demo's recipient persona sees it in a labeled simulated inbox, only in demo mode.
    vi.stubEnv("EVE_DEMO_MODE", "true");
    const demoView = await m.snapshot.buildSnapshot({ ...priya, demo: true });
    vi.unstubAllEnvs();
    expect(demoView.notices.find((n) => n.title.includes("Confirm your new payout account"))!.body).toContain(`Your confirmation code: ${code}`);
    const staff = await m.snapshot.buildSnapshot(dana);
    expect(JSON.stringify(staff)).not.toContain(`code: ${code}`);
    expect(JSON.stringify(staff)).not.toContain("0012349902");

    const ok = await run(priya, "payout.verify", { id: ids.priya, confirmation: code });
    expect(ok.ok).toBe(true);
    const [p] = await db.select().from(s.payout).where(eq(s.payout.id, payoutId));
    expect(p.status).toBe("proposed");
    expect(p.bankVersion).toBe(2);
    expect(p.releasedBy).toBeNull();
    expect((await run(ari, "payout.release", { id: payoutId })).ok).toBe(true);
    const methods = await db.select().from(s.payoutMethod).where(eq(s.payoutMethod.personId, ids.priya));
    const method = methods.find((x) => x.status === "active")!;
    expect(method.last4).toBe("9902");
    expect(await vault.openSecret(db, orgId, method.vaultId!)).toBe("0012349902");
  });

  it("never auto-approves hand-entered claims and replays idempotent submissions", async () => {
    const sam = actor(ids.samMember, "attendee", ids.sam);
    const payload = { type: "expense", merchant: "Lyft", amountMinor: "2500", currency: "USD", purchasedAt: "2026-10-20T10:00:00Z", category: "ground_transport", idempotencyKey: `idem-${orgId}` };
    const first = await run(sam, "claim.submit", payload);
    expect(first.ok).toBe(true);
    expect(first.data?.status).not.toBe("approved");
    const again = await run(sam, "claim.submit", payload);
    expect(again.data?.claimId).toBe(first.data?.claimId);
    expect(again.message).toMatch(/already/);
    // Organizer approves (within limit); requester cannot review own claim.
    expect((await run(sam, "claim.review", { id: first.data!.claimId, decision: "approve", reason: "mine" })).status).toBe(403);
    const reviewed = await run(actor(ids.organizer, "organizer"), "claim.review", { id: first.data!.claimId, decision: "approve", reason: "Receipt checked" });
    expect(reviewed.ok).toBe(true);
  });

  it("serializes auto-approvals against the remaining budget line", async () => {
    const { db, s, services } = m;
    // Earlier tests may already have approved ground transport; leave exactly $50 of room.
    const approved = await db.select().from(s.claim).where(eq(s.claim.eventId, `${orgId}_evt`));
    const used = approved.filter((c) => c.category === "ground_transport" && ["approved", "paid"].includes(c.status)).reduce((sum, c) => sum + c.usdMinor, 0n);
    await db.insert(s.budgetLine).values({ id: `${orgId}_bud`, orgId, eventId: `${orgId}_evt`, name: "Ground transport", category: "ground_transport", capMinor: used + 5000n, fundingSource: "General" });
    const base = { orgId, eventId: `${orgId}_evt`, personId: ids.sam, type: "expense" as const, merchant: "BART", category: "ground_transport", amountMinor: 3000n, currency: "USD", usdMinor: 3000n, fxRate: "1.00000000", fxSource: "No conversion", purchasedAt: new Date("2026-10-20T10:00:00Z"), nameOnReceipt: "Sam Ortiz", status: "submitted" as const, dueAt: new Date("2026-10-30T00:00:00Z"), requestedBy: ids.samMember, extracted: { source: "trusted_fixture", corroborated: true, mismatches: [] } };
    await db.insert(s.claim).values([
      { ...base, id: `${orgId}_b1`, receiptName: "b1.pdf", receiptHash: `${orgId}-h1` },
      { ...base, id: `${orgId}_b2`, receiptName: "b2.pdf", receiptHash: `${orgId}-h2`, purchasedAt: new Date("2026-10-21T10:00:00Z") },
    ]);
    const agent = services.agentActor(orgId);
    const results = await Promise.all([services.processClaimById(agent, `${orgId}_b1`), services.processClaimById(agent, `${orgId}_b2`)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["approved", "escalated"]);
    const over = results.find((r) => r.status === "escalated")!;
    expect(over.checks.find((c) => c.code === "budget")?.passed).toBe(false);
  });

  it("filters attendee snapshots to self and hides raw identifiers", async () => {
    const priya = actor(ids.priyaMember, "attendee", ids.priya);
    const snap = await m.snapshot.buildSnapshot(priya);
    expect(snap.people.map((p) => p.id)).toEqual([ids.priya]);
    expect(snap.claims.every((c) => c.personId === ids.priya)).toBe(true);
    expect(snap.payouts.every((p) => p.personId === ids.priya)).toBe(true);
    expect(snap.budgets).toEqual([]);
    expect(snap.packets).toEqual([]);
    expect(snap.scoreboard.total).toBe(0);
  });

  it("signs demo sessions and refuses tampered or non-demo personas", async () => {
    const { createDemoToken, verifyDemoToken } = m.session;
    const token = createDemoToken("mem_x", orgId);
    expect(verifyDemoToken(token)).toEqual({ memberId: "mem_x", orgId });
    const [v, payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ m: "mem_demo_ari", o: orgId, exp: 9e9 })).toString("base64url");
    expect(verifyDemoToken(`${v}.${forged}.${mac}`)).toBeNull();
    expect(verifyDemoToken(`${v}.${payload}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(verifyDemoToken(createDemoToken("mem_x", orgId, 1))).toBeNull(); // expired
    // Members of this org are not demo personas, so they cannot be assumed.
    expect(await m.session.loadDemoPersona(ids.controller)).toBeNull();
  });

  it("stores the filled IRS W-8BEN with only the last four of the foreign TIN, visible to self and staff", async () => {
    const { db, s } = m;
    const zoeId = `${orgId}_zoe`;
    const zoeMember = `${orgId}_m_zoe`;
    await db.insert(s.person).values({ id: zoeId, orgId, name: "Zoë Tremblay", email: `zoe.${orgId}@example.com`, country: "CA", citizenship: "CA", dateOfBirth: "2001-04-12", address: "88 Queen St W, Toronto, ON M5H 2N2", adult: true, payoutCurrency: "CAD" });
    await db.insert(s.orgMember).values({ id: zoeMember, orgId, role: "attendee", name: "Zoë Tremblay", email: `zoe.${orgId}@example.com`, personId: zoeId });
    const zoe = actor(zoeMember, "attendee", zoeId);
    const tin = "987654324321";
    expect((await run(zoe, "tax.submit", { personId: zoeId, form: "W-8BEN", signature: "Zoë Tremblay", tin, ftinNotRequired: true, certify: true })).status).toBe(400);
    expect((await run(zoe, "tax.submit", { personId: zoeId, form: "W-9", signature: "Zoë Tremblay", ftinNotRequired: true, certify: true })).status).toBe(400);
    const signed = await run(zoe, "tax.submit", { personId: zoeId, form: "W-8BEN", signature: "Zoë Tremblay", tin, treatyCountry: "CA", treatyArticle: "Article XXII", certify: true });
    expect(signed.data?.status).toBe("valid");

    const [doc] = await db.select().from(s.document).where(eq(s.document.id, signed.data!.documentId as string));
    expect(doc).toMatchObject({ kind: "tax_form", personId: zoeId, mimeType: "application/pdf" });
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(new Uint8Array(doc.bytes));
    expect(pdf.getPageCount()).toBe(2); // the one-page IRS form plus the signature record
    expect(pdf.getForm().getFields()).toHaveLength(0);
    const { pdfStrings } = await import("../pdf-text");
    const text = await pdfStrings(new Uint8Array(doc.bytes));
    const [profile] = await db.select().from(s.taxProfile).where(and(eq(s.taxProfile.personId, zoeId), eq(s.taxProfile.documentId, doc.id)));
    for (const value of ["Zoë Tremblay", "On file, ending 4321", profile.id, "04-12-2001", "Article XXII", "Prize and award income", "Electronic signature record"]) expect(text).toContain(value);
    expect(text).not.toContain(tin);
    expect(text).not.toContain(tin.slice(0, 8));

    // The person and staff see the document id; another attendee never sees Zoë at all.
    for (const viewer of [zoe, actor(ids.organizer, "organizer"), actor(ids.controller, "controller"), actor(ids.auditor, "auditor")]) {
      const me = (await m.snapshot.buildSnapshot(viewer)).people.find((p) => p.id === zoeId);
      expect(me).toMatchObject({ taxDocumentId: doc.id, taxDocumentForm: "W-8BEN", taxLast4: "4321" });
    }
    const other = await m.snapshot.buildSnapshot(actor(ids.samMember, "attendee", ids.sam));
    expect(JSON.stringify(other)).not.toContain(doc.id);
  });
});
