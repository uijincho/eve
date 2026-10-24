import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { and, createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";

// Real (non-demo) organization: verification codes never reach a snapshot, and
// delivery goes only to the pending method's recorded email. fetch is stubbed;
// nothing leaves the machine.
describe.skipIf(!hasDatabase)("bank change verification delivery against real Postgres", { timeout: 120_000 }, () => {
  let orgId = "";
  let m: Awaited<ReturnType<typeof load>>;
  const ids = { ada: "", organizer: "", adaMember: "" };

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      services: await import("@/lib/server/services"),
      snapshot: await import("@/lib/server/snapshot"),
      vault: await import("@/lib/server/vault"),
      delivery: await import("@/lib/server/bank-verification-delivery"),
    };
  }
  const actor = (memberId: string, role: "attendee" | "organizer", personId: string | null = null) =>
    ({ memberId, orgId, role, name: memberId, email: `${memberId}@example.com`, personId, demo: false, userId: null });

  beforeAll(async () => {
    m = await load();
    const { db, s } = m;
    orgId = await createTestOrg("bankverify");
    // A real organization for the duration of the test; dropTestOrg restores the demo flag before purging.
    await db.update(s.organization).set({ isDemo: false }).where(eq(s.organization.id, orgId));
    await db.insert(s.event).values({ id: `${orgId}_evt`, orgId, name: "Test Hacks", startsAt: new Date("2026-11-07T16:00:00Z"), endsAt: new Date("2026-11-08T22:00:00Z"), venue: "Test", travelCapMinor: 50000n, bookingDeadline: new Date("2026-10-30T00:00:00Z"), checkInAt: new Date("2026-11-07T20:30:00Z"), closingAt: new Date("2026-11-08T21:00:00Z") });
    ids.ada = `${orgId}_ada`;
    // A deliverable-looking address so the adapter's live path is exercised (fetch is stubbed).
    await db.insert(s.person).values({ id: ids.ada, orgId, name: "Ada Park", email: `ada.${orgId.toLowerCase()}@eve-fixture.dev`, country: "US", citizenship: "US", dateOfBirth: "1990-01-01", address: "Oakland", adult: true, payoutCurrency: "USD" });
    await db.insert(s.payoutMethod).values({ id: `${ids.ada}_pm`, orgId, personId: ids.ada, currency: "USD", last4: "1111", status: "active", version: 1, requestedBy: "seed" });
    Object.assign(ids, { organizer: `${orgId}_dana`, adaMember: `${orgId}_m_ada` });
    await db.insert(s.orgMember).values([
      { id: ids.organizer, orgId, role: "organizer", name: "Dana", email: `dana.${orgId}@example.com` },
      { id: ids.adaMember, orgId, role: "attendee", name: "Ada Park", email: `ada.${orgId}@example.com`, personId: ids.ada },
    ]);
  }, 120_000);

  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    if (!orgId) return;
    await m.db.update(m.s.organization).set({ isDemo: true }).where(eq(m.s.organization.id, orgId));
    await dropTestOrg(orgId);
  }, 120_000);

  async function pendingCode() {
    const { db, s, vault } = m;
    const [pending] = await db.select().from(s.payoutMethod).where(and(eq(s.payoutMethod.personId, ids.ada), eq(s.payoutMethod.status, "pending_verification")));
    return { pending, code: (await vault.openSecret(db, orgId, pending.verificationVaultId!))! };
  }

  it("never shows the code in a real session, even to the attendee who asked for the change", async () => {
    const ada = actor(ids.adaMember, "attendee", ids.ada);
    vi.stubEnv("EVE_DEMO_MODE", "true");
    const change = await m.services.runAuthorizedAction(ada, "payout.bankChange", { personId: ids.ada, last4: "9999", currency: "USD", accountNumber: "000123459999" });
    expect(change.ok).toBe(true);
    const { code } = await pendingCode();
    // Even a forged demo flag does not unlock it in a real org.
    for (const view of [await m.snapshot.buildSnapshot(ada), await m.snapshot.buildSnapshot({ ...ada, demo: true }), await m.snapshot.buildSnapshot(actor(ids.organizer, "organizer"))]) {
      expect(JSON.stringify(view)).not.toContain(code);
    }
    expect(JSON.stringify(change)).not.toContain(code);
  });

  it("records an honest undelivered notice and keeps the change pending when email is not live", async () => {
    const { db, s, delivery } = m;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("EVE_NOTIFICATIONS_LIVE", "false");
    const { pending, code } = await pendingCode();
    const result = await delivery.deliverBankVerification(orgId, pending.id);
    expect(result.status).toBe("simulated");
    expect(JSON.stringify(result)).not.toContain(code);
    expect(fetcher).not.toHaveBeenCalled();
    const [notice] = await db.select().from(s.notice).where(eq(s.notice.privateVaultId, pending.verificationVaultId!));
    expect(notice.status).toBe("simulated");
    expect(notice.body).toContain("has not been delivered: email delivery is not configured");
    expect(notice.body).not.toContain(code);
    // Retrying does not duplicate the organizer alert.
    await delivery.deliverBankVerification(orgId, pending.id);
    const alerts = await db.select().from(s.notice).where(and(eq(s.notice.orgId, orgId), eq(s.notice.channel, "organizers"), eq(s.notice.status, "queued")));
    expect(alerts.filter((n) => n.title.startsWith("Bank change code not delivered"))).toHaveLength(1);
    const [still] = await db.select().from(s.payoutMethod).where(eq(s.payoutMethod.id, pending.id));
    expect(still.status).toBe("pending_verification");
  });

  it("emails the code only to the recorded address when live, once, and never returns it", async () => {
    const { db, s, delivery } = m;
    vi.stubEnv("EVE_NOTIFICATIONS_LIVE", "true");
    vi.stubEnv("RESEND_API_KEY", "re_fixture_not_a_key");
    vi.stubEnv("EVE_EMAIL_FROM", "Eve <eve@eve-fixture.dev>");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_fixture" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { pending, code } = await pendingCode();
    const result = await delivery.deliverBankVerification(orgId, pending.id);
    expect(result.status).toBe("sent");
    expect(JSON.stringify(result)).not.toContain(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetcher.mock.calls[0][1].body as string) as { to: string[]; text: string };
    expect(sent.to).toEqual([pending.verificationSentTo]);
    expect(sent.text).toContain(code);
    const [notice] = await db.select().from(s.notice).where(eq(s.notice.privateVaultId, pending.verificationVaultId!));
    expect(notice.status).toBe("sent");
    expect(notice.body).not.toContain(code);
    expect((await delivery.deliverBankVerification(orgId, pending.id)).status).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Unknown or cross-org ids do nothing.
    expect((await delivery.deliverBankVerification("org_other", pending.id)).status).toBe("skipped");
  });
});
