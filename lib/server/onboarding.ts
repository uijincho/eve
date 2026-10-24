// Real-user onboarding: create an organization (with its single current
// event, default budget lines, ledger accounts and the creator as organizer),
// invite teammates by email, and accept invitations.
//
// Rules:
// - Only a real Better Auth session can onboard; demo personas never can.
// - Organization creation is idempotent per user (org_owner.user_id unique,
//   serialized with a transaction advisory lock): retries return the same org.
// - Invitations: organizers only, roles organizer/controller/auditor, random
//   256-bit token stored as SHA-256, 7-day TTL, single use. Acceptance takes
//   the role from the invitation row, never from the request, and requires the
//   signed-in user's email to match the invited email. Existing members cannot
//   change role through an invitation.
// - Delivery is honest: no email provider is configured, so the organizer gets
//   a copy-link and the invitee sees pending invites in GET /api/onboarding.

import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { appOrigin } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth/session";
import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { orgInvitation, orgOwner } from "@/lib/db/schema-onboarding";
import { startingRules } from "@/lib/engines";
import { ensureAccounts } from "@/lib/ledger";

import { maskEmail, recordDecision } from "./core";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITABLE_ROLES = ["organizer", "controller", "auditor"] as const;

export class OnboardingError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 410, public readonly code: string, message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

// ------------------------------------------------------------------ schemas

const minor = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform((v) => BigInt(v));
const instant = z.string().refine((v) => /(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)), "Use an ISO date-time with Z or an offset").transform((v) => new Date(v));

export const createOrganizationSchema = z.strictObject({
  org: z.strictObject({
    name: z.string().trim().min(2).max(120),
    country: z.enum(["US", "CA"]),
    currency: z.enum(["USD", "CAD"]).optional(),
    mode: z.enum(["direct", "sponsor", "hybrid"]).default("hybrid"),
    sponsorName: z.string().trim().max(160).default(""),
    sponsorTurnaroundDays: z.number().int().min(0).max(120).default(10),
    feesPaidBy: z.enum(["org", "recipient"]).default("org"),
    agentLimitMinor: minor.default(30000n),
    organizerLimitMinor: minor.default(200000n),
    notificationChannel: z.string().trim().max(200).optional(),
    policyNotes: z.string().trim().max(2000).optional(),
  }),
  event: z.strictObject({
    name: z.string().trim().min(2).max(160),
    startsAt: instant, endsAt: instant, checkInAt: instant, closingAt: instant, bookingDeadline: instant,
    venue: z.string().trim().min(1).max(200),
    expectedHeadcount: z.number().int().min(1).max(100000),
    travelCapMinor: minor,
    economyOnly: z.boolean().default(true),
  }),
  budgets: z.array(z.strictObject({
    name: z.string().trim().min(1).max(120), category: z.string().trim().regex(/^[a-z_]{2,40}$/), capMinor: minor, fundingSource: z.string().trim().min(1).max(120),
  })).max(20).optional(),
}).superRefine((v, ctx) => {
  const e = v.event;
  if (e.endsAt <= e.startsAt) ctx.addIssue({ code: "custom", path: ["event", "endsAt"], message: "The event must end after it starts." });
  if (e.checkInAt < e.startsAt || e.checkInAt > e.endsAt) ctx.addIssue({ code: "custom", path: ["event", "checkInAt"], message: "Check-in must fall within the event." });
  if (e.closingAt < e.startsAt || e.closingAt > e.endsAt) ctx.addIssue({ code: "custom", path: ["event", "closingAt"], message: "Closing must fall within the event." });
  if (e.bookingDeadline > e.startsAt) ctx.addIssue({ code: "custom", path: ["event", "bookingDeadline"], message: "The booking deadline must be before the event starts." });
  const cats = v.budgets?.map((b) => b.category) ?? [];
  if (new Set(cats).size !== cats.length) ctx.addIssue({ code: "custom", path: ["budgets"], message: "Budget categories must be unique." });
});

export const createInvitationSchema = z.strictObject({ email: z.email().max(200), role: z.enum(INVITABLE_ROLES) });
export const createAttendeeInvitationSchema = z.strictObject({ personId: z.string().min(1).max(80) });
export const acceptInvitationSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation token") });
export const selectOrgSchema = z.strictObject({ orgId: z.string().min(1).max(80) });

export type CreateOrganizationInput = z.output<typeof createOrganizationSchema>;

// ------------------------------------------------------------------ helpers

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function slugify(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
}

function requireRealUser(user: SessionUser | null): SessionUser {
  if (!user) throw new OnboardingError(401, "unauthenticated", "Sign in with your account to continue.");
  return user;
}

async function memberOf(db: Executor, userId: string, orgId: string) {
  const [row] = await db.select({ member: s.orgMember, isDemo: s.organization.isDemo, orgName: s.organization.name })
    .from(s.orgMember).innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
    .where(and(eq(s.orgMember.userId, userId), eq(s.orgMember.orgId, orgId)));
  return row;
}

export function invitePath(token: string) {
  return `/invite/${token}`;
}

// --------------------------------------------------------------- status

export async function onboardingStatus(userIn: SessionUser | null, db: Executor = getDb()) {
  const user = requireRealUser(userIn);
  const memberships = await db.select({ memberId: s.orgMember.id, orgId: s.orgMember.orgId, role: s.orgMember.role, orgName: s.organization.name, isDemo: s.organization.isDemo })
    .from(s.orgMember).innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
    .where(eq(s.orgMember.userId, user.id)).orderBy(asc(s.orgMember.createdAt));
  const [owned] = await db.select({ orgId: orgOwner.orgId }).from(orgOwner).where(eq(orgOwner.userId, user.id));
  const invitations = await db.select({ id: orgInvitation.id, orgId: orgInvitation.orgId, orgName: s.organization.name, role: orgInvitation.role, expiresAt: orgInvitation.expiresAt, invitedByName: s.orgMember.name })
    .from(orgInvitation)
    .innerJoin(s.organization, eq(s.organization.id, orgInvitation.orgId))
    .innerJoin(s.orgMember, eq(s.orgMember.id, orgInvitation.invitedBy))
    .where(and(eq(orgInvitation.email, user.email), eq(orgInvitation.status, "pending"), gt(orgInvitation.expiresAt, new Date())))
    .orderBy(desc(orgInvitation.createdAt));
  return {
    user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    memberships,
    ownedOrgId: owned?.orgId ?? null,
    // Accepting from this list still needs the token from the invite link; the list tells the invitee to ask for it.
    pendingInvitations: invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
    needsSetup: memberships.length === 0,
    canCreateOrganization: !owned,
  };
}

// ------------------------------------------------------- create organization

export async function createOrganization(userIn: SessionUser | null, raw: unknown, db = getDb()) {
  const user = requireRealUser(userIn);
  const parsed = createOrganizationSchema.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(400, "invalid", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const input = parsed.data;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`eve-org-owner:${user.id}`}))`);
    const [existing] = await tx.select({ orgId: orgOwner.orgId }).from(orgOwner).where(eq(orgOwner.userId, user.id));
    if (existing) {
      const m = await memberOf(tx, user.id, existing.orgId);
      const [evt] = await tx.select({ id: s.event.id }).from(s.event).where(eq(s.event.orgId, existing.orgId)).limit(1);
      return { created: false, orgId: existing.orgId, eventId: evt?.id ?? null, memberId: m?.member.id ?? null };
    }
    const orgId = newId("org");
    const eventId = newId("evt");
    const memberId = newId("mem");
    const o = input.org;
    await tx.insert(s.organization).values({
      id: orgId, slug: `${slugify(o.name)}-${orgId.slice(-6).toLowerCase()}`, name: o.name, country: o.country,
      mode: o.mode, currency: o.currency ?? (o.country === "CA" ? "CAD" : "USD"), agentLimitMinor: o.agentLimitMinor,
      organizerLimitMinor: o.organizerLimitMinor, sponsorName: o.sponsorName, sponsorTurnaroundDays: o.sponsorTurnaroundDays,
      feesPaidBy: o.feesPaidBy, notificationChannel: o.notificationChannel ?? null, policyNotes: o.policyNotes ?? null, isDemo: false,
    });
    await tx.insert(orgOwner).values({ orgId, userId: user.id });
    await tx.insert(s.orgMember).values({ id: memberId, orgId, userId: user.id, role: "organizer", name: user.name, email: user.email });
    const e = input.event;
    await tx.insert(s.event).values({
      id: eventId, orgId, name: e.name, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, expectedHeadcount: e.expectedHeadcount,
      travelCapMinor: e.travelCapMinor, economyOnly: e.economyOnly, bookingDeadline: e.bookingDeadline, checkInAt: e.checkInAt, closingAt: e.closingAt,
    });
    // Starting budget lines; organizers adjust caps with budget.update. Travel assumes a third of attendees travel at the cap.
    const budgets = input.budgets ?? [
      { name: "Travel", category: "travel", capMinor: e.travelCapMinor * BigInt(Math.ceil(e.expectedHeadcount / 3)), fundingSource: "To confirm" },
      { name: "Ground transport", category: "ground_transport", capMinor: 0n, fundingSource: "To confirm" },
      { name: "Team supplies", category: "supplies", capMinor: 0n, fundingSource: "To confirm" },
      { name: "Prizes", category: "prizes", capMinor: 0n, fundingSource: "To confirm" },
    ];
    await tx.insert(s.budgetLine).values(budgets.map((b) => ({ id: newId("bud"), orgId, eventId, name: b.name, category: b.category, capMinor: b.capMinor, fundingSource: b.fundingSource })));
    await ensureAccounts(tx, orgId);
    // Versioned rules are global and shared; insert the starting set only where missing.
    await tx.insert(s.taxRule).values(startingRules.map((r) => ({ ...r, thresholdMinor: BigInt(r.thresholdMinor), effectiveTo: r.effectiveTo ?? null }))).onConflictDoNothing();
    await recordDecision(tx, {
      orgId, objectType: "org", objectId: orgId, action: "org.create",
      summary: `${user.name} created ${o.name} with ${e.name} and became its organizer.`,
      actor: { memberId, role: "organizer", name: user.name }, status: "done", tool: "onboarding",
      facts: { country: o.country, mode: o.mode, budgets: budgets.map((b) => ({ category: b.category, capMinor: b.capMinor.toString() })) },
    });
    return { created: true, orgId, eventId, memberId };
  });
}

// ------------------------------------------------------------- invitations

async function requireOrganizer(db: Executor, user: SessionUser, orgId: string) {
  const m = await memberOf(db, user.id, orgId);
  if (!m) throw new OnboardingError(403, "not_member", "You are not a member of this organization.");
  if (m.isDemo) throw new OnboardingError(403, "demo_org", "The shared demo organization does not take invitations.");
  if (m.member.role !== "organizer") throw new OnboardingError(403, "forbidden", "Only organizers can manage invitations.");
  return m;
}

export async function createInvitation(userIn: SessionUser | null, orgId: string, raw: unknown, db = getDb()) {
  const user = requireRealUser(userIn);
  const parsed = createInvitationSchema.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(400, "invalid", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  const email = parsed.data.email.toLowerCase();
  const role = parsed.data.role;
  return db.transaction(async (tx) => {
    const inviter = await requireOrganizer(tx, user, orgId);
    if (email === user.email) throw new OnboardingError(409, "self_invite", "You cannot invite yourself.");
    const [already] = await tx.select({ id: s.orgMember.id, role: s.orgMember.role }).from(s.orgMember)
      .where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.email, email)));
    if (already) throw new OnboardingError(409, "already_member", `${email} is already a member (${already.role}). Roles are not changed through invitations.`);
    // Re-inviting rotates the token: the old link stops working.
    await tx.update(orgInvitation).set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(orgInvitation.orgId, orgId), eq(orgInvitation.email, email), eq(orgInvitation.status, "pending")));
    const token = randomBytes(32).toString("base64url");
    const id = newId("inv");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await tx.insert(orgInvitation).values({ id, orgId, email, role, tokenHash: hashToken(token), invitedBy: inviter.member.id, expiresAt });
    await tx.insert(s.notice).values({ id: newId("ntc"), orgId, channel: "portal", title: `Invitation for ${maskEmail(email)}`, body: `${user.name} invited ${maskEmail(email)} as ${role}. Email delivery is not configured; the organizer shares the invite link directly.`, status: "queued" });
    await recordDecision(tx, {
      orgId, objectType: "invitation", objectId: id, action: "invitation.create", summary: `${user.name} invited ${maskEmail(email)} as ${role} (expires ${expiresAt.toISOString().slice(0, 10)}).`,
      actor: { memberId: inviter.member.id, role: "organizer", name: user.name }, status: "waiting", tool: "onboarding", facts: { role, emailMasked: maskEmail(email) },
    });
    const path = invitePath(token);
    return {
      invitation: { id, email, role, status: "pending" as const, expiresAt: expiresAt.toISOString() },
      token,
      acceptPath: path,
      acceptUrl: `${appOrigin()}${path}`,
      delivery: { channel: "copy_link" as const, sent: false, detail: "Email delivery is not configured. Copy this link and send it to the invitee yourself; it works once and expires in 7 days." },
    };
  });
}

/** Finds the imported person an attendee invitation refers to, by org and the invited email. */
async function personForEmail(db: Executor, orgId: string, email: string) {
  const [p] = await db.select().from(s.person).where(and(eq(s.person.orgId, orgId), sql`lower(${s.person.email}) = ${email}`));
  return p;
}

/**
 * Invites an already-imported adult attendee to claim their portal. The role
 * is always attendee and the email is the person's email on file.
 */
export async function createAttendeeInvitation(userIn: SessionUser | null, orgId: string, raw: unknown, db = getDb()) {
  const user = requireRealUser(userIn);
  const parsed = createAttendeeInvitationSchema.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(400, "invalid", "Send { personId } of an imported attendee.");
  return db.transaction(async (tx) => {
    const inviter = await requireOrganizer(tx, user, orgId);
    const [person] = await tx.select().from(s.person).where(and(eq(s.person.id, parsed.data.personId), eq(s.person.orgId, orgId)));
    if (!person) throw new OnboardingError(404, "not_found", "Person not found in this organization.");
    if (!person.adult) throw new OnboardingError(409, "minor", "Eve cannot onboard anyone under 18 at the event start date.");
    const email = person.email.toLowerCase();
    if (!email.includes("@")) throw new OnboardingError(409, "no_email", "This person has no email on file.");
    const [already] = await tx.select({ id: s.orgMember.id, role: s.orgMember.role }).from(s.orgMember)
      .where(and(eq(s.orgMember.orgId, orgId), sql`lower(${s.orgMember.email}) = ${email}`));
    if (already) throw new OnboardingError(409, "already_member", `${person.name} already has a membership (${already.role}).`);
    await tx.update(orgInvitation).set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(orgInvitation.orgId, orgId), eq(orgInvitation.email, email), eq(orgInvitation.status, "pending")));
    const token = randomBytes(32).toString("base64url");
    const id = newId("inv");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await tx.insert(orgInvitation).values({ id, orgId, email, role: "attendee", tokenHash: hashToken(token), invitedBy: inviter.member.id, expiresAt });
    await recordDecision(tx, {
      orgId, objectType: "invitation", objectId: id, personId: person.id, personName: person.name, action: "invitation.create",
      summary: `${user.name} invited ${person.name} to the attendee portal (expires ${expiresAt.toISOString().slice(0, 10)}).`,
      actor: { memberId: inviter.member.id, role: "organizer", name: user.name }, status: "waiting", tool: "onboarding", facts: { role: "attendee", emailMasked: maskEmail(email) },
    });
    const path = invitePath(token);
    return {
      invitation: { id, email, role: "attendee" as const, status: "pending" as const, expiresAt: expiresAt.toISOString() },
      person: { id: person.id, name: person.name },
      token,
      acceptPath: path,
      acceptUrl: `${appOrigin()}${path}`,
      delivery: { channel: "copy_link" as const, sent: false, detail: "Email delivery is not configured. Copy this link and send it to the attendee yourself; it works once and expires in 7 days." },
    };
  });
}

/** Staff view of the active organization's members (no role changes or removal here). */
export async function listMembers(userIn: SessionUser | null, orgId: string, db: Executor = getDb()) {
  const user = requireRealUser(userIn);
  const m = await memberOf(db, user.id, orgId);
  if (!m || !["organizer", "controller", "auditor"].includes(m.member.role)) throw new OnboardingError(403, "forbidden", "Only staff can view members.");
  const rows = await db.select().from(s.orgMember).where(eq(s.orgMember.orgId, orgId)).orderBy(asc(s.orgMember.createdAt));
  return rows.map((r) => ({ memberId: r.id, name: r.name, email: r.email, role: r.role, personId: r.personId, hasAccount: r.userId !== null, demoPersona: r.demoPersona, isYou: r.userId === user.id, createdAt: r.createdAt.toISOString() }));
}

export async function listInvitations(userIn: SessionUser | null, orgId: string, db: Executor = getDb()) {
  const user = requireRealUser(userIn);
  const m = await memberOf(db, user.id, orgId);
  if (!m || !["organizer", "controller", "auditor"].includes(m.member.role)) throw new OnboardingError(403, "forbidden", "Only staff can view invitations.");
  const rows = await db.select().from(orgInvitation).where(eq(orgInvitation.orgId, orgId)).orderBy(desc(orgInvitation.createdAt));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id, email: r.email, role: r.role, invitedBy: r.invitedBy, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    status: r.status === "pending" && r.expiresAt.getTime() < now ? "expired" : r.status, acceptedAt: r.acceptedAt?.toISOString() ?? null,
  }));
}

export async function revokeInvitation(userIn: SessionUser | null, orgId: string, id: string, db = getDb()) {
  const user = requireRealUser(userIn);
  return db.transaction(async (tx) => {
    const inviter = await requireOrganizer(tx, user, orgId);
    const [inv] = await tx.select().from(orgInvitation).where(and(eq(orgInvitation.id, id), eq(orgInvitation.orgId, orgId))).for("update");
    if (!inv) throw new OnboardingError(404, "not_found", "Invitation not found.");
    if (inv.status !== "pending") throw new OnboardingError(409, "not_pending", `Invitation is already ${inv.status}.`);
    await tx.update(orgInvitation).set({ status: "revoked", revokedAt: new Date() }).where(eq(orgInvitation.id, id));
    await recordDecision(tx, { orgId, objectType: "invitation", objectId: id, action: "invitation.revoke", summary: `${user.name} revoked the invitation for ${maskEmail(inv.email)}.`, actor: { memberId: inviter.member.id, role: "organizer", name: user.name }, status: "done", tool: "onboarding" });
    return { id, status: "revoked" as const };
  });
}

/** Public preview for the invite page. Reveals only org name, role, masked email and state. */
export async function lookupInvitation(token: string, db: Executor = getDb()) {
  if (!acceptInvitationSchema.shape.token.safeParse(token).success) throw new OnboardingError(404, "not_found", "This invitation link is not valid.");
  const [row] = await db.select({ inv: orgInvitation, orgName: s.organization.name }).from(orgInvitation)
    .innerJoin(s.organization, eq(s.organization.id, orgInvitation.orgId)).where(eq(orgInvitation.tokenHash, hashToken(token)));
  if (!row) throw new OnboardingError(404, "not_found", "This invitation link is not valid.");
  const expired = row.inv.status === "pending" && row.inv.expiresAt.getTime() < Date.now();
  return { orgName: row.orgName, role: row.inv.role, emailMasked: maskEmail(row.inv.email), status: expired ? "expired" : row.inv.status, expiresAt: row.inv.expiresAt.toISOString() };
}

export async function acceptInvitation(userIn: SessionUser | null, raw: unknown, db = getDb()) {
  const user = requireRealUser(userIn);
  const parsed = acceptInvitationSchema.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(400, "invalid", "Send { token } from the invitation link.");
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(orgInvitation).where(eq(orgInvitation.tokenHash, hashToken(parsed.data.token))).for("update");
    if (!inv) throw new OnboardingError(404, "not_found", "This invitation link is not valid.");
    if (inv.email !== user.email) throw new OnboardingError(403, "email_mismatch", `This invitation is for ${maskEmail(inv.email)}. Sign in with that email to accept it.`);
    const existing = await memberOf(tx, user.id, inv.orgId);
    if (inv.status === "accepted") {
      if (existing && inv.acceptedByUserId === user.id) return { orgId: inv.orgId, memberId: existing.member.id, role: existing.member.role, personId: existing.member.personId, alreadyAccepted: true };
      throw new OnboardingError(409, "used", "This invitation has already been used.");
    }
    if (inv.status === "revoked") throw new OnboardingError(410, "revoked", "This invitation was revoked. Ask the organizer for a new one.");
    if (inv.expiresAt.getTime() < Date.now()) throw new OnboardingError(410, "expired", "This invitation expired. Ask the organizer for a new one.");
    if (existing) throw new OnboardingError(409, "already_member", `You are already a member of this organization (${existing.member.role}).`);
    const [byEmail] = await tx.select({ id: s.orgMember.id }).from(s.orgMember).where(and(eq(s.orgMember.orgId, inv.orgId), eq(s.orgMember.email, user.email)));
    if (byEmail) throw new OnboardingError(409, "already_member", "This email already has a membership in the organization.");
    let personId: string | null = null;
    let displayName = user.name;
    if (inv.role === "attendee") {
      // Re-resolved now: the person must still exist with this email and still be an adult.
      const person = await personForEmail(tx, inv.orgId, inv.email);
      if (!person) throw new OnboardingError(409, "person_changed", "The attendee record for this invitation no longer matches. Ask the organizer for a new link.");
      if (!person.adult) throw new OnboardingError(409, "minor", "Eve cannot onboard anyone under 18 at the event start date.");
      const [linked] = await tx.select({ id: s.orgMember.id }).from(s.orgMember).where(and(eq(s.orgMember.orgId, inv.orgId), eq(s.orgMember.personId, person.id)));
      if (linked) throw new OnboardingError(409, "already_member", "This attendee record is already linked to an account.");
      personId = person.id;
      displayName = person.name;
    }
    const memberId = newId("mem");
    // The role (and for attendees the person) comes from the invitation row only.
    await tx.insert(s.orgMember).values({ id: memberId, orgId: inv.orgId, userId: user.id, role: inv.role, personId, name: displayName, email: user.email });
    await tx.update(orgInvitation).set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: user.id }).where(eq(orgInvitation.id, inv.id));
    await recordDecision(tx, { orgId: inv.orgId, objectType: "invitation", objectId: inv.id, action: "invitation.accept", summary: `${user.name} joined as ${inv.role}.`, actor: { memberId, role: inv.role, name: user.name }, status: "done", tool: "onboarding" });
    return { orgId: inv.orgId, memberId, role: inv.role, personId, alreadyAccepted: false };
  });
}

/** Validates that the user belongs to the org before the active-org cookie is set. */
export async function selectOrganization(userIn: SessionUser | null, raw: unknown, db: Executor = getDb()) {
  const user = requireRealUser(userIn);
  const parsed = selectOrgSchema.safeParse(raw);
  if (!parsed.success) throw new OnboardingError(400, "invalid", "Send { orgId }.");
  const m = await memberOf(db, user.id, parsed.data.orgId);
  if (!m) throw new OnboardingError(403, "not_member", "You are not a member of this organization.");
  return { orgId: m.member.orgId, role: m.member.role, orgName: m.orgName };
}
