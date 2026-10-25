// Installing Eve into a Slack workspace (OAuth v2) and the organizer's Slack
// settings. The OAuth state is HMAC-signed and bound to the organizer and org
// that started it; the callback must arrive in that same organizer's session.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, inArray, ne } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts";
import { getDb, type Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { forbidden, invalid, recordDecision } from "@/lib/server/core";
import { sealValue } from "@/lib/server/vault";

import { exchangeOAuthCode, slackApi, SlackError } from "./api";
import { eveLink, SLACK_SCOPES, slackAppConfig } from "./config";
import { botToken, installationFor, TOKEN_PURPOSE } from "./identity";

const STATE_TTL_MS = 10 * 60_000;

function stateKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be set (32+ chars).");
  return Buffer.from(hkdfSync("sha256", secret, "eve", "eve-slack-oauth-v1", 32));
}

export function signInstallState(orgId: string, memberId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ o: orgId, m: memberId, exp: now + STATE_TTL_MS, n: randomBytes(8).toString("base64url") })).toString("base64url");
  return `${payload}.${createHmac("sha256", stateKey()).update(payload).digest("base64url")}`;
}

export function verifyInstallState(state: string | null, now = Date.now()): { orgId: string; memberId: string } | null {
  const [payload, mac] = (state ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(payload).digest("base64url"));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { o?: unknown; m?: unknown; exp?: unknown };
    if (typeof data.o !== "string" || typeof data.m !== "string" || typeof data.exp !== "number" || data.exp < now) return null;
    return { orgId: data.o, memberId: data.m };
  } catch {
    return null;
  }
}

export const redirectUri = () => eveLink("/api/slack/oauth");

/** GET /api/slack/install: the Slack consent URL for an organizer. */
export function authorizeUrl(actor: ActorContext): string {
  const config = slackAppConfig();
  if (!config) throw invalid("The Slack app is not configured on this server.");
  if (actor.role !== "organizer") throw forbidden("Only an organizer can connect Slack.");
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", SLACK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", signInstallState(actor.orgId, actor.memberId));
  return url.toString();
}

/** GET /api/slack/oauth: exchange the code and store the workspace for the organizer's org. */
export async function completeInstall(actor: ActorContext, code: string, state: string | null): Promise<ActionResult> {
  const config = slackAppConfig();
  if (!config) return { ok: false, message: "The Slack app is not configured on this server." };
  const bound = verifyInstallState(state);
  if (!bound || bound.orgId !== actor.orgId || bound.memberId !== actor.memberId || actor.role !== "organizer") {
    return { ok: false, message: "This Slack connection was started by someone else or has expired. Start again from Settings." };
  }
  let granted: Awaited<ReturnType<typeof exchangeOAuthCode>>;
  try { granted = await exchangeOAuthCode(config.clientId, config.clientSecret, code, redirectUri()); }
  catch (error) { return { ok: false, message: `Slack did not complete the connection (${error instanceof SlackError ? error.code : "error"}). Try again.` }; }
  const result = await getDb().transaction(async (tx) => {
    const [taken] = await tx.select({ orgId: s.slackInstallation.orgId }).from(s.slackInstallation)
      .where(and(eq(s.slackInstallation.teamId, granted.teamId), ne(s.slackInstallation.orgId, actor.orgId)));
    if (taken) return { ok: false, message: `The ${granted.teamName} workspace is already connected to another Eve organization.` };
    const sealed = sealValue(actor.orgId, TOKEN_PURPOSE, granted.token);
    const row = {
      teamId: granted.teamId, teamName: granted.teamName, botUserId: granted.botUserId,
      tokenCiphertext: sealed.ciphertext, tokenIv: sealed.iv, tokenTag: sealed.tag,
      channelId: granted.channelId, channelName: granted.channelName, installedBy: actor.memberId, updatedAt: new Date(),
    };
    await tx.insert(s.slackInstallation).values({ id: newId("slk"), orgId: actor.orgId, ...row })
      .onConflictDoUpdate({ target: s.slackInstallation.orgId, set: row });
    // Links made in another workspace no longer identify anyone here.
    await tx.update(s.slackUserLink).set({ teamId: null, slackUserId: null, linkedAt: null })
      .where(and(eq(s.slackUserLink.orgId, actor.orgId), ne(s.slackUserLink.teamId, granted.teamId)));
    await recordDecision(tx, {
      orgId: actor.orgId, objectType: "org", objectId: actor.orgId, action: "slack.install",
      summary: `${actor.name} connected the ${granted.teamName} Slack workspace${granted.channelName ? `; team channel ${granted.channelName}` : ""}. Slack actions use each person's Eve permissions.`,
      actor, status: "done", tool: "slack", facts: { teamId: granted.teamId, channelId: granted.channelId },
    });
    return { ok: true, message: `Connected ${granted.teamName}.` };
  });
  if (result.ok && granted.channelId) {
    // chat:write.public covers public channels; joining also lets Eve upload screenshots there.
    await slackApi(granted.token, "conversations.join", { channel: granted.channelId }).catch(() => {});
    await slackApi(granted.token, "chat.postMessage", {
      channel: granted.channelId, unfurl_links: false,
      text: "Eve is connected. Informational alerts, the daily digest and event-weekend updates post here. Approvals go by direct message to the person who must act. Link your account: Eve → Settings → Slack, then `/eve link CODE`.",
    }).catch(() => {});
  }
  return result;
}

// ------------------------------------------------------------ settings

export async function updateSlackSettings(tx: Executor, actor: ActorContext, p: { onDutyMemberId?: string | null; backupMemberId?: string | null }): Promise<ActionResult> {
  const inst = await installationFor(actor.orgId, tx);
  if (!inst) throw invalid("Connect Slack first.");
  const ids = [p.onDutyMemberId, p.backupMemberId].filter((v): v is string => Boolean(v));
  const members = ids.length ? await tx.select().from(s.orgMember).where(and(eq(s.orgMember.orgId, actor.orgId), inArray(s.orgMember.id, ids))) : [];
  const byId = new Map(members.map((m) => [m.id, m]));
  if (p.onDutyMemberId && byId.get(p.onDutyMemberId)?.role !== "organizer") throw invalid("The organizer on duty must be an organizer.");
  if (p.backupMemberId && !["organizer", "controller"].includes(byId.get(p.backupMemberId)?.role ?? "")) throw invalid("The backup approver must be an organizer or controller.");
  const set: Partial<typeof s.slackInstallation.$inferInsert> = { updatedAt: new Date() };
  if (p.onDutyMemberId !== undefined) set.onDutyMemberId = p.onDutyMemberId;
  if (p.backupMemberId !== undefined) set.backupMemberId = p.backupMemberId;
  await tx.update(s.slackInstallation).set(set).where(eq(s.slackInstallation.orgId, actor.orgId));
  const name = (id: string | null | undefined) => (id ? byId.get(id)?.name ?? id : "everyone eligible");
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "org", objectId: actor.orgId, action: "slack.settings",
    summary: `Slack routing updated.${p.onDutyMemberId !== undefined ? ` Organizer on duty: ${name(p.onDutyMemberId)}.` : ""}${p.backupMemberId !== undefined ? ` Backup approver: ${name(p.backupMemberId)}.` : ""}`,
    actor, status: "done", tool: "slack", facts: { onDutyMemberId: p.onDutyMemberId ?? null, backupMemberId: p.backupMemberId ?? null },
  });
  return { ok: true, message: "Slack routing saved." };
}

/** slack.disconnect. Returns the token so the caller can revoke it after the transaction commits. */
export async function disconnectSlack(tx: Executor, actor: ActorContext): Promise<{ result: ActionResult; token: string | null }> {
  const inst = await installationFor(actor.orgId, tx);
  if (!inst) return { result: { ok: true, message: "Slack was not connected." }, token: null };
  const token = botToken(inst);
  await tx.delete(s.slackMessage).where(eq(s.slackMessage.orgId, actor.orgId));
  await tx.delete(s.slackAlert).where(eq(s.slackAlert.orgId, actor.orgId));
  await tx.update(s.slackUserLink).set({ teamId: null, slackUserId: null, linkedAt: null }).where(eq(s.slackUserLink.orgId, actor.orgId));
  await tx.delete(s.slackInstallation).where(eq(s.slackInstallation.orgId, actor.orgId));
  await recordDecision(tx, { orgId: actor.orgId, objectType: "org", objectId: actor.orgId, action: "slack.disconnect", summary: `${actor.name} disconnected the ${inst.teamName} Slack workspace. Existing Slack messages no longer update.`, actor, status: "done", tool: "slack" });
  return { result: { ok: true, message: `Disconnected ${inst.teamName}.` }, token };
}

/** Slack told us the app was removed: forget the workspace without a person acting. */
export async function forgetTeam(teamId: string): Promise<void> {
  const db = getDb();
  const [inst] = await db.select().from(s.slackInstallation).where(eq(s.slackInstallation.teamId, teamId));
  if (!inst) return;
  await db.transaction(async (tx) => {
    await tx.update(s.slackUserLink).set({ teamId: null, slackUserId: null, linkedAt: null }).where(eq(s.slackUserLink.orgId, inst.orgId));
    await tx.delete(s.slackMessage).where(eq(s.slackMessage.orgId, inst.orgId));
    await tx.delete(s.slackAlert).where(eq(s.slackAlert.orgId, inst.orgId));
    await tx.delete(s.slackInstallation).where(eq(s.slackInstallation.id, inst.id));
    await recordDecision(tx, { orgId: inst.orgId, objectType: "org", objectId: inst.orgId, action: "slack.uninstalled", summary: `Eve was removed from the ${inst.teamName} Slack workspace.`, actor: { memberId: "agent", role: "agent", name: "Eve (agent)" }, status: "done", tool: "slack" });
  });
}
