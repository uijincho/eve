import { createHook, FatalError, getWorkflowMetadata, sleep } from "workflow";
import type { ApprovalTarget, ControllerApproval } from "@/lib/agent/payout-approval";

/** No agent step can manufacture approval. The hook is resumed only by the authenticated controller route. */
export async function payoutApprovalWorkflow(target: ApprovalTarget) {
  "use workflow";
  using hook = createHook<ControllerApproval>({
    token: `payout-release:${target.orgId}:${target.payoutId}:${target.quoteFingerprint}`,
  });
  const conflict = await hook.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  const { workflowRunId } = getWorkflowMetadata();
  const approval = Promise.resolve(hook);
  for (let stage = 0; stage < 3; stage += 1) {
    if (!await waitForController(target, workflowRunId, stage)) return { superseded: true };
    const outcome = await Promise.race([
      approval.then((value) => ({ kind: "approval" as const, value })),
      sleep(stage === 0 ? "1h" : "1d").then(() => ({ kind: "reminder" as const })),
    ]);
    if (outcome.kind === "approval") return completeApproval(target, outcome.value, workflowRunId);
  }
  if (!await waitForController(target, workflowRunId, 3)) return { superseded: true };
  return completeApproval(target, await approval, workflowRunId);
}

async function waitForController(target: ApprovalTarget, runId: string, stage: number) {
  "use step";
  const { recordApprovalWait } = await import("@/lib/agent/payout-approval");
  const waiting = await recordApprovalWait(target, runId, stage);
  // Each reminder is also when a release that has waited too long reaches the backup approver in Slack.
  if (waiting && stage > 0) {
    const { kickSlack } = await import("@/lib/slack/kick");
    await kickSlack(target.orgId);
  }
  return waiting;
}

async function completeApproval(target: ApprovalTarget, approval: ControllerApproval, runId: string) {
  "use step";
  const { executeControllerApproval, recordApprovalFailure, ApprovalConflictError } = await import("@/lib/agent/payout-approval");
  try {
    const result = await executeControllerApproval(target, approval, runId);
    // Release can change sibling tax quotes. Each new quote needs its own fresh approval hook.
    // The financial transaction already committed; a failed follow-up start must not replay it.
    try {
      const { startPendingApprovals } = await import("@/lib/agent/triggers");
      await startPendingApprovals(target.orgId);
    } catch { console.warn("[workflow] Updated approval waits will be retried by the scheduled sweep."); }
    const { kickSlack } = await import("@/lib/slack/kick");
    await kickSlack(target.orgId);
    return result;
  } catch (error) {
    // Only known business errors may enter the visible log; database/provider errors may contain private values.
    const { ActionError } = await import("@/lib/server/core");
    const { LedgerError } = await import("@/lib/ledger");
    if (error instanceof ActionError || error instanceof ApprovalConflictError || error instanceof LedgerError) {
      await recordApprovalFailure(target, runId, error.message);
      const { kickSlack } = await import("@/lib/slack/kick");
      await kickSlack(target.orgId);
      throw new FatalError(error.message);
    }
    // An interrupted database transaction can be retried: the payout row lock and ledger keys deduplicate it.
    throw new Error("The release service is temporarily unavailable. Retry with the same approval.");
  }
}
