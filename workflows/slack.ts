import { createHook, sleep } from "workflow";

export interface SlackAlertTarget { orgId: string; anchorId: string; dueAt: string }
export interface SlackCountdownTarget { orgId: string; eventId: string; closingAt: string }

/** Informational alerts batch for 15 minutes from the first one queued, then post together. */
export async function slackAlertsWorkflow(target: SlackAlertTarget) {
  "use workflow";
  using guard = createHook({ token: `slack-alerts:${target.orgId}:${target.anchorId}` });
  const conflict = await guard.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  await sleep(new Date(target.dueAt));
  return { posted: await flushBatch(target.orgId) };
}

async function flushBatch(orgId: string) {
  "use step";
  const { flushAlerts } = await import("@/lib/slack/sync");
  return flushAlerts(orgId);
}

/** Refreshes the closing-ceremony countdown at each mark (6h, 3h, 2h, 1h, 30m, 10m, then at closing). */
export async function slackCountdownWorkflow(target: SlackCountdownTarget) {
  "use workflow";
  using guard = createHook({ token: `slack-countdown:${target.orgId}:${target.eventId}:${Date.parse(target.closingAt)}` });
  const conflict = await guard.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  for (const at of await upcomingMarks(target.closingAt)) {
    await sleep(new Date(at));
    if (!await refreshCountdown(target)) return { superseded: true };
  }
  return { done: true };
}

async function upcomingMarks(closingAt: string) {
  "use step";
  const { COUNTDOWN_MARKS } = await import("@/lib/slack/model");
  const closing = Date.parse(closingAt);
  // One second past each mark, so the sync sees the new time bucket.
  return COUNTDOWN_MARKS.map((before) => closing - before + 1000).filter((t) => t > Date.now()).map((t) => new Date(t).toISOString());
}

async function refreshCountdown(target: SlackCountdownTarget) {
  "use step";
  const { getDb } = await import("@/lib/db");
  const { event } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await getDb().select({ closingAt: event.closingAt }).from(event).where(and(eq(event.id, target.eventId), eq(event.orgId, target.orgId)));
  // A moved closing ceremony starts its own countdown; this one stops.
  if (!row || row.closingAt.toISOString() !== target.closingAt) return false;
  const { syncSlackSafe } = await import("@/lib/slack/sync");
  await syncSlackSafe(target.orgId);
  return true;
}
