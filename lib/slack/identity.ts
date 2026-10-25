// Slack workspace and user identity. A Slack user acts in Eve only through a
// link they created themselves: the member generates a one-time code in Eve and
// types `/eve link CODE` in Slack, so the link proves control of both accounts.
// The role is re-read from org_member on every request, exactly like a web
// session; nothing about authority is stored on the link or taken from Slack.

import { createHash, randomInt } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import { demoModeEnabled, type ActorContext } from "@/lib/auth/session";
import { getDb, type Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { forbidden, recordDecision } from "@/lib/server/core";
import { openValue } from "@/lib/server/vault";

import { isDmCategory } from "./config";

export type Installation = typeof s.slackInstallation.$inferSelect;
export const TOKEN_PURPOSE = "slack_bot_token";

export async function installationFor(orgId: string, db: Executor = getDb()): Promise<Installation | null> {
  const [row] = await db.select().from(s.slackInstallation).where(eq(s.slackInstallation.orgId, orgId));
  return row ?? null;
}

export async function installationForTeam(teamId: string, db: Executor = getDb()): Promise<Installation | null> {
  const [row] = await db.select().from(s.slackInstallation).where(eq(s.slackInstallation.teamId, teamId));
  return row ?? null;
}

/** Server-only. Never logged, persisted elsewhere, or returned to a client. */
export function botToken(inst: Installation): string {
  return openValue(inst.orgId, TOKEN_PURPOSE, { ciphertext: inst.tokenCiphertext, iv: inst.tokenIv, tag: inst.tokenTag });
}

// ------------------------------------------------------------- link codes

/** The people who approve, release or decide. Attendees and auditors are not linked. */
export const LINKABLE_ROLES = ["organizer", "controller"] as const;
export const LINK_CODE_TTL_MS = 10 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newLinkCode(): string {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function linkCodeHash(code: string): string {
  return createHash("sha256").update(`eve-slack-link:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex");
}

/** slack.linkCode: a fresh one-time code for the signed-in member. Only its hash is stored. */
export async function issueLinkCode(tx: Executor, actor: ActorContext): Promise<{ code: string; expiresAt: Date }> {
  if (!(LINKABLE_ROLES as readonly string[]).includes(actor.role)) throw forbidden("Only organizers and controllers can link Slack.");
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  await tx.insert(s.slackUserLink).values({ memberId: actor.memberId, orgId: actor.orgId, codeHash: linkCodeHash(code), codeExpiresAt: expiresAt })
    .onConflictDoUpdate({ target: s.slackUserLink.memberId, set: { codeHash: linkCodeHash(code), codeExpiresAt: expiresAt } });
  return { code, expiresAt };
}

type Redeemed = { ok: true; name: string; role: string; orgName: string } | { ok: false; message: string };

/** `/eve link CODE`, from a Slack request whose signature has been verified. */
export async function redeemLinkCode(teamId: string, slackUserId: string, code: string): Promise<Redeemed> {
  const inst = await installationForTeam(teamId);
  if (!inst) return { ok: false, message: "Eve is not connected to this Slack workspace. An organizer connects it in Eve → Settings → Slack." };
  const invalid = { ok: false as const, message: "That code is not valid or has expired. Generate a new one in Eve → Settings → Slack." };
  if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim())) return invalid;
  return getDb().transaction(async (tx) => {
    const [link] = await tx.select().from(s.slackUserLink)
      .where(and(eq(s.slackUserLink.codeHash, linkCodeHash(code)), eq(s.slackUserLink.orgId, inst.orgId))).for("update");
    if (!link?.codeExpiresAt || link.codeExpiresAt.getTime() < Date.now()) return invalid;
    const [row] = await tx.select({ member: s.orgMember, org: s.organization }).from(s.orgMember)
      .innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
      .where(and(eq(s.orgMember.id, link.memberId), eq(s.orgMember.orgId, inst.orgId)));
    if (!row || !(LINKABLE_ROLES as readonly string[]).includes(row.member.role)) return invalid;
    // One Slack user maps to one Eve member: an older link from this Slack user is released.
    await tx.update(s.slackUserLink).set({ teamId: null, slackUserId: null, linkedAt: null })
      .where(and(eq(s.slackUserLink.teamId, teamId), eq(s.slackUserLink.slackUserId, slackUserId), ne(s.slackUserLink.memberId, link.memberId)));
    await tx.update(s.slackUserLink).set({ teamId, slackUserId, linkedAt: new Date(), codeHash: null, codeExpiresAt: null })
      .where(eq(s.slackUserLink.memberId, link.memberId));
    const m = row.member;
    await recordDecision(tx, {
      orgId: inst.orgId, objectType: "member", objectId: m.id, action: "slack.link",
      summary: `${m.name} linked a Slack account. Requests from it act as ${m.name} with the ${m.role} role, checked on every request.`,
      actor: { memberId: m.id, role: m.role, name: m.name, via: "slack" }, status: "done", tool: "slack", facts: { teamId, slackUserId },
    });
    return { ok: true, name: m.name, role: m.role, orgName: row.org.name };
  });
}

/** slack.unlink, or `/eve unlink`. */
export async function unlinkMember(tx: Executor, actor: ActorContext): Promise<boolean> {
  const rows = await tx.update(s.slackUserLink).set({ teamId: null, slackUserId: null, linkedAt: null, codeHash: null, codeExpiresAt: null })
    .where(eq(s.slackUserLink.memberId, actor.memberId)).returning({ memberId: s.slackUserLink.memberId });
  if (!rows.length) return false;
  await recordDecision(tx, { orgId: actor.orgId, objectType: "member", objectId: actor.memberId, action: "slack.unlink", summary: `${actor.name} unlinked their Slack account.`, actor, status: "done", tool: "slack" });
  return true;
}

// ------------------------------------------------------------- actors

export interface SlackIdentity { inst: Installation; actor: ActorContext | null; muted: string[] }

/** The Eve actor behind a verified Slack request, or actor null when the Slack user is not linked. */
export async function slackIdentity(teamId: string, slackUserId: string): Promise<SlackIdentity | null> {
  const inst = await installationForTeam(teamId);
  if (!inst) return null;
  const [row] = await getDb().select({ link: s.slackUserLink, member: s.orgMember, org: s.organization }).from(s.slackUserLink)
    .innerJoin(s.orgMember, eq(s.orgMember.id, s.slackUserLink.memberId))
    .innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
    .where(and(eq(s.slackUserLink.teamId, teamId), eq(s.slackUserLink.slackUserId, slackUserId), eq(s.slackUserLink.orgId, inst.orgId)));
  if (!row || row.member.orgId !== inst.orgId) return { inst, actor: null, muted: [] };
  const m = row.member;
  // Demo personas act only inside a demo org while demo mode is on, as on the web.
  if (m.demoPersona && (!row.org.isDemo || !demoModeEnabled())) return { inst, actor: null, muted: [] };
  return {
    inst, muted: row.link.muted,
    actor: { memberId: m.id, orgId: m.orgId, role: m.role, name: m.name, email: m.email, personId: m.personId, userId: m.userId, demo: m.demoPersona && row.org.isDemo, via: "slack" },
  };
}

export async function setMuted(memberId: string, categories: string[]): Promise<string[]> {
  const muted = [...new Set(categories.filter(isDmCategory))].sort();
  await getDb().update(s.slackUserLink).set({ muted }).where(eq(s.slackUserLink.memberId, memberId));
  return muted;
}
