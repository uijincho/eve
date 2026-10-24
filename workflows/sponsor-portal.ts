import { createHook, FatalError, getWorkflowMetadata, sleep } from "workflow";
import type { EndReason, PortalDecision, PortalTarget, TurnResult } from "@/lib/computer-use/portal-run";

/**
 * Eve enters one drafted sponsor packet on the sponsor's web portal (computer use).
 * Each Claude turn is its own durable step. Eve stops on the portal's Review page and waits on
 * a hook that only the authenticated controller route resumes; no step can approve itself.
 * After the portal's own records confirm the request, the packet is submitted in Eve as that
 * controller. The desktop is deleted however the run ends.
 */
export async function sponsorPortalWorkflow(target: PortalTarget) {
  "use workflow";
  using hook = createHook<PortalDecision>({ token: `portal-submit:${target.orgId}:${target.portalRunId}` });
  const conflict = await hook.getConflict();
  if (conflict) return { duplicateOf: conflict.runId };
  const { workflowRunId } = getWorkflowMetadata();
  const answer = Promise.resolve(hook);
  let sandboxId: string | null = null;
  try {
    const booted = await boot(target, workflowRunId);
    sandboxId = booted.sandboxId;
    if (!booted.started) return await end(target, workflowRunId, "stopped");

    let outcome = await fill(target, workflowRunId, 40);
    if (outcome !== "review") return await end(target, workflowRunId, endReason(outcome));

    await hold(target, workflowRunId);
    const decided = await Promise.race([
      answer.then((value) => ({ kind: "answer" as const, value })),
      sleep("25m").then(() => ({ kind: "timeout" as const })),
    ]);
    if (decided.kind === "timeout") return await end(target, workflowRunId, "timeout");
    if (!await decide(target, workflowRunId, decided.value)) return { submitted: false };

    outcome = await fill(target, workflowRunId, 6);
    if (outcome !== "submitted") return await end(target, workflowRunId, endReason(outcome));
    return await complete(target, workflowRunId);
  } catch (error) {
    await failed(target, workflowRunId, error instanceof Error ? error.message : "Unexpected error.");
    throw new FatalError("The portal run failed; see its decision log.");
  } finally {
    await close(target, sandboxId);
  }
}

/** Runs turns until one stops the loop. Every turn is a separate durable step. */
async function fill(target: PortalTarget, runId: string, maxTurns: number): Promise<TurnResult | "budget"> {
  for (let i = 0; i < maxTurns; i += 1) {
    const outcome = await turn(target, runId);
    if (outcome !== "continue") return outcome;
  }
  return "budget";
}

function endReason(outcome: TurnResult | "budget"): EndReason {
  return outcome === "escalated" || outcome === "stopped" || outcome === "lost" || outcome === "budget" ? outcome : "lost";
}

async function boot(target: PortalTarget, runId: string) {
  "use step";
  const { bootPortalRun } = await import("@/lib/computer-use/portal-run");
  return bootPortalRun(target, runId);
}

async function turn(target: PortalTarget, runId: string) {
  "use step";
  const { portalTurn } = await import("@/lib/computer-use/portal-run");
  return portalTurn(target, runId);
}

async function hold(target: PortalTarget, runId: string) {
  "use step";
  const { holdForApproval } = await import("@/lib/computer-use/portal-run");
  await holdForApproval(target, runId);
}

async function decide(target: PortalTarget, runId: string, answer: PortalDecision) {
  "use step";
  const { applyDecision } = await import("@/lib/computer-use/portal-run");
  return applyDecision(target, runId, answer);
}

async function complete(target: PortalTarget, runId: string) {
  "use step";
  const { completePortalRun } = await import("@/lib/computer-use/portal-run");
  return completePortalRun(target, runId);
}

async function end(target: PortalTarget, runId: string, reason: EndReason) {
  "use step";
  const { endPortalRun } = await import("@/lib/computer-use/portal-run");
  await endPortalRun(target, runId, reason);
  return { submitted: false, reason };
}

async function failed(target: PortalTarget, runId: string, message: string) {
  "use step";
  const { failPortalRun } = await import("@/lib/computer-use/portal-run");
  await failPortalRun(target, runId, message);
}

async function close(target: PortalTarget, sandboxId: string | null) {
  "use step";
  const { closePortalDesktop } = await import("@/lib/computer-use/portal-run");
  await closePortalDesktop(target, sandboxId);
}
