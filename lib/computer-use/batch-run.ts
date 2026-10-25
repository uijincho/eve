/** One durable browser task for an entire, controller-authorized batch. */
import { Sandbox } from "@e2b/desktop";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { start } from "workflow/api";
import { demoModeEnabled, type ActorContext } from "@/lib/auth/session";
import type { ActionResult, DisbursementBatch } from "@/lib/contracts";
import { getDb, type Executor, type Tx } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { batchQuoteKey } from "@/lib/disbursement";
import { ActionError, agentActor, conflict, forbidden, loadOrgEvent, recordDecision, storeDocument } from "@/lib/server/core";
import { assertNotBeneficiary, lockOrgFinance, prepareRelease, termsKey } from "@/lib/server/payouts";
import { sponsorCreate, sponsorSubmit } from "@/lib/server/services";
import { BATCH_FILE, batchBrief, buildBatchBundle, canonical, matchesBatchImport } from "./batch-packet";
import { authorizePortalBatch, bootComputer, capture, portalImports, portalRecords } from "./computer";
import { loadPortalPacket, loadPortalPackets, portalConfigured, portalPassword } from "./portal-run";
import { newAgentState, runAgentTurn, type AgentState } from "./turn";

type Batch = typeof s.disbursementBatch.$inferSelect;
type Result = ActionResult & { status: number };
export interface BatchTarget { orgId: string; batchId: string }
interface State { agent: AgentState; submissionAuthorized?: boolean }
const table = s.disbursementBatch;
const message = (error: unknown) => error instanceof Error ? error.message : "The portal service is unavailable.";

async function load(t: BatchTarget, db: Executor = getDb()) {
  const [b] = await db.select().from(table).where(and(eq(table.id, t.batchId), eq(table.orgId, t.orgId)));
  if (!b) throw conflict("Batch not found.");
  return b;
}
async function save(t: BatchTarget, patch: Partial<typeof table.$inferInsert>) {
  await getDb().update(table).set({ ...patch, updatedAt: new Date() }).where(and(eq(table.id, t.batchId), eq(table.orgId, t.orgId)));
}
async function log(t: BatchTarget, summary: string, status: "running" | "done" | "escalated", documentId?: string, db: Executor = getDb()) {
  await recordDecision(db, { orgId: t.orgId, runId: t.batchId, objectType: "disbursement_batch", objectId: t.batchId,
    action: `batch.${status}`, actor: agentActor(t.orgId), tool: "bulkPortal", summary, status, documentId,
    facts: { batchId: t.batchId } });
}
async function controller(db: Executor, b: Batch): Promise<ActorContext> {
  const [m] = await db.select().from(s.orgMember).where(and(eq(s.orgMember.id, b.approvedBy), eq(s.orgMember.orgId, b.orgId)));
  const { org } = await loadOrgEvent(db, b.orgId);
  if (!m || m.role !== "controller" || (m.demoPersona && (!org.isDemo || !demoModeEnabled()))) throw forbidden("The approving controller no longer has access. Cancel and obtain a new release.");
  return { memberId: m.id, orgId: m.orgId, role: m.role, name: m.name, email: m.email, personId: m.personId, userId: m.userId, demo: m.demoPersona && org.isDemo };
}

/** Recheck authorized terms and packet metadata under the organization lock. */
async function checkBatchEvidence(tx: Tx, actor: ActorContext, b: Pick<Batch, "id" | "orgId" | "feesPaidBy" | "evidence">) {
  const { org } = await loadOrgEvent(tx, b.orgId);
  if (org.mode === "direct" || org.feesPaidBy !== b.feesPaidBy) throw conflict("The sponsor payment policy changed. Cancel this batch and release a new one.");
  for (const item of b.evidence) {
    const check = await prepareRelease(tx, actor, item.payoutId, "sponsor", { expectTerms: item.terms, batchId: b.id });
    if (check.kind !== "ready") throw conflict("A payment was re-quoted. Cancel this batch and review the current amounts.");
  }
  const packets = await loadPortalPackets(b.orgId, b.evidence.map((item) => item.packetId), tx, { includeDocuments: false });
  for (const [index, item] of b.evidence.entries()) {
    const { packet } = packets[index];
    if (canonical(packet) !== canonical(item.packet)) throw conflict("A recipient or packet changed. Cancel this batch and release a new one.");
  }
}

/** Run the full existing settlement gate in a savepoint, then roll it back. No money/status is posted during validation. */
async function checkBatch(tx: Tx, actor: ActorContext, b: Pick<Batch, "id" | "orgId" | "feesPaidBy" | "evidence">) {
  await checkBatchEvidence(tx, actor, b);
  const rollback = new Error("batch-preflight-complete");
  try {
    await tx.transaction(async (sp) => {
      for (const item of b.evidence) {
        const result = await sponsorSubmit(sp, actor, { id: item.packetId }, b.id);
        if (!result.ok) throw conflict(result.message);
      }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

/** Fast release: bind the visible quotes and reserve every payout, then prepare in durable code steps. */
export async function releaseBatch(actor: ActorContext, input: { payouts: { id: string; quote: string }[] }): Promise<Result> {
  if (actor.role !== "controller") return { ok: false, status: 403, message: "Only a controller can release a batch." };
  const missing = portalConfigured();
  if (missing) return { ok: false, status: 503, message: missing };
  if (!input.payouts.length || input.payouts.length > 200 || new Set(input.payouts.map((p) => p.id)).size !== input.payouts.length) return { ok: false, status: 400, message: "Choose 1–200 different payouts." };
  const target = { orgId: actor.orgId, batchId: newId("batch") };
  try {
    await getDb().transaction(async (tx) => {
      await lockOrgFinance(tx, actor.orgId);
      const { org } = await loadOrgEvent(tx, actor.orgId);
      if (org.mode === "direct") throw conflict("Choose sponsor or hybrid mode to submit a batch to the sponsor.");
      const ids = input.payouts.map((p) => p.id);
      const rows = await tx.select({ payout: s.payout, person: s.person }).from(s.payout).innerJoin(s.person, eq(s.person.id, s.payout.personId))
        .where(and(eq(s.payout.orgId, actor.orgId), inArray(s.payout.id, ids)));
      if (rows.length !== ids.length) throw conflict("A payout was not found in this organization.");
      const reservations = await tx.select().from(s.disbursementBatchItem).where(inArray(s.disbursementBatchItem.payoutId, ids));
      if (reservations.length) throw conflict("A selected payment already belongs to a batch. Refresh Disburse to follow it.");
      const totals = { count: ids.length, grossCents: 0, withheldCents: 0, netCents: 0 };
      for (const { payout: p, person } of rows) {
        if (!["proposed", "approved"].includes(p.status) || p.currency !== "USD") throw conflict("Choose ready USD payouts only.");
        if (p.requestedBy === actor.memberId) throw forbidden("Another controller must release a payout you requested.");
        assertNotBeneficiary(actor, person, "release");
        if (batchQuoteKey(p) !== input.payouts.find((i) => i.id === p.id)!.quote) throw conflict("A displayed quote changed. Refresh and review the batch before releasing.");
        totals.grossCents += Number(p.grossMinor); totals.withheldCents += Number(p.withholdingMinor); totals.netCents += Number(p.grossMinor - p.withholdingMinor);
      }
      if (!Object.values(totals).every(Number.isSafeInteger)) throw conflict("Batch total exceeds the portal limit.");
      await tx.insert(table).values({ id: target.batchId, orgId: actor.orgId, approvedBy: actor.memberId, approvedByName: actor.name,
        requestedPayouts: [...input.payouts].sort((a, b) => a.id.localeCompare(b.id)),
        manifest: { version: 1, batchId: target.batchId, currency: "USD", payments: [], documents: [], totals }, manifestHash: "", evidence: [], feesPaidBy: org.feesPaidBy });
      await tx.insert(s.disbursementBatchItem).values(ids.map((payoutId) => ({ payoutId, batchId: target.batchId })));
      await tx.insert(s.approval).values(rows.map(({ payout: p }) => ({ id: newId("apr"), orgId: actor.orgId, objectType: "batch", objectId: target.batchId,
        requestedBy: p.requestedBy, approverId: actor.memberId, approverRole: "controller" as const, decision: "approved" as const, bankVersion: p.bankVersion,
        reason: `Authorized ${p.id}; quote ${batchQuoteKey(p)}` })));
      await recordDecision(tx, { orgId: actor.orgId, runId: target.batchId, objectType: "disbursement_batch", objectId: target.batchId, action: "batch.release",
        summary: `${actor.name} released ${ids.length} payments in one batch. Eve will prepare one bundle and submit only after all policy and import checks pass.`, actor, status: "running", tool: "releaseBatch", facts: { count: ids.length } });
    });
    return await launch(target);
  } catch (error) { return { ok: false, status: error instanceof ActionError ? error.status : 409, message: message(error) }; }
}

/** Claims the single workflow before any expensive preparation. */
export async function beginBatch(t: BatchTarget, runId: string): Promise<string[] | null> {
  return getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const b = await load(t, tx);
    if (b.status !== "preparing" || (b.workflowRunId && b.workflowRunId !== runId)) return null;
    await tx.update(table).set({ workflowRunId: runId }).where(eq(table.id, t.batchId));
    return b.requestedPayouts.map((p) => p.id);
  });
}

/** Ordinary deterministic code, checkpointed per payout. This starts no agent or browser. */
export async function prepareBatchItem(t: BatchTarget, payoutId: string) {
  return getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const b = await load(t, tx);
    if (b.status === "cancelled") return false;
    if (b.status !== "preparing") throw conflict("Batch is no longer preparing.");
    if (b.evidence.some((e) => e.payoutId === payoutId)) return true;
    const requested = b.requestedPayouts.find((p) => p.id === payoutId);
    if (!requested) throw conflict("Payment is not in this batch.");
    const actor = await controller(tx, b);
    const check = await prepareRelease(tx, actor, payoutId, "sponsor", { batchId: b.id });
    if (check.kind !== "ready" || batchQuoteKey(check.p) !== requested.quote) throw conflict("An authorized quote changed. Cancel the batch and review current payment details.");
    let [packetRow] = await tx.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.payoutId, payoutId));
    if (!packetRow) {
      const made = await sponsorCreate(tx, actor, { payoutId }, b.id);
      [packetRow] = await tx.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.id, String(made.data?.id)));
    }
    if (packetRow.status !== "draft") throw conflict(`Packet ${packetRow.id} is ${packetRow.status}.`);
    const [activePortal] = await tx.select({ id: s.portalRun.id }).from(s.portalRun).where(and(eq(s.portalRun.packetId, packetRow.id), inArray(s.portalRun.status, [...s.PORTAL_RUN_ACTIVE])));
    if (activePortal) throw conflict("An individual portal run is already handling this payment. Cancel the batch and wait for that run.");
    const item = await loadPortalPacket(t.orgId, packetRow.id, tx, { includeDocuments: false });
    await tx.update(table).set({ evidence: [...b.evidence, { payoutId, packetId: packetRow.id, terms: termsKey(check.p), packet: item.packet }], updatedAt: new Date() }).where(eq(table.id, b.id));
    return true;
  });
}

/** Each item commits its own checkpoint; retrying a chunk skips completed items. */
export async function prepareBatchItems(t: BatchTarget, payoutIds: string[]): Promise<boolean> {
  for (const id of payoutIds) if (!await prepareBatchItem(t, id)) return false;
  return true;
}

export async function prepareBatchBundle(t: BatchTarget): Promise<boolean> {
  const b = await load(t);
  if (b.status === "cancelled") return false;
  if (b.documentId) return true;
  if (!b.evidence.length || b.evidence.length !== b.requestedPayouts.length) throw conflict("Batch preparation is incomplete.");
  const loaded = await loadPortalPackets(t.orgId, b.evidence.map((e) => e.packetId));
  loaded.forEach((item, i) => { if (canonical(item.packet) !== canonical(b.evidence[i].packet)) throw conflict("A prepared packet changed. Cancel and release a new batch."); });
  const bundle = buildBatchBundle(t.batchId, loaded);
  await getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const current = await load(t, tx);
    if (current.status === "cancelled" || current.documentId) return;
    const document = await storeDocument(tx, { orgId: t.orgId, uploadedBy: b.approvedBy, kind: "sponsor_packet", name: `${t.batchId}.zip`, mimeType: "application/zip", bytes: bundle.bytes });
    await tx.update(table).set({ manifest: bundle.manifest, manifestHash: bundle.manifestHash, documentId: document.id, updatedAt: new Date() }).where(eq(table.id, t.batchId));
    await log(t, `Prepared ${loaded.length} packets in one bundle. Starting one portal task.`, "running", undefined, tx);
  });
  return true;
}

async function launch(target: BatchTarget): Promise<Result> {
  try {
    const { disbursementWorkflow } = await import("@/workflows/disbursement");
    const run = await start(disbursementWorkflow, [target, { batchPreparation: true }]);
    // The workflow claims workflowRunId at boot; do not overwrite a worker's final state here.
    return { ok: true, status: 202, message: "Batch released. Eve is uploading one bundle to the sponsor portal.", data: { batchId: target.batchId, runId: run.runId } };
  } catch {
    await getDb().update(table).set({ status: "failed", error: "The portal task could not start. Retry this batch.", updatedAt: new Date() })
      .where(and(eq(table.id, target.batchId), eq(table.status, "preparing")));
    return { ok: false, status: 503, message: "Batch saved, but the portal task could not start. Open Disburse and retry this batch.", data: { batchId: target.batchId } };
  }
}

export async function retryBatch(actor: ActorContext, id: string): Promise<Result> {
  if (actor.role !== "controller") return { ok: false, status: 403, message: "Only a controller can retry a batch." };
  const target = { orgId: actor.orgId, batchId: id };
  try {
    await getDb().transaction(async (tx) => {
      await lockOrgFinance(tx, actor.orgId);
      const b = await load(target, tx);
      if (b.status !== "failed" || (b.state as unknown as State | null)?.submissionAuthorized || b.confirmation) throw conflict("This batch may have reached the sponsor. Check its confirmation before any new submission.");
      if (actor.memberId !== b.approvedBy) throw forbidden("The controller who released this batch must retry it.");
      if (b.evidence.length === b.requestedPayouts.length) await checkBatch(tx, await controller(tx, b), b);
      await tx.update(table).set({ status: "preparing", workflowRunId: null, error: null, state: null }).where(eq(table.id, id));
    });
    return await launch(target);
  } catch (error) { return { ok: false, status: error instanceof ActionError ? error.status : 409, message: message(error) }; }
}

export async function cancelBatch(actor: ActorContext, id: string): Promise<Result> {
  if (actor.role !== "controller") return { ok: false, status: 403, message: "Only a controller can cancel a batch." };
  const target = { orgId: actor.orgId, batchId: id };
  try {
    await getDb().transaction(async (tx) => {
      await lockOrgFinance(tx, actor.orgId);
      const b = await load(target, tx);
      if (!["failed", "preparing", "filling"].includes(b.status) || (b.state as unknown as State | null)?.submissionAuthorized || b.confirmation) throw conflict("Submission may have started. Check with the sponsor before releasing these payments again.");
      await tx.update(table).set({ status: "cancelled", streamUrl: null, updatedAt: new Date() }).where(eq(table.id, id));
      await tx.delete(s.disbursementBatchItem).where(eq(s.disbursementBatchItem.batchId, id));
      await log(target, `${actor.name} cancelled this batch before submission. Its payouts can be released again.`, "done", undefined, tx);
    });
    return { ok: true, status: 200, message: "Batch cancelled. Its payouts are ready for a new release." };
  } catch (error) { return { ok: false, status: error instanceof ActionError ? error.status : 409, message: message(error) }; }
}

export async function bootBatch(t: BatchTarget, workflowRunId: string): Promise<string | null> {
  const b = await getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const current = await load(t, tx);
    if (current.workflowRunId && current.workflowRunId !== workflowRunId) return null;
    // A durable boot-step replay resumes its saved desktop instead of abandoning the batch.
    if (current.status === "filling" && current.workflowRunId === workflowRunId && current.state && current.sandboxId) return current;
    if (current.status !== "preparing" && !(current.status === "filling" && current.workflowRunId === workflowRunId)) return null;
    if (!current.documentId) throw conflict("The batch bundle is not ready.");
    await tx.update(table).set({ workflowRunId, status: "filling" }).where(eq(table.id, t.batchId));
    return current;
  });
  if (!b) return null;
  if (b.state && b.sandboxId) return b.sandboxId;
  if (b.sandboxId) await Sandbox.kill(b.sandboxId).catch(() => false);
  const [doc] = await getDb().select().from(s.document).where(and(eq(s.document.id, b.documentId!), eq(s.document.orgId, t.orgId)));
  if (!doc) throw new Error("Batch bundle is missing.");
  const computer = await bootComputer({ strictSsn: false, bulk: true, password: portalPassword(t.batchId), documents: [{ path: BATCH_FILE, bytes: doc.bytes }], onCreated: (sandboxId) => save(t, { sandboxId }) });
  const shot = await capture(computer.desktop);
  const current = await load(t);
  if (current.status === "cancelled") { await computer.desktop.kill(); return null; }
  await save(t, { streamUrl: computer.streamUrl, state: { agent: newAgentState(batchBrief(b.manifest), shot) } as unknown as Record<string, unknown> });
  await log(t, `Opened one portal session for ${b.manifest.totals.count} payments. Uploading the bundle.`, "running");
  return computer.sandboxId;
}

export async function batchTurn(t: BatchTarget): Promise<"continue" | "review" | "submitted" | "stopped"> {
  const b = await load(t);
  if (b.status === "cancelled") return "stopped";
  if (b.status === "submitted") return "submitted";
  if (!b.state || !b.sandboxId) throw new Error("The batch desktop is unavailable.");
  const state = b.state as unknown as State;
  const desktop = await Sandbox.connect(b.sandboxId);
  const out = await runAgentTurn(desktop, state.agent, portalPassword(t.batchId));
  const doc = await storeDocument(getDb(), { orgId: t.orgId, uploadedBy: "agent", kind: "screenshot", name: `${t.batchId}-${b.turns + 1}.png`, mimeType: "image/png", bytes: Buffer.from(out.shot, "base64") });
  // A cancellation during a model turn remains cancelled; this only writes conversation evidence.
  await save(t, { state: state as unknown as Record<string, unknown>, turns: b.turns + 1, ...(out.confirmation ? { confirmation: out.confirmation.number } : {}) });
  await log(t, (out.notes[0] ?? "Checked the portal.").slice(0, 400), "running", doc.id);
  if (out.escalation) throw new Error(out.escalation.reason);
  if (out.confirmation) return "submitted";
  if (out.pageAfter === "review" && !state.agent.approved) return "review";
  return "continue";
}

/** Human authorization is already recorded. Code compares the whole import, then enables the final click. */
export async function authorizeBatch(t: BatchTarget): Promise<boolean> {
  const b = await load(t);
  if (b.status === "cancelled") return false;
  if (b.status === "submitting" && (b.state as unknown as State)?.submissionAuthorized) {
    await authorizePortalBatch(await Sandbox.connect(b.sandboxId!), t.batchId, b.manifestHash);
    return true;
  }
  const desktop = await Sandbox.connect(b.sandboxId!);
  const imported = (await portalImports(desktop))[t.batchId];
  if (!imported || !matchesBatchImport(imported, b.manifestHash, b.manifest)) throw new Error("The portal import differs from the approved batch. Nothing was submitted.");
  await getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const current = await load(t, tx);
    if (current.status !== "filling") throw conflict("This batch is no longer awaiting submission.");
    await checkBatch(tx, await controller(tx, current), current);
    const saved = current.state as unknown as State;
    saved.submissionAuthorized = true; saved.agent.approved = true;
    saved.agent.operatorNote = `The controller ${current.approvedByName} already released this exact batch. Eve compared every imported row and document fingerprint with that release and rechecked all payment policies. Click "Submit batch" once and report the confirmation.`;
    await tx.update(table).set({ status: "submitting", state: saved as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(table.id, t.batchId));
  });
  await authorizePortalBatch(desktop, t.batchId, b.manifestHash);
  await log(t, `All ${b.manifest.totals.count} imported payments match the controller's release. Submitting the batch once.`, "running");
  return true;
}

export async function finishBatch(t: BatchTarget): Promise<void> {
  const b = await load(t);
  if (b.status === "submitted") return;
  const records = await portalRecords(await Sandbox.connect(b.sandboxId!));
  const receipt = records.find((r) => matchesBatchImport(r, b.manifestHash, b.manifest));
  if (!receipt || typeof receipt.confirmation !== "string" || !(b.state as unknown as State)?.submissionAuthorized) throw new Error("The portal did not confirm this authorized batch. Check the sponsor before retrying.");
  // Preserve the external receipt even if local settlement checks fail.
  await save(t, { confirmation: receipt.confirmation });
  await getDb().transaction(async (tx) => {
    await lockOrgFinance(tx, t.orgId);
    const current = await load(t, tx);
    if (current.status === "submitted") return;
    const actor = await controller(tx, current);
    // The real submissions below already run every settlement gate atomically.
    // A second rolled-back submission pass here duplicates all journal writes.
    await checkBatchEvidence(tx, actor, current);
    for (const item of current.evidence) {
      const result = await sponsorSubmit(tx, actor, { id: item.packetId }, current.id);
      if (!result.ok) throw conflict(result.message);
      await tx.update(s.sponsorPacket).set({ reason: `Batch ${current.id} submitted by Eve. Controller: ${actor.name}. Portal confirmation ${receipt.confirmation}. Awaiting payment.` }).where(eq(s.sponsorPacket.id, item.packetId));
    }
    await tx.update(table).set({ status: "submitted", error: null, updatedAt: new Date() }).where(eq(table.id, t.batchId));
    await log(t, `The portal confirmed ${current.manifest.totals.count} payments: ${receipt.confirmation}. All packets are submitted; awaiting sponsor payment.`, "done", undefined, tx);
  });
}

export async function failBatch(t: BatchTarget, reason: string) {
  const b = await load(t);
  if (["submitted", "cancelled"].includes(b.status)) return;
  // Recover a lost model response from the portal's own records before deleting the desktop.
  if ((b.state as unknown as State | null)?.submissionAuthorized && b.sandboxId) {
    try { await finishBatch(t); return; } catch { /* Preserve the confirmation and reservations on uncertainty. */ }
  }
  const current = await load(t);
  const uncertain = (current.state as unknown as State | null)?.submissionAuthorized;
  const error = `${reason.slice(0, 350)} ${uncertain ? "Submission may have reached the sponsor. Check the batch confirmation before any new release." : "Nothing was submitted. Retry this batch, or cancel it to review the payouts."}`;
  const updated = await getDb().update(table).set({ status: "failed", error, updatedAt: new Date() })
    .where(and(eq(table.id, t.batchId), eq(table.orgId, t.orgId), inArray(table.status, ["preparing", "filling", "submitting", "failed"]))).returning({ id: table.id });
  if (updated.length) await log(t, error, "escalated");
}
export async function closeBatch(t: BatchTarget, sandboxId: string | null) {
  const b = await load(t).catch(() => null);
  const id = sandboxId ?? b?.sandboxId;
  if (id) await Sandbox.kill(id).catch(() => false);
  if (b) await save(t, { streamUrl: null });
}
export async function batchesFor(orgId: string, db: Executor = getDb()): Promise<DisbursementBatch[]> {
  // Never pull screenshot-bearing model conversations into the polling snapshot.
  const rows = await db.select({
    id: table.id, status: table.status, requestedPayouts: table.requestedPayouts, evidence: table.evidence,
    manifest: table.manifest, documentId: table.documentId, approvedByName: table.approvedByName, approvedBy: table.approvedBy,
    streamUrl: table.streamUrl, confirmation: table.confirmation, error: table.error, turns: table.turns, createdAt: table.createdAt,
    submissionAuthorized: sql<boolean>`coalesce((${table.state}->>'submissionAuthorized')::boolean, false)`,
  }).from(table).where(eq(table.orgId, orgId)).orderBy(desc(table.createdAt));
  return rows.map((b) => ({ id: b.id, status: b.status, payoutIds: b.requestedPayouts.map((e) => e.id), packetIds: b.evidence.map((e) => e.packetId),
    count: b.manifest.totals.count, grossMinor: String(b.manifest.totals.grossCents), withholdingMinor: String(b.manifest.totals.withheldCents), netMinor: String(b.manifest.totals.netCents),
    documentId: b.documentId ?? undefined, approvedByName: b.approvedByName, approvedBy: b.approvedBy, streamUrl: b.streamUrl ?? undefined, confirmation: b.confirmation ?? undefined,
    error: b.error ?? undefined, canRetry: b.status === "failed" && !b.submissionAuthorized && !b.confirmation,
    canCancel: ["preparing", "filling", "failed"].includes(b.status) && !b.submissionAuthorized && !b.confirmation,
    turns: b.turns, createdAt: b.createdAt.toISOString() }));
}
