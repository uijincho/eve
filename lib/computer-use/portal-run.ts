/**
 * Eve fills the sponsor's portal for one drafted packet. The durable workflow
 * (workflows/sponsor-portal.ts) calls the steps below; the actions route calls start, decide
 * and stop. Every turn becomes a decision_log row with its screenshot, so the run appears in
 * the agent feed like any other. Money moves only through sponsorSubmit, run as the approving
 * controller after the portal's own records confirm the submission.
 */
import { createHmac } from "node:crypto";

import { Sandbox } from "@e2b/desktop";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getHookByToken, resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import { demoModeEnabled, type ActorContext } from "@/lib/auth/session";
import type * as C from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { agentActor, currentProfile, loadOrgEvent, recordDecision, storeDocument, usd } from "@/lib/server/core";
import { assertNotBeneficiary } from "@/lib/server/payouts";

import { checkReviewPage, type ReviewCheck } from "./agent";
import { bootComputer, capture, currentPage, portalEvents } from "./computer";
import { samplePdf } from "./documents";
import { PAGE_LABELS, type PortalPage } from "./guards";
import { packetBrief, PORTAL_NAME, type PortalPacket } from "./packet";
import { PortalPacketError, toPortalPacket } from "./portal-packet";
import { approvalNote, newAgentState, runAgentTurn, type AgentState, type TurnOutcome } from "./turn";

export interface PortalTarget { orgId: string; portalRunId: string; packetId: string }
export interface PortalDecision { decision: "approve" | "reject"; memberId: string; reason?: string }
export type TurnResult = "continue" | "review" | "escalated" | "submitted" | "stopped" | "lost";
export type EndReason = "escalated" | "stopped" | "lost" | "budget" | "timeout";

type RunRow = typeof s.portalRun.$inferSelect;
interface RunState { agent: AgentState; lostTurns: number }

export const MAX_FILL_TURNS = 40;
export const MAX_SUBMIT_TURNS = 6;
/** How long a controller has to approve. Shorter than the sandbox lifetime set at boot. */
export const APPROVAL_WAIT = "25m";
const APPROVAL_WAIT_MS = 25 * 60_000;
const SANDBOX_HOLD_MS = 30 * 60_000;
const TOOL = "portalAgent";

export function portalToken(t: Pick<PortalTarget, "orgId" | "portalRunId">): string {
  return `portal-submit:${t.orgId}:${t.portalRunId}`;
}

/** The fictional portal's per-run password, derived so it is never stored and never shown to the model. Exported for leak checks. */
export function portalPassword(runId: string): string {
  const key = process.env.EVE_VAULT_KEY;
  if (!key) throw new Error("EVE_VAULT_KEY must be set to fill sponsor portals.");
  return createHmac("sha256", key).update(`portal-password:${runId}`).digest("base64url").slice(0, 20);
}

export function portalConfigured(): string | null {
  if (!process.env.E2B_API_KEY) return "Computer use is not set up: add E2B_API_KEY.";
  if (!process.env.ANTHROPIC_API_KEY) return "Computer use is not set up: add ANTHROPIC_API_KEY.";
  if (!process.env.EVE_VAULT_KEY) return "Computer use is not set up: add EVE_VAULT_KEY.";
  return null;
}

function short(message: string, max = 240): string {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

async function loadRun(id: string): Promise<RunRow> {
  const [row] = await getDb().select().from(s.portalRun).where(eq(s.portalRun.id, id));
  if (!row) throw new Error(`Portal run ${id} not found.`);
  return row;
}

async function saveRun(id: string, patch: Partial<typeof s.portalRun.$inferInsert>) {
  await getDb().update(s.portalRun).set({ ...patch, updatedAt: new Date() }).where(eq(s.portalRun.id, id));
}

// ----------------------------------------------------------------- packet

/** Reads a drafted packet and everything the portal needs, including the files to upload. */
export async function loadPortalPacket(orgId: string, packetId: string): Promise<{ packet: PortalPacket; documents: { path: string; bytes: Uint8Array }[]; person: typeof s.person.$inferSelect }> {
  const db = getDb();
  const [row] = await db.select({ pk: s.sponsorPacket, payout: s.payout, person: s.person }).from(s.sponsorPacket)
    .innerJoin(s.payout, eq(s.payout.id, s.sponsorPacket.payoutId))
    .innerJoin(s.person, eq(s.person.id, s.payout.personId))
    .where(and(eq(s.sponsorPacket.id, packetId), eq(s.sponsorPacket.orgId, orgId)));
  if (!row) throw new PortalPacketError("Packet not found.");
  const { org, event } = await loadOrgEvent(db, orgId);
  const profile = await currentProfile(db, row.person.id);
  const [award] = row.payout.awardId ? await db.select().from(s.award).where(eq(s.award.id, row.payout.awardId)) : [];
  const [claim] = row.payout.claimId ? await db.select().from(s.claim).where(eq(s.claim.id, row.payout.claimId)) : [];
  const packet = toPortalPacket({
    packetId: row.pk.id,
    sponsorName: org.sponsorName,
    eventName: event.name,
    person: { name: row.person.name, email: row.person.email, country: row.person.country },
    taxForm: profile?.form ?? null,
    signedAt: profile?.signedAt ? profile.signedAt.toISOString() : null,
    payout: { currency: row.payout.currency, grossMinor: row.payout.grossMinor, withholdingMinor: row.payout.withholdingMinor, ruleId: row.payout.ruleId, ruleVersion: row.payout.ruleVersion, ruleVerified: row.payout.ruleVerified },
    requestedMinor: row.pk.requestedMinor,
    source: award ? { kind: "award", track: award.track, title: award.title } : { kind: "claim", type: claim?.type ?? "expense", category: claim?.category ?? "", description: claim?.description ?? "" },
  });

  const stored = async (id: string | null | undefined) => {
    if (!id) return null;
    const [doc] = await db.select({ bytes: s.document.bytes, mimeType: s.document.mimeType }).from(s.document).where(and(eq(s.document.id, id), eq(s.document.orgId, orgId)));
    return doc?.mimeType === "application/pdf" ? new Uint8Array(doc.bytes) : null;
  };
  const documents = [{
    path: packet.documents.supporting,
    bytes: (await stored(row.pk.documentId)) ?? await samplePdf(`Sponsor packet ${packet.id}`, [`Payee: ${packet.payee.name}`, `Net: USD ${(packet.netCents / 100).toFixed(2)}`]),
  }];
  if (packet.documents.taxForm) {
    documents.push({
      path: packet.documents.taxForm,
      bytes: (await stored(profile?.documentId)) ?? await samplePdf(`Form ${profile?.form ?? "W-8BEN"} on file with Eve`, [
        `Name: ${row.person.name}`, `Country: ${packet.payee.country}`, `Form: ${profile?.form ?? "W-8BEN"}`,
        `Signed: ${profile?.signedAt ? profile.signedAt.toISOString().slice(0, 10) : "on file"}`, "Identifying numbers are vaulted in Eve and not printed here.",
      ]),
    });
  }
  return { packet, documents, person: row.person };
}

// ---------------------------------------------------------------- actions

type Result = C.ActionResult & { status: number };

/** Organizer or controller asks Eve to fill the portal for a drafted packet. */
export async function startPortalRun(actor: ActorContext, packetId: string): Promise<Result> {
  if (actor.role !== "organizer" && actor.role !== "controller") return { ok: false, status: 403, message: "Only an organizer or controller can have Eve fill the sponsor portal." };
  const missing = portalConfigured();
  if (missing) return { ok: false, status: 503, message: missing };
  const db = getDb();
  const [pk] = await db.select().from(s.sponsorPacket).where(and(eq(s.sponsorPacket.id, packetId), eq(s.sponsorPacket.orgId, actor.orgId)));
  if (!pk) return { ok: false, status: 404, message: "Packet not found." };
  if (pk.status !== "draft") return { ok: false, status: 409, message: `Packet is ${pk.status}; only a draft packet can be entered on the portal.` };
  let person: typeof s.person.$inferSelect;
  try { ({ person } = await loadPortalPacket(actor.orgId, packetId)); }
  catch (error) { if (error instanceof PortalPacketError) return { ok: false, status: 409, message: error.message }; throw error; }
  try { assertNotBeneficiary(actor, person, "prepare"); }
  catch (error) { return { ok: false, status: 403, message: (error as Error).message }; }

  const id = newId("prn");
  try {
    // Serialize reservation with sponsorSubmit's packet lock. A manual submission
    // that won the race must not also get a new desktop and a second portal request.
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.sponsorPacket)
        .where(and(eq(s.sponsorPacket.id, packetId), eq(s.sponsorPacket.orgId, actor.orgId))).for("update");
      if (!current || current.status !== "draft") throw new PortalPacketError("The packet is no longer a draft. Refresh to see its status.");
      await tx.insert(s.portalRun).values({ id, orgId: actor.orgId, packetId, requestedBy: actor.memberId, status: "starting" });
    });
  } catch (error) {
    if (error instanceof PortalPacketError) return { ok: false, status: 409, message: error.message };
    if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") {
      return { ok: false, status: 409, message: "Eve is already working on the portal for this packet." };
    }
    throw error;
  }
  let run: { runId: string };
  try {
    const { sponsorPortalWorkflow } = await import("@/workflows/sponsor-portal");
    run = await start(sponsorPortalWorkflow, [{ orgId: actor.orgId, portalRunId: id, packetId }]);
  } catch {
    // A service can accept the start before its response is lost. Cancel that
    // possible late worker as well as releasing the reservation for a retry.
    await saveRun(id, { status: "failed", stopRequested: true, error: "The background service could not start the portal run. Try starting a new run." });
    return { ok: false, status: 503, message: "The background service could not start the portal run. Try again shortly." };
  }
  await saveRun(id, { workflowRunId: run.runId });
  await recordDecision(db, {
    orgId: actor.orgId, runId: run.runId, objectType: "packet", objectId: packetId, personId: person.id, personName: person.name,
    action: "portal.start", actor, status: "running", tool: TOOL,
    summary: `${actor.name} asked Eve to enter packet ${packetId} on the sponsor's portal (${PORTAL_NAME}). Eve will stop before the final Submit.`,
    facts: { portalRunId: id },
  });
  return { ok: true, status: 202, message: "Eve is opening the portal on a locked-down desktop. Watch it in Agent activity.", data: { portalRunId: id, runId: run.runId } };
}

/** The controller's answer at the Review page. Resumes the workflow; it never submits anything itself. */
export async function decidePortalRun(actor: ActorContext, portalRunId: string, decision: PortalDecision["decision"], reason?: string): Promise<Result> {
  if (actor.role !== "controller") return { ok: false, status: 403, message: "Only a controller can approve a portal submission: submitting releases money through the sponsor." };
  const db = getDb();
  const [run] = await db.select().from(s.portalRun).where(and(eq(s.portalRun.id, portalRunId), eq(s.portalRun.orgId, actor.orgId)));
  if (!run) return { ok: false, status: 404, message: "Portal run not found." };
  if (run.status !== "awaiting_approval") return { ok: false, status: 409, message: `Nothing to decide: the run is ${run.status.replace("_", " ")}.` };
  if (decision === "approve") {
    const [row] = await db.select({ person: s.person }).from(s.sponsorPacket)
      .innerJoin(s.payout, eq(s.payout.id, s.sponsorPacket.payoutId)).innerJoin(s.person, eq(s.person.id, s.payout.personId))
      .where(eq(s.sponsorPacket.id, run.packetId));
    try { assertNotBeneficiary(actor, row.person, "approve"); }
    catch (error) { return { ok: false, status: 403, message: (error as Error).message }; }
  }
  try {
    await resumeHook(portalToken({ orgId: actor.orgId, portalRunId }), { decision, memberId: actor.memberId, reason } satisfies PortalDecision);
  } catch (error) {
    if (HookNotFoundError.is(error)) return { ok: false, status: 409, message: "The portal run is no longer waiting for a decision. Refresh to see its status." };
    throw error;
  }
  return { ok: true, status: 202, message: decision === "approve" ? "Approved. Eve will press Submit once and record the confirmation." : "Rejected. Nothing will be submitted." };
}

/** Stops a run: rejects it if it is waiting on Review, otherwise ends it after the current turn. */
export async function stopPortalRun(actor: ActorContext, portalRunId: string): Promise<Result> {
  if (actor.role !== "organizer" && actor.role !== "controller") return { ok: false, status: 403, message: "Only an organizer or controller can stop a portal run." };
  const db = getDb();
  const [run] = await db.select().from(s.portalRun).where(and(eq(s.portalRun.id, portalRunId), eq(s.portalRun.orgId, actor.orgId)));
  if (!run) return { ok: false, status: 404, message: "Portal run not found." };
  if (!(s.PORTAL_RUN_ACTIVE as readonly string[]).includes(run.status)) return { ok: false, status: 409, message: `The run already ended (${run.status}).` };
  await saveRun(run.id, { stopRequested: true });
  // Deliver the rejection even while filling: holdForApproval may be reading the
  // screenshot right now and enter its wait after this request reads the row.
  if (run.status !== "submitting") {
    try { await resumeHook(portalToken({ orgId: run.orgId, portalRunId: run.id }), { decision: "reject", memberId: actor.memberId, reason: `Stopped by ${actor.name}` } satisfies PortalDecision); }
    catch (error) { if (!HookNotFoundError.is(error)) throw error; }
  }
  return { ok: true, status: 202, message: run.status === "submitting"
    ? "Stopping after the current turn. An approved submission may already have reached the portal; check the confirmation before starting again."
    : "Stopping. Eve finishes the current turn, then deletes the desktop. Nothing is submitted." };
}

/** True while a workflow is registered for the run, so the UI can tell a stuck run from a live one. */
export async function portalRunLive(run: Pick<RunRow, "orgId" | "id">): Promise<boolean> {
  try { await getHookByToken(portalToken({ orgId: run.orgId, portalRunId: run.id })); return true; }
  catch (error) { if (HookNotFoundError.is(error)) return false; throw error; }
}

// ------------------------------------------------------------------ steps

async function record(target: PortalTarget, runId: string, d: { action: string; summary: string; status: C.Decision["status"]; facts?: Record<string, unknown>; checks?: C.Check[]; documentId?: string | null; nextActionAt?: Date }) {
  const [owner] = await getDb().select({ id: s.person.id, name: s.person.name }).from(s.sponsorPacket)
    .innerJoin(s.payout, eq(s.payout.id, s.sponsorPacket.payoutId)).innerJoin(s.person, eq(s.person.id, s.payout.personId))
    .where(eq(s.sponsorPacket.id, target.packetId));
  await recordDecision(getDb(), {
    orgId: target.orgId, runId, objectType: "packet", objectId: target.packetId, personId: owner?.id, personName: owner?.name,
    actor: agentActor(target.orgId), tool: TOOL, ...d, facts: { portalRunId: target.portalRunId, ...d.facts },
  });
}

async function saveShot(target: PortalTarget, shot: string, label: string): Promise<string> {
  const doc = await storeDocument(getDb(), { orgId: target.orgId, uploadedBy: "agent", kind: "screenshot", name: `${target.portalRunId}-${label}.png`, mimeType: "image/png", bytes: Buffer.from(shot, "base64") });
  return doc.id;
}

function state(row: RunRow): RunState {
  if (!row.state) throw new Error("The portal run has no saved conversation.");
  return row.state as unknown as RunState;
}

async function desktopFor(row: RunRow): Promise<Sandbox> {
  if (!row.sandboxId) throw new Error("The portal run has no desktop.");
  return Sandbox.connect(row.sandboxId);
}

/**
 * Step: create the locked-down desktop, open the portal, and save the first screen. Returns the
 * sandbox id so the workflow can always delete it, even if this run's rows are gone by then.
 */
export async function bootPortalRun(target: PortalTarget, runId: string): Promise<{ started: boolean; sandboxId: string | null }> {
  const row = await loadRun(target.portalRunId);
  if (row.stopRequested) return { started: false, sandboxId: null };
  // A retried boot must not leave the first attempt's desktop running.
  if (row.sandboxId) await Sandbox.kill(row.sandboxId).catch(() => false);
  const { packet, documents } = await loadPortalPacket(target.orgId, target.packetId);
  const computer = await bootComputer({
    strictSsn: false,
    password: portalPassword(target.portalRunId),
    documents,
    onCreated: (sandboxId) => saveRun(target.portalRunId, { sandboxId }),
  });
  const { page } = await currentPage(computer.desktop);
  const shot = await capture(computer.desktop);
  const agent = newAgentState(packetBrief(packet), shot);
  agent.seenEvents = (await portalEvents(computer.desktop)).length;
  await saveRun(target.portalRunId, {
    status: "filling", sandboxId: computer.sandboxId, streamUrl: computer.streamUrl, page, pagesVisited: page === "other" ? [] : [page],
    state: { agent, lostTurns: 0 } satisfies RunState as unknown as Record<string, unknown>,
  });
  await record(target, runId, {
    action: "portal.open", status: "running", documentId: await saveShot(target, shot, "open"),
    summary: `Opened the portal on a desktop with no internet; Chrome is locked to the portal. Entering ${packet.payee.name}, ${usd(BigInt(packet.netCents))} net, account ${packet.accountCode.split(" ")[0]}.`,
    facts: { sandboxId: computer.sandboxId, offline: computer.offline },
  });
  return { started: true, sandboxId: computer.sandboxId };
}

function turnSummary(out: TurnOutcome): string {
  const blocked = out.actions.find((a) => a.outcome === "blocked");
  const said = out.portalSaid.filter((e) => e.type === "error").map((e) => e.detail);
  const lead = out.notes[0] ?? out.actions.find((a) => a.name !== "screenshot" && a.name !== "wait")?.summary ?? "Looked at the screen.";
  return short([
    lead,
    blocked ? `Blocked by Eve: ${blocked.summary}.` : "",
    said.length ? `Portal said: “${said.join(" ")}”` : "",
  ].filter(Boolean).join(" "), 400);
}

/** Step: one Claude turn on the portal. Everything it did is saved before the step returns. */
export async function portalTurn(target: PortalTarget, runId: string): Promise<TurnResult> {
  const row = await loadRun(target.portalRunId);
  if (row.stopRequested) return "stopped";
  const saved = state(row);
  const desktop = await desktopFor(row);
  const out = await runAgentTurn(desktop, saved.agent, portalPassword(target.portalRunId));
  const n = row.turns + 1;
  const page: PortalPage = out.pageAfter;
  const visited = [...row.pagesVisited];
  if (page !== "other" && visited.at(-1) !== page) visited.push(page);
  saved.lostTurns = page === "other" ? saved.lostTurns + 1 : 0;
  const documentId = await saveShot(target, out.shot, `turn-${n}`);
  await saveRun(target.portalRunId, {
    state: saved as unknown as Record<string, unknown>, page, pagesVisited: visited, turns: n,
    usage: {
      inputTokens: row.usage.inputTokens + out.usage.inputTokens,
      outputTokens: row.usage.outputTokens + out.usage.outputTokens,
      cacheReadTokens: row.usage.cacheReadTokens + out.usage.cacheReadTokens,
    },
    ...(out.escalation ? { escalation: out.escalation } : {}),
    ...(out.confirmation ? { confirmation: out.confirmation.number, portalRecord: out.confirmation.record } : {}),
  });
  await record(target, runId, {
    action: `portal.turn`, status: out.escalation ? "escalated" : "running", documentId,
    summary: out.escalation ? short(`Escalated to the controller: ${out.escalation.reason}`, 400) : turnSummary(out),
    facts: {
      turn: n, pageBefore: out.pageBefore, pageAfter: page, ms: out.ms, model: out.model,
      ...(out.fellBackFrom ? { fellBackFrom: out.fellBackFrom } : {}),
      actions: out.actions.map((a) => ({ summary: a.summary, outcome: a.outcome, ...(a.rule ? { rule: a.rule } : {}) })),
      portalErrors: out.portalSaid.filter((e) => e.type === "error").map((e) => e.detail),
      ...(out.escalation ? { portalField: out.escalation.field } : {}),
    },
  });
  if (out.escalation) return "escalated";
  if (out.confirmation) return "submitted";
  if (page === "review" && !saved.agent.approved) return "review";
  if (saved.lostTurns >= 3) return "lost";
  return "continue";
}

function reviewChecks(checks: ReviewCheck[]): C.Check[] {
  return checks.map((c) => ({
    code: `review.${c.label.toLowerCase().replace(/[^a-z]+/g, "_")}`,
    label: `${c.label} on the portal matches the packet`,
    passed: c.ok,
    detail: c.ok ? `Portal shows ${c.portal || "(blank)"}.` : `Portal shows ${c.portal || "(blank)"}; the packet says ${c.packet}.`,
  }));
}

/** Step: Eve is on Review. Read the page back, compare it with the packet, and ask a controller. */
export async function holdForApproval(target: PortalTarget, runId: string): Promise<void> {
  const row = await loadRun(target.portalRunId);
  const desktop = await desktopFor(row);
  const { packet } = await loadPortalPacket(target.orgId, target.packetId);
  const shot = await capture(desktop);
  const checks = await checkReviewPage(shot, packet).catch(() => null);
  // Keep the desktop alive for the whole approval window.
  await Sandbox.setTimeout(row.sandboxId!, SANDBOX_HOLD_MS).catch(() => {});
  await saveRun(target.portalRunId, { status: "awaiting_approval", reviewCheck: checks });
  const matched = checks ? checks.filter((c) => c.ok).length : 0;
  await record(target, runId, {
    action: "portal.review", status: "waiting", documentId: await saveShot(target, shot, "review"),
    checks: checks ? reviewChecks(checks) : undefined,
    nextActionAt: new Date(Date.now() + APPROVAL_WAIT_MS),
    summary: checks
      ? `Stopped on the portal's Review page before Submit. ${matched} of ${checks.length} values match the packet. Waiting for a controller to approve.`
      : "Stopped on the portal's Review page before Submit. Eve could not read the page back; check the screenshot before approving.",
  });
}

/** Step: apply the controller's answer. Returns true when Eve may press Submit. */
export async function applyDecision(target: PortalTarget, runId: string, answer: PortalDecision): Promise<boolean> {
  const db = getDb();
  const row = await loadRun(target.portalRunId);
  const [member] = await db.select().from(s.orgMember).where(and(eq(s.orgMember.id, answer.memberId), eq(s.orgMember.orgId, target.orgId)));
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, target.orgId));
  const approve = answer.decision === "approve" && !row.stopRequested;
  if (approve && (!member || member.role !== "controller" || (member.demoPersona && (!org?.isDemo || !demoModeEnabled())))) {
    await saveRun(target.portalRunId, { status: "rejected", error: "The approver no longer has controller access." });
    await record(target, runId, { action: "portal.rejected", status: "escalated", summary: "The approval was refused: the approver no longer has controller access. Nothing was submitted." });
    return false;
  }
  if (!approve) {
    const by = member?.name ?? "a controller";
    await saveRun(target.portalRunId, { status: row.stopRequested ? "stopped" : "rejected" });
    await record(target, runId, { action: "portal.rejected", status: "done", summary: `${answer.reason ?? `Rejected by ${by}`}. Nothing was submitted to the portal.` });
    return false;
  }
  const at = new Date();
  const saved = state(row);
  saved.agent.approved = true;
  saved.agent.operatorNote = approvalNote(member!.name, at.toISOString());
  await saveRun(target.portalRunId, { status: "submitting", approvedBy: member!.id, approvedByName: member!.name, approvedAt: at, state: saved as unknown as Record<string, unknown> });
  await record(target, runId, { action: "portal.approved", status: "running", summary: `${member!.name} approved the Review page as shown. Eve may press Submit once.`, facts: { approverId: member!.id } });
  return true;
}

/**
 * Step: the portal confirmed the request. Release it in Eve as the approving controller, through
 * the same sponsor.submit path as the manual button, then record the confirmation on the packet.
 */
export async function completePortalRun(target: PortalTarget, runId: string): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const row = await loadRun(target.portalRunId);
  const [member] = await db.select().from(s.orgMember).where(and(eq(s.orgMember.id, row.approvedBy ?? ""), eq(s.orgMember.orgId, target.orgId)));
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, target.orgId));
  const [pk] = await db.select().from(s.sponsorPacket).where(eq(s.sponsorPacket.id, target.packetId));
  const record_ = row.portalRecord ?? {};
  const fail = async (why: string) => {
    const message = `The portal accepted request ${row.confirmation}, but Eve did not mark packet ${target.packetId} submitted: ${why} Ask the sponsor to withdraw request ${row.confirmation}, or submit the packet by hand.`;
    await saveRun(target.portalRunId, { status: "failed", error: short(message, 500) });
    await record(target, runId, { action: "portal.unreconciled", status: "escalated", summary: short(message, 500), facts: { confirmation: row.confirmation } });
    return { ok: false, message };
  };
  if (!member || !org) return fail("the approving controller could not be found.");
  if (!pk || record_.netCents !== Number(pk.requestedMinor)) return fail(`the portal recorded ${typeof record_.netCents === "number" ? usd(BigInt(record_.netCents)) : "no amount"}, not the packet's ${pk ? usd(pk.requestedMinor) : "amount"}.`);
  const actor: ActorContext = {
    memberId: member.id, orgId: member.orgId, role: member.role, name: member.name, email: member.email,
    personId: member.personId, userId: member.userId, demo: member.demoPersona && org.isDemo,
  };
  // Leave the active states first: sponsor.submit refuses a packet that a live portal run owns.
  await saveRun(target.portalRunId, { status: "submitted" });
  const { runAuthorizedAction } = await import("@/lib/server/services");
  const result = await runAuthorizedAction(actor, "sponsor.submit", { id: target.packetId });
  if (!result.ok) return fail(result.message);
  await db.update(s.sponsorPacket).set({ reason: `Entered on the sponsor portal by Eve and approved by ${member.name}. Portal confirmation ${row.confirmation}.` }).where(eq(s.sponsorPacket.id, target.packetId));
  await record(target, runId, {
    action: "portal.submitted", status: "done",
    summary: `The portal accepted the request: confirmation ${row.confirmation}, read from the portal's own records. Packet marked submitted as ${member.name}; expense and withholding accrued.`,
    facts: { confirmation: row.confirmation },
  });
  try {
    const { startPendingApprovals } = await import("@/lib/agent/triggers");
    await startPendingApprovals(target.orgId);
  } catch { console.warn("[workflow] Follow-up approvals will be started by the scheduled sweep."); }
  return { ok: true, message: "Submitted." };
}

const END_COPY: Record<EndReason, { status: RunRow["status"]; decision: C.Decision["status"]; summary: string }> = {
  escalated: { status: "escalated", decision: "escalated", summary: "Eve stopped and asked the controller to decide. Nothing was submitted; the desktop was deleted." },
  stopped: { status: "stopped", decision: "done", summary: "Stopped on request. Nothing was submitted; the desktop was deleted." },
  lost: { status: "failed", decision: "escalated", summary: "The portal window disappeared for three turns, so Eve stopped. Nothing was submitted. Start a new run." },
  budget: { status: "failed", decision: "escalated", summary: "Eve used its turn budget without reaching the end of the form, so it stopped. Nothing was submitted. Start a new run." },
  timeout: { status: "failed", decision: "escalated", summary: "No controller decided within 25 minutes, so Eve deleted the desktop. Nothing was submitted. Start a new run when a controller is available." },
};

/** Step: record why the run ended without a submission. */
export async function endPortalRun(target: PortalTarget, runId: string, reason: EndReason): Promise<void> {
  const row = await loadRun(target.portalRunId);
  const copy = END_COPY[reason];
  const why = reason === "escalated" && row.escalation ? ` Portal field: ${row.escalation.field}.` : "";
  await saveRun(target.portalRunId, { status: copy.status, ...(copy.status === "failed" ? { error: copy.summary } : {}) });
  await record(target, runId, { action: `portal.${reason}`, status: copy.decision, summary: `${copy.summary}${why}` });
}

/** Step: unexpected failure. The message is ours or the SDK's, trimmed; no secrets pass through here. */
export async function failPortalRun(target: PortalTarget, runId: string, message: string): Promise<void> {
  const summary = short(`Eve stopped filling the portal: ${message} Nothing was submitted.`, 400);
  await saveRun(target.portalRunId, { status: "failed", error: summary });
  await record(target, runId, { action: "portal.failed", status: "escalated", summary });
}

/**
 * Step: always runs last. Deletes the desktop and clears the live view. Works without the run's
 * row (a demo reset or purge may have deleted it), using the id the boot step returned.
 */
export async function closePortalDesktop(target: PortalTarget, sandboxId: string | null): Promise<void> {
  const [row] = await getDb().select({ sandboxId: s.portalRun.sandboxId }).from(s.portalRun).where(eq(s.portalRun.id, target.portalRunId));
  const id = sandboxId ?? row?.sandboxId ?? null;
  // false means it is already gone; an error leaves it to expire at its 30-minute timeout.
  if (id) await Sandbox.kill(id).catch(() => { console.warn(`[portal] Desktop ${id} could not be deleted; it expires on its own.`); });
  if (row) await saveRun(target.portalRunId, { streamUrl: null });
}

// --------------------------------------------------------------- snapshot

/** Staff view of portal runs: no conversation, screenshots or desktop ids. */
export async function portalRunsFor(orgId: string): Promise<C.PortalRun[]> {
  const rows = await getDb().select({
    id: s.portalRun.id, packetId: s.portalRun.packetId, workflowRunId: s.portalRun.workflowRunId, status: s.portalRun.status,
    page: s.portalRun.page, pagesVisited: s.portalRun.pagesVisited, turns: s.portalRun.turns, streamUrl: s.portalRun.streamUrl,
    reviewCheck: s.portalRun.reviewCheck, escalation: s.portalRun.escalation, confirmation: s.portalRun.confirmation,
    approvedByName: s.portalRun.approvedByName, approvedAt: s.portalRun.approvedAt, error: s.portalRun.error,
    requestedBy: s.portalRun.requestedBy, createdAt: s.portalRun.createdAt, updatedAt: s.portalRun.updatedAt,
  }).from(s.portalRun).where(eq(s.portalRun.orgId, orgId)).orderBy(desc(s.portalRun.createdAt)).limit(50);
  return rows.map((r) => ({
    id: r.id, packetId: r.packetId, workflowRunId: r.workflowRunId ?? undefined, status: r.status,
    page: r.page, pageLabel: PAGE_LABELS[(r.page in PAGE_LABELS ? r.page : "other") as PortalPage], pagesVisited: r.pagesVisited, turns: r.turns,
    streamUrl: (s.PORTAL_RUN_ACTIVE as readonly string[]).includes(r.status) ? r.streamUrl ?? undefined : undefined,
    reviewCheck: r.reviewCheck ?? undefined, escalation: r.escalation ?? undefined, confirmation: r.confirmation ?? undefined,
    approvedByName: r.approvedByName ?? undefined, approvedAt: r.approvedAt?.toISOString(), error: r.error ?? undefined,
    requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Active runs for a packet set, for guards elsewhere (e.g. the manual submit button). */
export async function activePortalRuns(orgId: string, packetIds: string[]) {
  if (!packetIds.length) return [];
  return getDb().select({ id: s.portalRun.id, packetId: s.portalRun.packetId }).from(s.portalRun)
    .where(and(eq(s.portalRun.orgId, orgId), inArray(s.portalRun.packetId, packetIds), inArray(s.portalRun.status, [...s.PORTAL_RUN_ACTIVE])));
}
