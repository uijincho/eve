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

  it("maps onboarding errors to JSON 4xx even across duplicated module instances", async () => {
    const { svc } = m;
    const { onboardingRoute } = await import("@/lib/server/http");
    const direct = await onboardingRoute(async () => { throw new svc.OnboardingError(410, "expired", "This invitation expired."); });
    expect(direct.status).toBe(410);
    expect(await direct.json()).toEqual({ ok: false, code: "expired", message: "This invitation expired." });
    // A copy of the class from a second bundle instance carries the same brand.
    const foreign = Object.assign(new Error("Sign in."), { status: 401, code: "unauthenticated", [Symbol.for("eve.onboarding-error")]: true });
    expect((await onboardingRoute(async () => { throw foreign; })).status).toBe(401);
    expect(svc.isOnboardingError(Object.assign(new Error("x"), { name: "OnboardingError", status: 400, code: "invalid" }))).toBe(false);
    await expect(onboardingRoute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
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

    // Pending invitations are listed only to a verified email; anyone can register an address they do not own.
    const unverified = await svc.onboardingStatus(users.ari);
    expect(unverified.needsSetup).toBe(true);
    expect(unverified).toMatchObject({ pendingInvitations: [], pendingInvitationsHidden: true });
    const pending = await svc.onboardingStatus({ ...users.ari, emailVerified: true });
    expect(pending.pendingInvitationsHidden).toBe(false);
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

  it("links an imported adult attendee to a real account through an attendee-only invite", async () => {
    const { svc, db, s, auth, session } = m;
    const orgId = createdOrgs[0];
    const services = await import("@/lib/server/services");
    const { buildSnapshot } = await import("@/lib/server/snapshot");
    const [danaMember] = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, users.dana.id));
    const dana = { memberId: danaMember.id, orgId, role: "organizer" as const, name: "Dana", email: users.dana.email, personId: null, demo: false, userId: users.dana.id };
    const emails = { ada: `ada.${tag}@example.com`, kid: `kid.${tag}@example.com`, moe: `moe.${tag}@example.com`, zed: `zed.${tag}@example.com` };
    const imported = await services.runAuthorizedAction(dana, "people.import", { people: [
      { name: "Ada Okoro", email: emails.ada, country: "CA", dateOfBirth: "1998-02-01" },
      { name: "Kid Young", email: emails.kid, country: "US", dateOfBirth: "2010-06-01" },
      { name: "Moe Park", email: emails.moe, country: "US", dateOfBirth: "1990-06-01" },
      { name: "Zed Lin", email: emails.zed, country: "US", dateOfBirth: "1991-06-01" },
    ] });
    expect(imported.ok).toBe(true);
    const people = await db.select().from(s.person).where(eq(s.person.orgId, orgId));
    const byEmail = (e: string) => people.find((p) => p.email === e)!;

    // Staff invite form cannot mint attendee roles; attendee invites cannot target minors or other orgs' people.
    await expect(svc.createInvitation(users.dana, orgId, { email: emails.ada, role: "attendee" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.kid).id })).rejects.toMatchObject({ code: "minor" });
    await expect(svc.createAttendeeInvitation(users.ari, orgId, { personId: byEmail(emails.ada).id })).rejects.toMatchObject({ status: 403 });
    await expect(svc.createAttendeeInvitation(users.dana, orgId, { personId: "per_missing" })).rejects.toMatchObject({ status: 404 });
    await expect(svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.ada).id, role: "controller" })).rejects.toMatchObject({ status: 400 });

    const invite = await svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.ada).id });
    expect(invite.invitation.role).toBe("attendee");
    expect(invite.acceptPath).toBe(`/invite/${invite.token}`);
    expect((await svc.lookupInvitation(invite.token)).role).toBe("attendee");

    // Wrong account is refused; payload cannot ask for a staff role.
    await expect(svc.acceptInvitation(users.mallory, { token: invite.token })).rejects.toMatchObject({ code: "email_mismatch" });

    const res = await auth.getAuth().api.signUpEmail({ body: { email: emails.ada, password: "correct-horse-battery", name: "Ada O." }, asResponse: true });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const request = new Request("http://localhost:3000/api/app", { headers: { cookie } });
    const adaUser = (await session.getSessionUser(request))!;
    await expect(svc.acceptInvitation(adaUser, { token: invite.token, role: "organizer" })).rejects.toMatchObject({ status: 400 });
    const accepted = await svc.acceptInvitation(adaUser, { token: invite.token });
    expect(accepted).toMatchObject({ role: "attendee", personId: byEmail(emails.ada).id });

    const actor = (await session.resolveSession(request)).actor!;
    expect(actor).toMatchObject({ role: "attendee", personId: byEmail(emails.ada).id, demo: false });
    const snap = await buildSnapshot(actor);
    expect(snap.people.map((p) => p.id)).toEqual([byEmail(emails.ada).id]);
    expect(snap.budgets).toEqual([]);
    // Attendees cannot act on staff routes.
    expect((await services.runAuthorizedAction(actor, "org.update", { name: "Mine now" })).status).toBe(403);
    await expect(svc.listMembers(adaUser, orgId)).rejects.toMatchObject({ status: 403 });

    // Records that change after the invite are re-checked at acceptance.
    const moeInvite = await svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.moe).id });
    await db.update(s.person).set({ email: `moe.changed.${tag}@example.com` }).where(eq(s.person.id, byEmail(emails.moe).id));
    const moeUser = { id: users.late.id, name: "Moe", email: emails.moe, emailVerified: false };
    await expect(svc.acceptInvitation(moeUser, { token: moeInvite.token })).rejects.toMatchObject({ code: "person_changed" });
    const zedInvite = await svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.zed).id });
    await db.update(s.person).set({ adult: false, dateOfBirth: "2011-01-01" }).where(eq(s.person.id, byEmail(emails.zed).id));
    await expect(svc.acceptInvitation({ ...moeUser, email: emails.zed }, { token: zedInvite.token })).rejects.toMatchObject({ code: "minor" });

    // A linked attendee cannot be invited again; staff see the member list.
    await expect(svc.createAttendeeInvitation(users.dana, orgId, { personId: byEmail(emails.ada).id })).rejects.toMatchObject({ code: "already_member" });
    const members = await svc.listMembers(users.dana, orgId);
    expect(members.find((x) => x.personId === byEmail(emails.ada).id)).toMatchObject({ role: "attendee", hasAccount: true });
    expect(members.find((x) => x.isYou)?.role).toBe("organizer");
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
