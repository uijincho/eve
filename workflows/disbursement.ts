import { createHook, getWorkflowMetadata, sleep } from "workflow";
import type { BatchTarget } from "@/lib/computer-use/batch-run";

/** One hosted Browser Use run owns the entire batch. Polling starts no models. */
export async function disbursementWorkflow(target: BatchTarget) {
  "use workflow";
  using hook = createHook({ token: `bulk:${target.orgId}:${target.batchId}` });
  if (await hook.getConflict()) return;
  const { workflowRunId } = getWorkflowMetadata();
  try {
    const payoutIds = await begin(target, workflowRunId);
    if (!payoutIds) return;
    for (let i = 0; i < payoutIds.length; i++) {
      await prepareItem(target, payoutIds[i]);
      if ((i + 1) % 10 === 0) await sleep("1s");
    }
    if (!await bundle(target)) return;
    await sleep("1s");
    if (!await preflight(target)) return;
    await sleep("1s");
    await launchCloud(target);
    for (let i = 0; i < 180; i++) {
      await sleep("5s");
      const outcome = await pollCloud(target);
      if (outcome === "stopped") return;
      if (outcome === "submitted") {
        await sleep("1s");
        await finish(target);
        return;
      }
    }
    throw new Error("Browser Use did not finish within 15 minutes.");
  } catch (error) {
    await failed(target, error instanceof Error ? error.message : "The cloud task stopped.");
  } finally {
    await close(target);
  }
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
async function preflight(t: BatchTarget) {
  "use step";
  return (await import("@/lib/browser-use/batch")).preflightCloudBatch(t);
}
async function launchCloud(t: BatchTarget) {
  "use step";
  return (await import("@/lib/browser-use/batch")).startCloudBatch(t);
}
async function pollCloud(t: BatchTarget) {
  "use step";
  return (await import("@/lib/browser-use/batch")).pollCloudBatch(t);
}
async function finish(t: BatchTarget) {
  "use step";
  return (await import("@/lib/browser-use/batch")).finishCloudBatch(t);
}
async function failed(t: BatchTarget, reason: string) {
  "use step";
  return (await import("@/lib/browser-use/batch")).failCloudBatch(t, reason);
}
async function close(t: BatchTarget) {
  "use step";
  return (await import("@/lib/browser-use/batch")).closeCloudBatch(t);
}
