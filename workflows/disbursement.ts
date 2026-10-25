import { createHook, getWorkflowMetadata } from "workflow";
import type { BatchTarget } from "@/lib/computer-use/batch-run";

/** One workflow and desktop for the whole batch. No per-payee agent fan-out. */
export async function disbursementWorkflow(target: BatchTarget) {
  "use workflow";
  using hook = createHook({ token: `bulk:${target.orgId}:${target.batchId}` });
  if (await hook.getConflict()) return;
  const { workflowRunId } = getWorkflowMetadata();
  let desktop: string | null = null;
  try {
    const payoutIds = await begin(target, workflowRunId);
    if (!payoutIds) return;
    for (const id of payoutIds) await prepareItem(target, id);
    if (!await bundle(target)) return;
    desktop = await boot(target, workflowRunId);
    if (!desktop) return;
    // Fixed budget independent of recipient count.
    for (let i = 0; i < 24; i++) {
      const outcome = await turn(target);
      if (outcome === "stopped") return;
      if (outcome === "review" && !await authorize(target)) return;
      if (outcome === "submitted") { await finish(target); return;
}
    }
    throw new Error("The portal task reached its 24-turn limit.");
  } catch (error) {
    await failed(target, error instanceof Error ? error.message : "The portal task stopped.");
  } finally { await close(target, desktop);
}
}
async function boot(t: BatchTarget, id: string) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).bootBatch(t, id);
}
async function turn(t: BatchTarget) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).batchTurn(t);
}
async function authorize(t: BatchTarget) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).authorizeBatch(t);
}
async function finish(t: BatchTarget) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).finishBatch(t);
}
async function failed(t: BatchTarget, reason: string) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).failBatch(t, reason);
}
async function close(t: BatchTarget, id: string | null) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).closeBatch(t, id);
}

async function begin(t: BatchTarget, id: string) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).beginBatch(t, id);
}
async function prepareItem(t: BatchTarget, id: string) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).prepareBatchItem(t, id);
}
async function bundle(t: BatchTarget) {
  "use step";
  return (await import("@/lib/computer-use/batch-run")).prepareBatchBundle(t);
}
