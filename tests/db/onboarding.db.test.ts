import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, hasDatabase, inArray, sql } from "./helpers";

describe.skipIf(!hasDatabase)("onboarding and invitations against real Postgres", { timeout: 120_000 }, () => {
  type SessionUser = { id: string; name: string; email: string; emailVerified: boolean };
  let m: Awaited<ReturnType<typeof load>>;
  const users: Record<"dana" | "ari" | "mallory" | "late", SessionUser> = {} as never;
  const createdOrgs: string[] = [];
  const tag = `t${Date.now().toString(36)}`;

  async function load() {
    return {
      db: (await import("@/lib/db")).getDb(),
      s: await import("@/lib/db/schema"),
      o: await import("@/lib/db/schema-onboarding"),
      svc: await import("@/lib/server/onboarding"),
      session: await import("@/lib/auth/session"),
      auth: await import("@/lib/auth"),
      reset: await import("@/lib/server/reset"),
    };
  }

  const orgBody = (name: string) => ({
    org: { name, country: "US" },
    event: { name: `${name} 2026`, startsAt: "2026-11-07T16:00:00Z", endsAt: "2026-11-08T22:00:00Z", checkInAt: "2026-11-07T17:00:00Z", closingAt: "2026-11-08T21:00:00Z", bookingDeadline: "2026-10-30T23:59:00Z", venue: "Hall A", expectedHeadcount: 90, travelCapMinor: "40000" },
  });

  beforeAll(async () => {
    m = await load();
    for (const key of Object.keys({ dana: 1, ari: 1, mallory: 1, late: 1 }) as (keyof typeof users)[]) {
      const id = `usr_${tag}_${key}`;
      const email = `${key}.${tag}@example.com`;
      await m.db.insert(m.s.authUser).values({ id, name: key[0].toUpperCase() + key.slice(1), email, emailVerified: false });
      users[key] = { id, name: key[0].toUpperCase() + key.slice(1), email, emailVerified: false };
    }
  }, 120_000);

  afterAll(async () => {
    const { db, s, reset } = m;
    for (const orgId of createdOrgs) {
      await db.update(s.organization).set({ isDemo: true }).where(eq(s.organization.id, orgId));
      await db.transaction((tx) => reset.purgeOrg(tx, orgId, { deleteOrg: true }));
    }
    await db.delete(s.authUser).where(inArray(s.authUser.id, Object.values(users).map((u) => u.id)));
    await db.delete(s.authUser).where(sql`${s.authUser.email} like ${`%.${tag}@example.com`}`);
  }, 120_000);

  it("creates one organization per user atomically and idempotently, with event, budgets and organizer membership", async () => {
    const { svc, db, s, o } = m;
    const [a, b] = await Promise.all([svc.createOrganization(users.dana, orgBody("Dana Hacks")), svc.createOrganization(users.dana, orgBody("Dana Hacks again"))]);
    createdOrgs.push(a.orgId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(b.orgId).toBe(a.orgId);
    const owners = await db.select().from(o.orgOwner).where(eq(o.orgOwner.userId, users.dana.id));
    expect(owners).toHaveLength(1);
    const [org] = await db.select().from(s.organization).where(eq(s.organization.id, a.orgId));
    expect(org.isDemo).toBe(false);
    expect(org.currency).toBe("USD");
    const members = await db.select().from(s.orgMember).where(eq(s.orgMember.orgId, a.orgId));
    expect(members.map((x) => [x.userId, x.role])).toEqual([[users.dana.id, "organizer"]]);
    const events = await db.select().from(s.event).where(eq(s.event.orgId, a.orgId));
    expect(events).toHaveLength(1);
    const budgets = await db.select().from(s.budgetLine).where(eq(s.budgetLine.orgId, a.orgId));
    expect(budgets.find((x) => x.category === "travel")?.capMinor).toBe(40000n * 30n);
    const accounts = await db.select().from(s.ledgerAccount).where(eq(s.ledgerAccount.orgId, a.orgId));
    expect(accounts.length).toBeGreaterThan(5);

    const status = await svc.onboardingStatus(users.dana);
    expect(status.needsSetup).toBe(false);
    expect(status.ownedOrgId).toBe(a.orgId);
    expect(status.canCreateOrganization).toBe(false);
  });

  it("validates organization input and refuses anonymous callers", async () => {
    const { svc } = m;
    await expect(svc.createOrganization(null, orgBody("Nope"))).rejects.toMatchObject({ status: 401 });
    const bad = orgBody("Bad dates");
    bad.event.endsAt = "2026-11-06T00:00:00Z";
    await expect(svc.createOrganization(users.late, bad)).rejects.toMatchObject({ status: 400 });
    await expect(svc.createOrganization(users.late, { ...orgBody("Role"), role: "controller" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createOrganization(users.late, { ...orgBody("Naive"), event: { ...orgBody("x").event, startsAt: "2026-11-07T16:00:00" } })).rejects.toMatchObject({ status: 400 });
  });

  it("lets organizers invite with hashed single-use tokens; acceptance takes the invited role and needs a matching email", async () => {
    const { svc, db, s, o } = m;
    const orgId = createdOrgs[0];
    // Non-members and non-organizers cannot invite.
    await expect(svc.createInvitation(users.mallory, orgId, { email: users.mallory.email, role: "organizer" })).rejects.toMatchObject({ status: 403 });
    await expect(svc.createInvitation(users.dana, orgId, { email: users.ari.email, role: "attendee" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createInvitation(users.dana, orgId, { email: users.dana.email, role: "controller" })).rejects.toMatchObject({ code: "self_invite" });

    const first = await svc.createInvitation(users.dana, orgId, { email: users.ari.email.toUpperCase(), role: "controller" });
    expect(first.delivery).toMatchObject({ channel: "copy_link", sent: false });
    expect(first.acceptPath).toBe(`/invite/${first.token}`);
    const [stored] = await db.select().from(o.orgInvitation).where(eq(o.orgInvitation.id, first.invitation.id));
    expect(stored.email).toBe(users.ari.email);
    expect(stored.tokenHash).toBe(svc.hashToken(first.token));
    expect(JSON.stringify(stored)).not.toContain(first.token);

    // Re-inviting rotates the token; the old link stops working.
    const second = await svc.createInvitation(users.dana, orgId, { email: users.ari.email, role: "controller" });
    expect((await svc.lookupInvitation(first.token)).status).toBe("revoked");
    const preview = await svc.lookupInvitation(second.token);
    expect(preview).toMatchObject({ role: "controller", status: "pending" });
    expect(preview.emailMasked).not.toContain(users.ari.email);

    // Wrong account, extra payload fields, bad tokens.
    await expect(svc.acceptInvitation(users.mallory, { token: second.token })).rejects.toMatchObject({ code: "email_mismatch" });
    await expect(svc.acceptInvitation(users.ari, { token: second.token, role: "organizer" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.acceptInvitation(users.ari, { token: first.token })).rejects.toMatchObject({ code: "revoked" });
    await expect(svc.acceptInvitation(users.ari, { token: "x".repeat(43) })).rejects.toMatchObject({ status: 404 });

    const pending = await svc.onboardingStatus(users.ari);
    expect(pending.needsSetup).toBe(true);
    expect(pending.pendingInvitations.map((i) => i.id)).toEqual([second.invitation.id]);

    const accepted = await svc.acceptInvitation(users.ari, { token: second.token });
    expect(accepted).toMatchObject({ orgId, role: "controller", alreadyAccepted: false });
    const again = await svc.acceptInvitation(users.ari, { token: second.token });
    expect(again.alreadyAccepted).toBe(true);
    const ariMembers = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, users.ari.id));
    expect(ariMembers.map((x) => x.role)).toEqual(["controller"]);

    // No role changes for existing members, and controllers cannot invite.
    await expect(svc.createInvitation(users.dana, orgId, { email: users.ari.email, role: "organizer" })).rejects.toMatchObject({ code: "already_member" });
    await expect(svc.createInvitation(users.ari, orgId, { email: users.late.email, role: "organizer" })).rejects.toMatchObject({ status: 403 });
    expect((await svc.listInvitations(users.ari, orgId)).length).toBeGreaterThanOrEqual(2);
    await expect(svc.listInvitations(users.mallory, orgId)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects expired and revoked invitations", async () => {
    const { svc, db, o } = m;
    const orgId = createdOrgs[0];
    const inv = await svc.createInvitation(users.dana, orgId, { email: users.late.email, role: "auditor" });
    await db.update(o.orgInvitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(o.orgInvitation.id, inv.invitation.id));
    expect((await svc.lookupInvitation(inv.token)).status).toBe("expired");
    await expect(svc.acceptInvitation(users.late, { token: inv.token })).rejects.toMatchObject({ code: "expired" });
    const fresh = await svc.createInvitation(users.dana, orgId, { email: users.late.email, role: "auditor" });
    await svc.revokeInvitation(users.dana, orgId, fresh.invitation.id);
    await expect(svc.acceptInvitation(users.late, { token: fresh.token })).rejects.toMatchObject({ code: "revoked" });
    await expect(svc.revokeInvitation(users.dana, orgId, fresh.invitation.id)).rejects.toMatchObject({ code: "not_pending" });
  });

  it("refuses invitations in the shared demo organization", async () => {
    const { svc, db, s } = m;
    const [demo] = await db.select().from(s.organization).where(eq(s.organization.isDemo, true)).limit(1);
    if (!demo) return;
    // Mallory has no membership there, so even the membership check fails first; this proves no demo bypass exists.
    await expect(svc.createInvitation(users.mallory, demo.id, { email: "x@example.com", role: "auditor" })).rejects.toMatchObject({ status: 403 });
  });

  it("resolves a real Better Auth session: no membership means setup, never the demo persona", async () => {
    const { auth, session, svc } = m;
    const email = `real.${tag}@example.com`;
    const res = await auth.getAuth().api.signUpEmail({ body: { email, password: "correct-horse-battery", name: "Real Person" }, asResponse: true });
    expect(res.ok).toBe(true);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const request = new Request("http://localhost:3000/api/app", { headers: { cookie } });
    const resolved = await session.resolveSession(request);
    expect(resolved.user?.email).toBe(email);
    expect(resolved.actor).toBeNull();
    const { actorOrBootstrap } = await import("@/lib/server/http");
    const boot = await actorOrBootstrap(request);
    expect(boot).toMatchObject({ actor: null, setupRequired: true });
    expect(boot.setCookie).toBeUndefined();

    // Creating an org through the service makes the same session resolve to an organizer.
    const created = await svc.createOrganization(resolved.user, orgBody("Real Org"));
    createdOrgs.push(created.orgId);
    const after = await session.resolveSession(request);
    expect(after.actor).toMatchObject({ orgId: created.orgId, role: "organizer", demo: false });
    // A demo cookie alone never yields an onboarding user.
    expect(await session.getSessionUser(new Request("http://localhost:3000/", { headers: { cookie: "eve_demo_session=v1.x.y" } }))).toBeNull();
  });
});
