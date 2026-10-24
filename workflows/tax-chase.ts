import { createHook, getWorkflowMetadata, sleep } from "workflow";
import type { ChaseAdvance, ChaseTarget } from "@/lib/agent/automation";

/** Durable day 0, 2, 5, 10 sequence. A valid form stops the next stage. */
export async function taxChaseWorkflow(target: ChaseTarget, acceleratedDemo = false) {
  "use workflow";
  using guard = createHook({ token: `tax-chase:${target.orgId}:${target.personId}:${target.generation}` });
  const conflict = await guard.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  const { workflowRunId } = getWorkflowMetadata();
  const fast = acceleratedDemo && await isDemoOrganization(target.orgId);
  for (const day of [0, 2, 5, 10]) {
    if (day > 0) {
      const previous = day === 2 ? 0 : day === 5 ? 2 : 5;
      await sleep((day - previous) * (fast ? 1000 : 86_400_000));
    }
    const stage = await chaseStage(target, day, workflowRunId, fast);
    for (const id of stage.noticeIds) {
      try { await deliverNotice(target.orgId, id); }
      catch { /* The queued notice remains available for the daily delivery retry. */ }
    }
    if (stage.complete) {
      if (stage.noticeIds.length === 0) await finishChase(target, workflowRunId, stage.reason);
      return { complete: true, escalated: day === 10 && stage.noticeIds.length > 0, stage: day };
    }
  }
}

async function isDemoOrganization(orgId: string): Promise<boolean> {
  "use step";
  const { getDb } = await import("@/lib/db");
  const { organization } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [org] = await getDb().select({ isDemo: organization.isDemo }).from(organization).where(eq(organization.id, orgId));
  return org?.isDemo === true;
}

async function chaseStage(target: ChaseTarget, day: number, runId: string, fast: boolean): Promise<ChaseAdvance> {
  "use step";
  const { advanceTaxChase } = await import("@/lib/agent/automation");
  return advanceTaxChase(target, day, runId, fast);
}

async function deliverNotice(orgId: string, noticeId: string) {
  "use step";
  const { deliverRecordedNotice } = await import("@/lib/agent/automation");
  const result = await deliverRecordedNotice(orgId, noticeId);
  if (result.status === "queued") throw new Error("Notification provider unavailable; portal notice remains available.");
  return result;
}

async function finishChase(target: ChaseTarget, runId: string, reason: string) {
  "use step";
  const { markChaseComplete } = await import("@/lib/agent/automation");
  await markChaseComplete(target, runId, reason);
}
