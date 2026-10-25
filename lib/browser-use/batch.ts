import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { agentActor, conflict, recordDecision } from "@/lib/server/core";
import { lockOrgFinance } from "@/lib/server/payouts";
import { checkBatch, controller, failBatch, settleConfirmedBatch, type BatchTarget } from "@/lib/computer-use/batch-run";
import { cloudRequest, publicAppUrl, runCostLimit, uploadBundle, type CloudEvents, type CloudRun, type RunStatus } from "./client";
import { financeFingerprint } from "./fingerprint";
import { cloudState, portalKey, type CloudState } from "./state";
import { MAX_PORTAL_UPLOAD } from "./portal";

const table = s.disbursementBatch;
async function load(t: BatchTarget) {
  const [b] = await getDb().select().from(table).where(and(eq(table.id, t.batchId), eq(table.orgId, t.orgId)));
  if (!b) throw conflict("Batch not found.");
  return b;
}
async function patch(t: BatchTarget, values: Partial<CloudState>) {
  await getDb().update(table).set({ state: sql`${table.state} || ${JSON.stringify(values)}::jsonb`, updatedAt: new Date() }).where(eq(table.id, t.batchId));
}
async function log(t: BatchTarget, summary: string) {
  await recordDecision(getDb(), { orgId: t.orgId, runId: t.batchId, objectType: "disbursement_batch", objectId: t.batchId,
    action: "batch.browser-use", actor: agentActor(t.orgId), tool: "browserUse", status: "running", summary });
}

/** The expensive gate finishes before any paid cloud browser is opened. */
export async function preflightCloudBatch(t: BatchTarget): Promise<boolean> {
  await patch(t, { validating: true });
  return getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const [b] = await tx.select().from(table).where(eq(table.id, t.batchId));
    if (b.status === "cancelled") return false;
    const state = cloudState(b.state);
    if (!state || !b.documentId) throw conflict("The cloud batch is not prepared.");
    if (b.status === "filling" && state.fingerprint) {
      await tx.update(table).set({ state: { ...state, validating: false } }).where(eq(table.id, b.id));
      return true;
    }
    const actor = await controller(tx, b);
    // Detect even global rule/rate changes while the full validation is running.
    const before = await financeFingerprint(tx, t.orgId);
    await checkBatch(tx, actor, b);
    const after = await financeFingerprint(tx, t.orgId);
    if (before !== after) throw conflict("Payment policy changed during validation. Retry the batch.");
    await tx.update(table).set({ status: "filling", state: { ...state, validating: false, fingerprint: after, validUntil: new Date(Date.now() + 15 * 60_000).toISOString() }, updatedAt: new Date() }).where(eq(table.id, b.id));
    return true;
  });
}

/** Exactly one managed agent run for upload, review and submission. */
export async function startCloudBatch(t: BatchTarget): Promise<void> {
  let b = await load(t), state = cloudState(b.state);
  if (b.status === "cancelled") return;
  if (!state?.fingerprint || !b.documentId) throw conflict("Validate the batch before opening its browser.");
  if (state.runId) return;
  if (state.dispatching) throw conflict("Browser Use may have accepted this run. Check Cloud activity before retrying; a second run was not started.");
  const [doc] = await getDb().select().from(s.document).where(eq(s.document.id, b.documentId));
  if (!doc || doc.sizeBytes > MAX_PORTAL_UPLOAD) throw conflict("Use a batch bundle no larger than 4 MB for the hosted portal.");
  if (!state.workspaceId) {
    const workspace = await cloudRequest<{ id: string }>("/workspaces", { name: `Eve ${b.id}` });
    if (!workspace.id) throw new Error("Browser Use did not return a workspace ID.");
    await patch(t, { workspaceId: workspace.id });
    state = { ...state, workspaceId: workspace.id };
  }
  if (!state.fileId) {
    const file = await uploadBundle(state.workspaceId!, doc.bytes);
    await patch(t, { fileId: file.id, filePath: file.path });
    state = { ...state, fileId: file.id, filePath: file.path };
  }
  const claimed = await getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const [current] = await tx.select().from(table).where(eq(table.id, b.id));
    const latest = cloudState(current.state);
    if (latest?.runId) return false;
    if (current.status !== "filling" || latest?.attempt !== state!.attempt || latest.dispatching || latest.runId) throw conflict("This batch's browser launch is already claimed or cancelled.");
    await tx.update(table).set({ state: { ...latest, dispatching: true }, updatedAt: new Date() }).where(eq(table.id, b.id));
    return true;
  });
  if (!claimed) return;
  const origin = publicAppUrl();
  const portal = `${origin}/api/sponsor-portal/${b.id}/${portalKey(b.id, state.attempt, "link")}?bulk=1`;
  const run = await cloudRequest<CloudRun>("/runs", {
    task: `Submit this controller-approved batch to the fictional Westbrook portal. Open ${portal}. Sign in as eve.calhacks using secret binding portal_password. Upload the attached ${state.filePath || "uploads/batch.zip"} through Bulk payment request. Review the imported batch: ID ${b.id}, ${b.manifest.totals.count} payments, net USD ${(b.manifest.totals.netCents / 100).toFixed(2)}. If those values match, click Submit batch once and return the confirmation number. The portal enforces the approved contents and current payment checks. Do not edit the ZIP, create other payments, visit unrelated sites, or invent missing data. Stop and report any validation error. This is a demo: no real money moves.`,
    workspaceId: state.workspaceId, maxCostUsd: runCostLimit(),
    ...(process.env.EVE_BROWSER_USE_MODEL ? { model: process.env.EVE_BROWSER_USE_MODEL } : {}),
    browserSettings: { proxyCountryCode: null, screenWidth: 1024, screenHeight: 768, record: false },
    secretBindings: [{ alias: "portal_password", source: { type: "inline", value: portalKey(b.id, state.attempt, "login") }, allowedDomains: [new URL(origin).hostname] }],
    outputSchema: { type: "object", properties: { confirmation: { type: "string" } }, required: ["confirmation"] },
  });
  if (!run.id || !run.sessionId) throw new Error("Browser Use did not return run and session IDs.");
  await patch(t, { runId: run.id, sessionId: run.sessionId });
  b = await load(t);
  if (["cancelled", "failed"].includes(b.status)) { await closeCloudBatch(t); return; }
  await log(t, `Browser Use started one session for all ${b.manifest.totals.count} payments.`);
}

export async function pollCloudBatch(t: BatchTarget): Promise<"continue" | "submitted" | "stopped"> {
  const b = await load(t), state = cloudState(b.state);
  if (b.status === "cancelled") return "stopped";
  if (state?.receipt) return "submitted";
  if (!state?.runId) throw new Error("No Browser Use run was saved. Check Cloud activity before retrying.");
  const { status } = await cloudRequest<{ status: RunStatus }>(`/runs/${state.runId}/status`);
  let cursor = state.cursor ?? 0, hasMore = true;
  for (let i = 0; hasMore && i < 10; i++) {
    const page = await cloudRequest<CloudEvents>(`/runs/${state.runId}/events?after=${cursor}`);
    for (const event of page.events) {
      cursor = Math.max(cursor, event.id);
      if (["browser.ready", "browser.reattached"].includes(event.type)) {
        const url = event.data.live_view_url;
        if (typeof url === "string" && new URL(url).protocol === "https:") {
          await getDb().update(table).set({ streamUrl: url }).where(and(eq(table.id, b.id), eq(table.status, "filling")));
        }
        if (typeof event.data.browser_session_id === "string") await patch(t, { browserId: event.data.browser_session_id });
      }
    }
    cursor = Math.max(cursor, page.nextAfter ?? cursor); hasMore = !!page.hasMore;
  }
  await patch(t, { cursor });
  if (cloudState((await load(t)).state)?.receipt) return "submitted";
  if (!hasMore && ["completed", "failed", "cancelled"].includes(status)) throw new Error(`Browser Use ${status} without a portal receipt. Nothing was recorded as submitted.`);
  return "continue";
}

export async function finishCloudBatch(t: BatchTarget) {
  const state = cloudState((await load(t)).state);
  if (!state?.receipt) throw new Error("The portal has no receipt for this batch.");
  await settleConfirmedBatch(t, { ...state.receipt });
}
export async function failCloudBatch(t: BatchTarget, reason: string) {
  if (cloudState((await load(t)).state)?.receipt) {
    try { await finishCloudBatch(t); return; } catch { /* Preserve receipt and reservations. */ }
  }
  await failBatch(t, reason);
}
export async function closeCloudBatch(t: BatchTarget) {
  const b = await load(t), state = cloudState(b.state);
  if (!state) return;
  if (state.runId) await cloudRequest(`/runs/${state.runId}/cancel`, {}).catch(() => undefined);
  if (state.browserId) await cloudRequest(`/browsers/${state.browserId}`, { action: "stop" }, "PATCH").catch(() => undefined);
  await getDb().update(table).set({ streamUrl: null }).where(eq(table.id, b.id));
}
