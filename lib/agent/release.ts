import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getHookByToken, resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import type { ActorContext } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { decisionLog, payout, person } from "@/lib/db/schema";
import { payoutApprovalWorkflow } from "@/workflows/payout-approval";
import { approvalToken, assertControllerApproval, loadApprovalTarget, payoutQuoteFingerprint, type ApprovalTarget } from "./payout-approval";

export async function startPayoutApproval(orgId: string, payoutId: string): Promise<string | null> {
  const target = await loadApprovalTarget(orgId, payoutId);
  if (!target) return null;
  try { return (await getHookByToken(approvalToken(target))).runId; }
  catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  return (await start(payoutApprovalWorkflow, [target])).runId;
}

async function resumeRegistered(target: ApprovalTarget, memberId: string, via?: "slack"): Promise<string> {
  const token = approvalToken(target);
  const payload = { memberId, quoteFingerprint: target.quoteFingerprint, ...(via ? { via } : {}) };
  try { return (await resumeHook(token, payload)).runId; }
  catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  await start(payoutApprovalWorkflow, [target]);
  // start() returns before the workflow registers its hook. Bound the registration race to 3.1 seconds.
  for (const delay of [100, 200, 400, 800, 1600]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try { return (await resumeHook(token, payload)).runId; }
    catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  }
  throw new Error("The approval workflow is still starting. Retry the release shortly.");
}

/** API callers provide only payout ids. Actor identity and quote terms always come from authenticated server state. */
export async function queueControllerRelease(actor: ActorContext, ids: string[]): Promise<ActionResult & { status: number }> {
  if (actor.role !== "controller") return { ok: false, status: 403, message: "Only a controller can release money." };
  if (!ids.length || ids.length > 200 || ids.some((id) => !id || id.length > 100)) return { ok: false, status: 400, message: "Choose between 1 and 200 payouts." };
  const queued: { payoutId: string; runId: string }[] = [];
  const completed: string[] = [];
  const failed: { payoutId: string; reason: string }[] = [];
  const unique = [...new Set(ids)];
  const db = getDb();
  // Pin the whole selection before resuming any workflow. Loading later rows
  // after earlier payments finish could silently authorize a sibling's new quote.
  const rows = await db.select({ payout, recipient: { email: person.email } }).from(payout)
    .leftJoin(person, and(eq(person.id, payout.personId), eq(person.orgId, actor.orgId)))
    .where(and(eq(payout.orgId, actor.orgId), inArray(payout.id, unique))).catch(() => null);
  if (!rows) return { ok: false, status: 503, message: "The release service is temporarily unavailable. Try again shortly." };
  const byId = new Map(rows.map((row) => [row.payout.id, row]));
  const events: (typeof decisionLog.$inferInsert)[] = [];
  const uncertain: string[] = [];
  async function queueOne(id: string) {
    const { payout: row, recipient } = byId.get(id) ?? {};
    if (!row) { failed.push({ payoutId: id, reason: "Payout not found." }); return; }
    if (row.status === "paid") { completed.push(row.id); return; }
    if (!recipient) { failed.push({ payoutId: id, reason: "Recipient not found." }); return; }
    try { assertControllerApproval(actor, row, recipient.email); }
    catch (error) { failed.push({ payoutId: id, reason: (error as Error).message }); return; }
    const target = { orgId: actor.orgId, payoutId: row.id, quoteFingerprint: payoutQuoteFingerprint(row) };
    try {
      const submittedAt = new Date();
      const runId = await resumeRegistered(target, actor.memberId, actor.via);
      queued.push({ payoutId: id, runId });
      // Distinguish a controller's submitted approval from a workflow that
      // is merely waiting for one. The UI must still allow the latter.
      const eventId = createHash("sha256").update(`${runId}:controller-queued:${actor.memberId}`).digest("hex").slice(0, 32);
      events.push({
        id: `dec_${eventId}`, orgId: actor.orgId, runId, objectType: "payout", objectId: id, createdAt: submittedAt,
        personId: row.personId, action: "Controller approval submitted",
        summary: "The controller submitted this quote for final checks. The payment is not complete until settlement is recorded.",
        actor: actor.name, actorRole: actor.role, status: "running", tool: "queueControllerRelease",
        facts: { quoteFingerprint: target.quoteFingerprint, approverId: actor.memberId, ...(actor.via ? { via: actor.via } : {}) },
      });
    }
    catch {
      uncertain.push(id);
    }
  }
  for (let offset = 0; offset < unique.length; offset += 5) {
    const batch = unique.slice(offset, offset + 5);
    const results = await Promise.allSettled(batch.map(queueOne));
    results.forEach((result, index) => {
      if (result.status === "rejected") failed.push({ payoutId: batch[index], reason: "The release service is temporarily unavailable. Check this payout before retrying." });
    });
  }
  if (events.length) {
    try { await db.insert(decisionLog).values(events).onConflictDoNothing(); }
    catch {
      // Hooks are already resumed; an activity-feed failure cannot undo them.
      console.warn("[workflow] Release requests queued; activity update unavailable.");
    }
  }
  if (uncertain.length) {
    const paid = new Set<string>();
    try {
      const latest = await db.select({ id: payout.id, status: payout.status }).from(payout)
        .where(and(eq(payout.orgId, actor.orgId), inArray(payout.id, uncertain)));
      for (const row of latest) if (row.status === "paid") paid.add(row.id);
    } catch { /* An unavailable status read must not report an uncertain payment as completed. */ }
    for (const id of uncertain) {
      if (paid.has(id)) completed.push(id);
      else failed.push({ payoutId: id, reason: "The workflow could not confirm the release request. Check the payout status before retrying." });
    }
  }
  return {
    ok: queued.length > 0 || completed.length > 0, status: queued.length ? 202 : completed.length ? 200 : 409,
    message: (queued.length ? `Controller approval recorded for ${queued.length} payout${queued.length === 1 ? "" : "s"}. Release checks are running.` : completed.length ? "These payouts have already completed." : failed.map((f) => f.reason).join(" "))
      + ((queued.length || completed.length) && failed.length ? ` ${failed.length} payout${failed.length === 1 ? " was" : "s were"} not queued; review before retrying.` : ""),
    data: { queued, completed, failed },
  };
}
