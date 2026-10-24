import { createHook, getWorkflowMetadata } from "workflow";
import type { AgentTarget, OperationResult } from "@/lib/agent/operations";

export async function agentRunWorkflow(target: AgentTarget) {
  "use workflow";
  using hook = createHook({ token: `agent-run:${target.orgId}:${target.generation}:${target.kind}:${target.evaluateDemo}:${target.filingYear ?? "current"}:${target.triggerId ?? "sweep"}` });
  const conflict = await hook.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  const { workflowRunId } = getWorkflowMetadata();
  try {
    const plan = await begin(target, workflowRunId);
    if (!plan) return { superseded: true };
    const totals = { processed: 0, proposed: 0, blocked: 0 };
    for (const [type, ids] of [["claim", plan.claimIds], ["award", plan.awardIds]] as const) {
      for (let offset = 0; offset < ids.length; offset += 3) {
        const results = await Promise.all(ids.slice(offset, offset + 3).map((id) => evaluate(target, workflowRunId, type, id)));
        for (const result of results) { totals.processed += result.processed; totals.proposed += result.proposed; totals.blocked += result.blocked; }
      }
    }
    const scheduled = await schedule(target);
    return await finish(target, workflowRunId, { ...totals, ...scheduled });
  } catch (error) {
    await failed(target, workflowRunId);
    throw error;
  }
}

async function begin(target: AgentTarget, runId: string) {
  "use step";
  const { beginAgentRun } = await import("@/lib/agent/operations");
  return beginAgentRun(target, runId);
}
async function evaluate(target: AgentTarget, runId: string, type: "claim" | "award", id: string) {
  "use step";
  const { evaluateAgentObject } = await import("@/lib/agent/operations");
  return evaluateAgentObject(target, runId, type, id);
}
async function schedule(target: AgentTarget) {
  "use step";
  const { currentGeneration } = await import("@/lib/agent/operations");
  const { getDb } = await import("@/lib/db");
  if (!await currentGeneration(getDb(), target)) return { chased: 0, waiting: 0 };
  const { startTaxChases, startPendingApprovals } = await import("@/lib/agent/triggers");
  const chases = target.kind === "claims" ? [] : await startTaxChases(target.orgId);
  const approvals = await startPendingApprovals(target.orgId);
  return { chased: chases.length, waiting: approvals.length };
}
async function finish(target: AgentTarget, runId: string, totals: OperationResult & { chased: number; waiting: number }) {
  "use step";
  const { finishAgentRun } = await import("@/lib/agent/operations");
  return finishAgentRun(target, runId, totals);
}
async function failed(target: AgentTarget, runId: string) {
  "use step";
  const { failAgentRun } = await import("@/lib/agent/operations");
  await failAgentRun(target, runId);
}
