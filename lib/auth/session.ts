// Request -> actor resolution. Two sources, in order:
//   1. A real Better Auth session, mapped to an org_member row (role from DB).
//   2. A demo-persona cookie, honored only when EVE_DEMO_MODE=true, only for
//      org_member rows flagged demo_persona inside an is_demo organization.
// The cookie is HMAC-SHA256 signed with a key derived from BETTER_AUTH_SECRET
// and carries only member/org ids and expiry. The role is always re-read from
// the database; it is never taken from a cookie or a request payload.

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Role } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { orgMember, organization } from "@/lib/db/schema";

import { BETTER_AUTH_COOKIE, getAuth } from "./index";

export const DEMO_COOKIE = "eve_demo_session";
const DEMO_TTL_SECONDS = 8 * 60 * 60;

export interface ActorContext {
  memberId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  personId: string | null;
  demo: boolean;
  userId: string | null;
}

export function demoModeEnabled(): boolean {
  return process.env.EVE_DEMO_MODE === "true";
}

function signingKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be set (32+ chars).");
  return Buffer.from(hkdfSync("sha256", secret, "eve", "eve-demo-session-v1", 32));
}

function sign(data: string): string {
  return createHmac("sha256", signingKey()).update(data).digest("base64url");
}

export function createDemoToken(memberId: string, orgId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ m: memberId, o: orgId, exp: nowSeconds + DEMO_TTL_SECONDS })).toString("base64url");
  return `v1.${payload}.${sign(`v1.${payload}`)}`;
}

export function verifyDemoToken(token: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): { memberId: string; orgId: string } | null {
  if (!token) return null;
  const [version, payload, mac] = token.split(".");
  if (version !== "v1" || !payload || !mac) return null;
  const expected = Buffer.from(sign(`v1.${payload}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { m?: unknown; o?: unknown; exp?: unknown };
    if (typeof data.m !== "string" || typeof data.o !== "string" || typeof data.exp !== "number" || data.exp < nowSeconds) return null;
    return { memberId: data.m, orgId: data.o };
  } catch {
    return null;
  }
}

export function demoCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DEMO_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEMO_TTL_SECONDS}${secure}`;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

type MemberRow = typeof orgMember.$inferSelect;

function toActor(m: MemberRow, demo: boolean): ActorContext {
  return { memberId: m.id, orgId: m.orgId, role: m.role, name: m.name, email: m.email, personId: m.personId, demo, userId: m.userId };
}

/** Loads a demo persona, enforcing demo mode, persona flag and demo org. */
export async function loadDemoPersona(memberId: string, orgId?: string): Promise<ActorContext | null> {
  if (!demoModeEnabled()) return null;
  const rows = await getDb()
    .select({ member: orgMember, isDemo: organization.isDemo })
    .from(orgMember)
    .innerJoin(organization, eq(organization.id, orgMember.orgId))
    .where(and(eq(orgMember.id, memberId), eq(orgMember.demoPersona, true), eq(organization.isDemo, true)))
    .limit(1);
  const row = rows[0];
  if (!row || (orgId && row.member.orgId !== orgId)) return null;
  return toActor(row.member, true);
}

/** Selected organization for users with several memberships (validated against membership on every request). */
export const ORG_COOKIE = "eve_org";

export function orgCookieHeader(orgId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ORG_COOKIE}=${encodeURIComponent(orgId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}

export interface SessionUser { id: string; name: string; email: string; emailVerified: boolean }

export interface ResolvedSession {
  actor: ActorContext | null;
  /** Set when a real Better Auth session exists (independent of membership). */
  user: SessionUser | null;
  memberships: MemberRow[];
}

/** Real Better Auth user only. Demo persona cookies never produce a user. */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || !BETTER_AUTH_COOKIE.test(cookieHeader)) return null;
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email.toLowerCase(), emailVerified: Boolean(session.user.emailVerified) };
}

export async function resolveSession(request: Request): Promise<ResolvedSession> {
  const cookieHeader = request.headers.get("cookie");
  const user = await getSessionUser(request);
  if (user) {
    const memberships = await getDb().select().from(orgMember)
      .where(eq(orgMember.userId, user.id)).orderBy(asc(orgMember.createdAt));
    const wantedOrg = request.headers.get("x-eve-org") ?? readCookie(cookieHeader, ORG_COOKIE);
    const member = memberships.find((m) => m.orgId === wantedOrg) ?? memberships[0];
    // A signed-in user with no membership gets no org data, demo or otherwise.
    return { actor: member ? toActor(member, false) : null, user, memberships };
  }
  const demo = verifyDemoToken(readCookie(cookieHeader, DEMO_COOKIE));
  if (demo) return { actor: await loadDemoPersona(demo.memberId, demo.orgId), user: null, memberships: [] };
  return { actor: null, user: null, memberships: [] };
}

export async function resolveActor(request: Request): Promise<ActorContext | null> {
  return (await resolveSession(request)).actor;
}
