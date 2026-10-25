// Keeps Slack in step with Eve. syncSlack(orgId) compares what should be shown
// (lib/slack/model.ts) with what was posted (slack_message) and posts new cards,
// edits changed ones, threads status lines, and edits resolved cards into their
// outcome. It is idempotent: every post is claimed by a unique row first, so two
// syncs never post the same card twice. It runs after each action (web or Slack),
// at the end of background runs, from countdown timers and from the daily cron.

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getHookByToken, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { usd } from "@/lib/server/core";
import { slackAlertsWorkflow, slackCountdownWorkflow } from "@/workflows/slack";

import { SlackError, slackApi, uploadToThread } from "./api";
import { fingerprint, renderAlertBatch, renderCard, renderDigest, renderResolved, type DigestFacts, type SlackBody } from "./blocks";
import { ALERT_BATCH_MS, eveLink, slackAppConfig } from "./config";
import { botToken, installationFor, type Installation } from "./identity";
import { loadOrgState } from "./load";
import { audienceKey, desiredItems, infoAlerts, prizeNeedsDecision, resolutionFor, type Audience, type Item, type OrgState } from "./model";
import { esc } from "./text";

type MessageRow = typeof s.slackMessage.$inferSelect;

/** One sync stays well inside a route's time budget; the next sync continues. */
const MAX_WRITES = 30;
const STALE_CLAIM_MS = 2 * 60_000;
const RESOLVABLE = /^(release|freeze|claim|prize|winners|countdown):/;
const FATAL = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired", "team_access_not_granted"]);

const rowKey = (itemKey: string, audience: string) => `${itemKey}\u0000${audience}`;

class Poster {
  writes = 0;
  private dms = new Map<string, string>();
  constructor(readonly token: string, readonly inst: Installation) {}

  get spent() { return this.writes >= MAX_WRITES; }

  async channelFor(a: Audience): Promise<string | null> {
    if (a.kind === "channel") return this.inst.channelId;
    let channel = this.dms.get(a.slackUserId);
    if (!channel) {
      channel = (await slackApi<{ channel: { id: string } }>(this.token, "conversations.open", { users: a.slackUserId })).channel.id;
      this.dms.set(a.slackUserId, channel);
    }
    return channel;
  }

  async post(channel: string, body: Partial<SlackBody> & { text: string }, threadTs?: string) {
    this.writes += 1;
    const args = { channel, ...body, thread_ts: threadTs, unfurl_links: false, unfurl_media: false };
    try {
      return await slackApi<{ ts: string; channel: string }>(this.token, "chat.postMessage", args);
    } catch (error) {
      // chat:write.public posts to public channels; uploads and private channels need membership.
      if (!(error instanceof SlackError) || error.code !== "not_in_channel") throw error;
      await slackApi(this.token, "conversations.join", { channel });
      return slackApi<{ ts: string; channel: string }>(this.token, "chat.postMessage", args);
    }
  }

  async update(channel: string, ts: string, body: SlackBody) {
    this.writes += 1;
    await slackApi(this.token, "chat.update", { channel, ts, ...body });
  }
}

function logSkip(where: string, error: unknown) {
  // Never the token, a message body or a raw provider error: only Slack's code or the error name.
  console.warn(`[slack] ${where}: ${error instanceof SlackError ? error.code : error instanceof Error ? error.name : "error"}`);
}

const isFatal = (error: unknown) => error instanceof SlackError && FATAL.has(error.code);

/** Never throws. For after() callbacks and workflow steps whose own work already committed. */
export async function syncSlackSafe(orgId: string): Promise<void> {
  try { await syncSlack(orgId); } catch (error) { logSkip("sync skipped", error); }
}

export async function syncSlack(orgId: string): Promise<void> {
  if (!slackAppConfig()) return;
  const inst = await installationFor(orgId);
  if (!inst) return;
  const db = getDb();
  const st = await loadOrgState(inst, db);
  const poster = new Poster(botToken(inst), inst);
  const rows = await db.select().from(s.slackMessage).where(eq(s.slackMessage.orgId, orgId));
  const openBatch = rows.find((r) => r.state === "open" && r.itemKey.startsWith("release:"))?.itemKey;
  const byKey = new Map(rows.map((r) => [rowKey(r.itemKey, r.audience), r]));
  const wanted = new Set<string>();
  const items = desiredItems(st, openBatch);
  const stillOpen = new Map(items.map((i) => [i.key, i]));
  for (const item of items) {
    for (const audience of item.audiences) {
      const key = rowKey(item.key, audienceKey(audience));
      wanted.add(key);
      if (poster.spent) continue;
      try { await applyOne(poster, st, item, audience, byKey.get(key)); }
      catch (error) { if (isFatal(error)) return logSkip("installation needs reconnecting", error); logSkip(`card ${item.key.split(":")[0]}`, error); }
    }
  }
  for (const row of rows) {
    if (poster.spent) break;
    if (row.state !== "open" || !row.ts || !row.channelId || !RESOLVABLE.test(row.itemKey) || wanted.has(rowKey(row.itemKey, row.audience))) continue;
    try { await resolveOne(poster, st, row, stillOpen.get(row.itemKey)); }
    catch (error) { if (isFatal(error)) return logSkip("installation needs reconnecting", error); logSkip("resolve", error); }
  }
  await queueAlerts(orgId, st);
  await scheduleAlertFlush(orgId).catch((error) => logSkip("alert batch", error));
  if (st.event && st.now >= st.event.endsAt && st.now.getTime() - st.event.endsAt.getTime() < 3 * 86_400_000) {
    await postDigest(orgId, "weekend").catch((error) => logSkip("weekend digest", error));
  }
  await ensureCountdown(st).catch((error) => logSkip("countdown", error));
}

async function applyOne(poster: Poster, st: OrgState, item: Item, audience: Audience, row: MessageRow | undefined) {
  const db = getDb();
  const body = renderCard(item, audience);
  const fp = fingerprint(body);
  const now = new Date();
  if (!row || (!row.ts && now.getTime() - row.updatedAt.getTime() > STALE_CLAIM_MS)) {
    const [claimed] = row
      ? await db.update(s.slackMessage).set({ updatedAt: now }).where(and(eq(s.slackMessage.id, row.id), isNull(s.slackMessage.ts), eq(s.slackMessage.updatedAt, row.updatedAt))).returning()
      : await db.insert(s.slackMessage).values({ id: newId("slm"), orgId: st.org.id, itemKey: item.key, audience: audienceKey(audience), category: item.category }).onConflictDoNothing().returning();
    if (!claimed) return;
    const channel = await poster.channelFor(audience);
    if (!channel) return;
    const posted = await poster.post(channel, body);
    await db.update(s.slackMessage).set({ ts: posted.ts, channelId: posted.channel, fingerprint: fp, lastNote: item.note ?? null, state: "open", updatedAt: new Date() })
      .where(eq(s.slackMessage.id, claimed.id));
    return;
  }
  if (!row.ts || !row.channelId) return;
  if (row.state === "resolved") {
    const [won] = await db.update(s.slackMessage).set({ state: "open", fingerprint: fp, lastNote: item.note ?? null, updatedAt: now })
      .where(and(eq(s.slackMessage.id, row.id), eq(s.slackMessage.state, "resolved"))).returning();
    if (!won) return;
    await poster.update(row.channelId, row.ts, body);
    await poster.post(row.channelId, { text: esc(`Back for review.${item.note ? ` ${item.note}` : ""}`) }, row.ts);
    return;
  }
  if (row.fingerprint !== fp) {
    const [won] = await db.update(s.slackMessage).set({ fingerprint: fp, updatedAt: now })
      .where(and(eq(s.slackMessage.id, row.id), eq(s.slackMessage.fingerprint, row.fingerprint))).returning();
    if (won) {
      try { await poster.update(row.channelId, row.ts, body); }
      catch (error) { await db.update(s.slackMessage).set({ fingerprint: row.fingerprint }).where(eq(s.slackMessage.id, row.id)); throw error; }
    }
  }
  if (item.note && item.note !== row.lastNote) {
    const [won] = await db.update(s.slackMessage).set({ lastNote: item.note })
      .where(and(eq(s.slackMessage.id, row.id), row.lastNote === null ? isNull(s.slackMessage.lastNote) : eq(s.slackMessage.lastNote, row.lastNote))).returning();
    if (won) await poster.post(row.channelId, { text: esc(item.note) }, row.ts);
  }
}

/**
 * The outcome goes in the thread and replaces the original card, so stale buttons never linger.
 * `open` is set when the item still needs someone, just not this recipient (rerouted or muted).
 */
async function resolveOne(poster: Poster, st: OrgState, row: MessageRow, open?: Item) {
  const db = getDb();
  const [won] = await db.update(s.slackMessage).set({ state: "resolved", updatedAt: new Date() })
    .where(and(eq(s.slackMessage.id, row.id), eq(s.slackMessage.state, "open"))).returning();
  if (!won) return;
  const res = open
    ? { title: resolutionFor(row.itemKey, st).title, text: "This now goes to someone else: the organizer on duty, the approver, or your mutes changed. Nothing for you to do here.", url: open.url }
    : resolutionFor(row.itemKey, st);
  try {
    await poster.update(row.channelId!, row.ts!, renderResolved(res, st.org.isDemo));
  } catch (error) {
    await db.update(s.slackMessage).set({ state: "open" }).where(eq(s.slackMessage.id, row.id));
    throw error;
  }
  await poster.post(row.channelId!, { text: esc(res.text) }, row.ts!);
}

// ------------------------------------------------------- channel alerts

async function queueAlerts(orgId: string, st: OrgState) {
  const alerts = infoAlerts(st);
  if (!alerts.length) return;
  await getDb().insert(s.slackAlert)
    .values(alerts.map((a) => ({ id: newId("sla"), orgId, key: a.key, category: a.category, text: a.text, documentIds: a.documentIds })))
    .onConflictDoNothing();
}

/** The first unposted alert starts a 15-minute timer; everything queued by then is posted together. */
export async function scheduleAlertFlush(orgId: string): Promise<void> {
  const [oldest] = await getDb().select({ id: s.slackAlert.id, createdAt: s.slackAlert.createdAt }).from(s.slackAlert)
    .where(and(eq(s.slackAlert.orgId, orgId), isNull(s.slackAlert.postedAt))).orderBy(asc(s.slackAlert.createdAt)).limit(1);
  if (!oldest) return;
  const due = new Date(oldest.createdAt.getTime() + ALERT_BATCH_MS);
  if (due.getTime() <= Date.now()) { await flushAlerts(orgId); return; }
  const token = `slack-alerts:${orgId}:${oldest.id}`;
  try { await getHookByToken(token); return; }
  catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  await start(slackAlertsWorkflow, [{ orgId, anchorId: oldest.id, dueAt: due.toISOString() }]);
}

/** Posts queued alerts whose 15 minutes are up, as one channel message; screenshots go in its thread. */
export async function flushAlerts(orgId: string): Promise<number> {
  if (!slackAppConfig()) return 0;
  const inst = await installationFor(orgId);
  if (!inst?.channelId) return 0;
  const db = getDb();
  const now = Date.now();
  const pending = await db.select().from(s.slackAlert).where(and(eq(s.slackAlert.orgId, orgId), isNull(s.slackAlert.postedAt)))
    .orderBy(asc(s.slackAlert.createdAt)).limit(25);
  if (!pending.length || pending[0].createdAt.getTime() + ALERT_BATCH_MS > now + 1_000) return 0;
  const claimed = await db.update(s.slackAlert).set({ postedAt: new Date(now) })
    .where(and(inArray(s.slackAlert.id, pending.map((a) => a.id)), isNull(s.slackAlert.postedAt))).returning();
  if (!claimed.length) return 0;
  const [org] = await db.select({ isDemo: s.organization.isDemo }).from(s.organization).where(eq(s.organization.id, orgId));
  const poster = new Poster(botToken(inst), inst);
  let ts: string;
  try {
    ts = (await poster.post(inst.channelId, renderAlertBatch(claimed, Boolean(org?.isDemo), eveLink("/overview")))).ts;
  } catch (error) {
    await db.update(s.slackAlert).set({ postedAt: null }).where(inArray(s.slackAlert.id, claimed.map((a) => a.id)));
    throw error;
  }
  await db.update(s.slackAlert).set({ messageTs: ts }).where(inArray(s.slackAlert.id, claimed.map((a) => a.id)));
  for (const alert of claimed) {
    for (const documentId of alert.documentIds.slice(0, 2)) {
      const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, documentId), eq(s.document.orgId, orgId), eq(s.document.kind, "screenshot")));
      if (!doc || doc.mimeType !== "image/png") continue;
      await uploadToThread(poster.token, { channelId: inst.channelId, threadTs: ts, filename: "eve-portal.png", title: "Sponsor portal screenshot", bytes: doc.bytes })
        .catch((error) => logSkip("screenshot upload", error));
    }
  }
  return claimed.length;
}

// --------------------------------------------------------------- digest

/** Daily (from the scheduled review) and once at the end of the event weekend. Idempotent per day or event. */
export async function postDigest(orgId: string, kind: DigestFacts["kind"], now = new Date()): Promise<boolean> {
  if (!slackAppConfig()) return false;
  const inst = await installationFor(orgId);
  if (!inst?.channelId) return false;
  const db = getDb();
  const st = await loadOrgState(inst, db, now);
  if (kind === "weekend" && !st.event) return false;
  const itemKey = kind === "daily" ? `digest:daily:${now.toISOString().slice(0, 10)}` : `digest:weekend:${st.event!.id}`;
  const [claimed] = await db.insert(s.slackMessage).values({ id: newId("slm"), orgId, itemKey, audience: "channel", category: "digest", state: "resolved" })
    .onConflictDoNothing().returning();
  if (!claimed) return false;
  try {
    const since = kind === "daily" ? new Date(now.getTime() - 86_400_000) : st.event!.startsAt;
    const approvals = await db.select({ objectId: s.approval.objectId }).from(s.approval).where(and(
      eq(s.approval.orgId, orgId), eq(s.approval.objectType, "claim"), eq(s.approval.approverRole, "agent"), eq(s.approval.decision, "approved"), gte(s.approval.createdAt, since),
    ));
    const facts = digestFacts(st, kind, since, new Set(approvals.map((a) => a.objectId)));
    const posted = await new Poster(botToken(inst), inst).post(inst.channelId, renderDigest(facts));
    await db.update(s.slackMessage).set({ ts: posted.ts, channelId: posted.channel }).where(eq(s.slackMessage.id, claimed.id));
    return true;
  } catch (error) {
    await db.delete(s.slackMessage).where(eq(s.slackMessage.id, claimed.id));
    throw error;
  }
}

export function digestFacts(st: OrgState, kind: DigestFacts["kind"], since: Date, autoApprovedIds: Set<string>): DigestFacts {
  const auto = st.claims.filter((c) => autoApprovedIds.has(c.id));
  const sent = st.payouts.filter((p) => p.status === "paid" && p.paidAt && p.paidAt >= since && p.provider !== "in_kind");
  const moneyWaiting = new Set([...st.awards.filter((a) => a.status !== "paid").map((a) => a.personId), ...st.payouts.filter((p) => ["held", "proposed", "approved", "frozen"].includes(p.status)).map((p) => p.personId)]);
  const missing = [...st.people.values()]
    .filter((p) => p.adult && p.taxAttention && p.taxAttention !== "expiring")
    .sort((a, b) => Number(moneyWaiting.has(b.id)) - Number(moneyWaiting.has(a.id)) || b.chaseCount - a.chaseCount || a.name.localeCompare(b.name));
  const opened: Date[] = [
    ...st.claims.filter((c) => c.status === "escalated" || c.status === "needs_info").map((c) => c.createdAt),
    ...st.payouts.filter((p) => ["held", "frozen", "failed", "returned", "proposed", "approved"].includes(p.status)).map((p) => p.createdAt),
    ...st.awards.filter((a) => prizeNeedsDecision(st, a)).map((a) => a.createdAt),
    ...st.packets.filter((p) => p.status === "exception").map((p) => p.createdAt),
  ];
  const age = (d: Date) => (st.now.getTime() - d.getTime()) / 86_400_000;
  const sum = <T>(rows: T[], f: (r: T) => bigint) => rows.reduce((a, r) => a + f(r), 0n);
  return {
    kind, since, url: eveLink("/overview"), demo: st.org.isDemo,
    title: kind === "daily" ? `${st.org.name}: daily finance digest` : `${st.event?.name ?? st.org.name}: event weekend wrap-up`,
    autoApproved: { count: auto.length, total: usd(sum(auto, (c) => c.usdMinor)) },
    payoutsSent: { count: sent.length, net: usd(sum(sent, (p) => p.netMinor)), withheld: usd(sum(sent, (p) => p.withholdingMinor)) },
    missingForms: missing.map((p) => ({ name: p.name, form: p.form, reminders: p.chaseCount })),
    inbox: { underDay: opened.filter((d) => age(d) < 1).length, oneToThree: opened.filter((d) => age(d) >= 1 && age(d) <= 3).length, overThree: opened.filter((d) => age(d) > 3).length },
    budgets: st.budgets.map((b) => {
      const left = b.capMinor - b.usedMinor;
      return { name: b.name, spent: usd(b.spentMinor), committed: usd(b.committedMinor), remaining: usd(left < 0n ? -left : left), over: left < 0n };
    }),
  };
}

// ------------------------------------------------------------ countdown

/** One durable timer per event and closing time: it re-syncs at each countdown mark. */
async function ensureCountdown(st: OrgState) {
  if (!st.event || st.event.closingAt <= st.now || !st.awards.some((a) => a.eventId === st.event!.id)) return;
  const token = `slack-countdown:${st.org.id}:${st.event.id}:${st.event.closingAt.getTime()}`;
  try { await getHookByToken(token); return; }
  catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  await start(slackCountdownWorkflow, [{ orgId: st.org.id, eventId: st.event.id, closingAt: st.event.closingAt.toISOString() }]);
}

/** Every installed organization, for the scheduled sweep. */
export async function syncAllSlack(): Promise<{ synced: number; posted: number }> {
  if (!slackAppConfig()) return { synced: 0, posted: 0 };
  const installs = await getDb().select({ orgId: s.slackInstallation.orgId }).from(s.slackInstallation);
  let synced = 0, posted = 0;
  for (const { orgId } of installs) {
    try { await syncSlack(orgId); synced += 1; posted += await flushAlerts(orgId); }
    catch (error) { logSkip("scheduled sync", error); }
  }
  return { synced, posted };
}
