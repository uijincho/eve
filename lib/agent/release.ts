import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
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

async function resumeRegistered(target: ApprovalTarget, memberId: string): Promise<string> {
  const token = approvalToken(target);
  const payload = { memberId, quoteFingerprint: target.quoteFingerprint };
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
  async function queueOne(id: string) {
    const [row] = await getDb().select().from(payout).where(and(eq(payout.id, id), eq(payout.orgId, actor.orgId)));
    if (!row) { failed.push({ payoutId: id, reason: "Payout not found." }); return; }
    if (row.status === "paid") { completed.push(row.id); return; }
    const [recipient] = await getDb().select({ email: person.email }).from(person).where(and(eq(person.id, row.personId), eq(person.orgId, actor.orgId)));
    if (!recipient) { failed.push({ payoutId: id, reason: "Recipient not found." }); return; }
    try { assertControllerApproval(actor, row, recipient.email); }
    catch (error) { failed.push({ payoutId: id, reason: (error as Error).message }); return; }
    const target = { orgId: actor.orgId, payoutId: row.id, quoteFingerprint: payoutQuoteFingerprint(row) };
    try {
      const submittedAt = new Date();
      const runId = await resumeRegistered(target, actor.memberId);
      queued.push({ payoutId: id, runId });
      // Distinguish a controller's submitted approval from a workflow that
      // is merely waiting for one. The UI must still allow the latter.
      const eventId = createHash("sha256").update(`${runId}:controller-queued:${actor.memberId}`).digest("hex").slice(0, 32);
      try {
        await getDb().insert(decisionLog).values({
          id: `dec_${eventId}`, orgId: actor.orgId, runId, objectType: "payout", objectId: id, createdAt: submittedAt,
          personId: row.personId, action: "Controller approval submitted",
          summary: "The controller submitted this quote for final checks. The payment is not complete until settlement is recorded.",
          actor: actor.name, actorRole: actor.role, status: "running", tool: "queueControllerRelease",
          facts: { quoteFingerprint: target.quoteFingerprint, approverId: actor.memberId },
        }).onConflictDoNothing();
      } catch {
        // The hook is already resumed. A feed write must not misreport that
        // committed request as rejected; execution records its own evidence.
        console.warn("[workflow] Release request queued; activity update unavailable.");
      }
    }
    catch {
      const [latest] = await getDb().select({ status: payout.status }).from(payout).where(and(eq(payout.id, id), eq(payout.orgId, actor.orgId)));
      if (latest?.status === "paid") completed.push(id);
      else failed.push({ payoutId: id, reason: "The workflow could not confirm the release request. Check the payout status before retrying." });
    }
  }
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 5) {
    const batch = unique.slice(offset, offset + 5);
    const results = await Promise.allSettled(batch.map(queueOne));
    results.forEach((result, index) => {
      if (result.status === "rejected") failed.push({ payoutId: batch[index], reason: "The release service is temporarily unavailable. Check this payout before retrying." });
    });
  }
  return {
    ok: queued.length > 0 || completed.length > 0, status: queued.length ? 202 : completed.length ? 200 : 409,
    message: queued.length ? `Controller approval recorded for ${queued.length} payout${queued.length === 1 ? "" : "s"}. Release checks are running.` : completed.length ? "These payouts have already completed." : failed.map((f) => f.reason).join(" "),
    data: { queued, completed, failed },
  };
}
