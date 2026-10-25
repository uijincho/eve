import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { demoModeEnabled, type ActorContext } from "@/lib/auth/session";
import { getDb, type Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { ActionError, agentActor, recordDecision } from "@/lib/server/core";
import { processClaim } from "@/lib/server/claims";
import { proposePayout } from "@/lib/server/payouts";
import { generateFilings, runAuthorizedAction } from "@/lib/server/services";
import { computeScoreboard, saveScoreboard } from "@/lib/server/scoreboard";

export interface AgentTarget {
  orgId: string;
  generation: string;
  memberId: string | null;
  kind: "claims" | "chase" | "all" | "awards";
  evaluateDemo: boolean;
  filingYear?: number;
  awardIds?: string[];
  triggerId?: string;
}
export interface OperationResult { processed: number; proposed: number; blocked: number }

/** A reset replaces the organization generation, so old workflows cannot act on fresh demo rows. */
export async function currentGeneration(db: Executor, target: AgentTarget): Promise<boolean> {
  const [org] = await db.select({ createdAt: s.organization.createdAt }).from(s.organization).where(eq(s.organization.id, target.orgId));
  return org?.createdAt.toISOString() === target.generation;
}

async function initiatingActor(db: Executor, target: AgentTarget): Promise<ActorContext | null> {
  if (!target.memberId) return agentActor(target.orgId); // Internal cron only; never accepted from a request body.
  const [member] = await db.select().from(s.orgMember).where(and(eq(s.orgMember.orgId, target.orgId), eq(s.orgMember.id, target.memberId)));
  if (!member || !["organizer", "controller"].includes(member.role)) return null;
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, target.orgId));
  if (!org || (member.demoPersona && (!org.isDemo || !demoModeEnabled()))) return null;
  return { memberId: member.id, orgId: target.orgId, userId: member.userId, personId: member.personId, name: member.name, email: member.email, role: member.role, demo: member.demoPersona && org.isDemo };
}

export async function beginAgentRun(target: AgentTarget, runId: string) {
  const db = getDb();
  if (!await currentGeneration(db, target)) return null;
  const actor = await initiatingActor(db, target);
  if (!actor) return null;
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, target.orgId));
  if (target.evaluateDemo && (!org?.isDemo || !demoModeEnabled() || !actor.demo)) return null;
  await db.insert(s.agentRun).values({ id: runId, orgId: target.orgId, kind: target.kind, triggeredBy: actor.name, status: "running" }).onConflictDoNothing();
  const claims = target.kind === "chase" || target.kind === "awards" ? [] : await db.select({ id: s.claim.id }).from(s.claim)
    .where(and(eq(s.claim.orgId, target.orgId), inArray(s.claim.status, ["submitted", "processing"])));
  const awards = target.kind === "chase" ? [] : await db.select({ id: s.award.id }).from(s.award)
    .where(and(eq(s.award.orgId, target.orgId), target.awardIds ? inArray(s.award.id, target.awardIds) : undefined, inArray(s.award.status, ["ready", "needs_form"]), sql`(${s.award.kind} = 'cash' OR ${s.award.fulfillment} = 'cash')`));
  return { claimIds: claims.map((c) => c.id), awardIds: awards.map((a) => a.id) };
}

/** One business object per transaction/step. A failed item never rolls back unrelated approvals. */
export async function evaluateAgentObject(target: AgentTarget, runId: string, type: "claim" | "award", id: string): Promise<OperationResult> {
  const db = getDb();
  const empty = { processed: 0, proposed: 0, blocked: 0 };
  if (!await currentGeneration(db, target)) return empty;
  try {
    return await db.transaction(async (tx) => {
      // Same lock order as financial mutations. Also excludes reset during the transaction.
      const [org] = await tx.select({ createdAt: s.organization.createdAt }).from(s.organization).where(eq(s.organization.id, target.orgId)).for("no key update");
      if (org?.createdAt.toISOString() !== target.generation) return empty;
      const actor = agentActor(target.orgId);
      if (type === "claim") {
        const row = await processClaim(tx, actor, id, `${runId}:claim:${id}`);
        return { ...empty, processed: 1, blocked: row.status === "escalated" || row.status === "needs_info" ? 1 : 0 };
      }
      const [award] = await tx.select().from(s.award).where(and(eq(s.award.id, id), eq(s.award.orgId, target.orgId)));
      if (!award || !["ready", "needs_form"].includes(award.status) || (award.kind === "item" && award.fulfillment !== "cash")) return empty;
      const [live] = await tx.select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.orgId, target.orgId), eq(s.payout.awardId, id), sql`${s.payout.status} NOT IN ('failed', 'returned')`));
      if (live) return empty;
      if (award.teamId) {
        const team = await tx.select({ confirmed: s.award.splitConfirmed }).from(s.award).where(and(eq(s.award.orgId, target.orgId), eq(s.award.teamId, award.teamId)));
        if (team.some((a) => !a.confirmed)) return { ...empty, blocked: 1 };
      }
      const payout = await proposePayout(tx, actor, { sourceType: "award", sourceId: id });
      return { ...empty, proposed: 1, blocked: payout.status === "held" || payout.status === "frozen" ? 1 : 0 };
    });
  } catch (error) {
    // Persist only known policy messages. Provider/DB failures retry without private error text.
    if (!(error instanceof ActionError)) throw new Error("The operation could not complete; it will retry safely.");
    const key = createHash("sha256").update(`${runId}:${type}:${id}:blocked`).digest("hex").slice(0, 32);
    await db.insert(s.decisionLog).values({ id: `dec_${key}`, orgId: target.orgId, runId: `${runId}:${type}:${id}`, objectType: type, objectId: id, action: "Agent review needs a person", summary: error.message, actor: "Eve (agent)", actorRole: "agent", status: "escalated", tool: type === "claim" ? "checkClaim" : "planPayout" }).onConflictDoNothing();
    return { ...empty, blocked: 1 };
  }
}

export async function finishAgentRun(target: AgentTarget, runId: string, totals: OperationResult & { chased: number; waiting: number }) {
  const db = getDb();
  if (!await currentGeneration(db, target)) return { superseded: true };
  const actor = await initiatingActor(db, target);
  if (target.evaluateDemo && actor?.demo) {
    const packets = await db.select({ id: s.sponsorPacket.id }).from(s.sponsorPacket).where(and(eq(s.sponsorPacket.orgId, target.orgId), eq(s.sponsorPacket.status, "submitted"), sql`${s.sponsorPacket.remittanceMinor} IS NOT NULL`));
    for (const packet of packets) await runAuthorizedAction(actor, "sponsor.reconcile", { id: packet.id });
  }
  if (target.evaluateDemo || target.filingYear) await db.transaction((tx) => generateFilings(tx, agentActor(target.orgId), { year: target.filingYear }));
  if (target.memberId === null && !target.triggerId) {
    const { deliverDailyDigest } = await import("./digest");
    await deliverDailyDigest(target.orgId, target.generation);
  }
  const board = await computeScoreboard(db, target.orgId);
  if (target.evaluateDemo) await saveScoreboard(db, target.orgId, board);
  const summary = `Reviewed ${totals.processed} claim(s), proposed ${totals.proposed} prize payout(s), scheduled ${totals.chased} form reminder workflow(s). ${totals.waiting} payout(s) await controller approval. ${totals.blocked} item(s) need attention.`;
  await db.update(s.agentRun).set({ status: "done", finishedAt: new Date(), summary }).where(and(eq(s.agentRun.orgId, target.orgId), eq(s.agentRun.id, runId)));
  // Escalations and proposals from this run become Slack cards for the people who must act.
  const { kickSlack } = await import("@/lib/slack/kick");
  await kickSlack(target.orgId);
  return { ...totals, summary, ...(target.evaluateDemo ? { scoreboard: board } : {}) };
}

export async function failAgentRun(target: AgentTarget, runId: string) {
  const db = getDb();
  if (!await currentGeneration(db, target)) return;
  await db.update(s.agentRun).set({ status: "failed", finishedAt: new Date(), summary: "The background run stopped after a service error. Completed decisions are saved; run Eve again to continue pending work." }).where(and(eq(s.agentRun.orgId, target.orgId), eq(s.agentRun.id, runId)));
  await recordDecision(db, { orgId: target.orgId, runId, objectType: "event", objectId: target.orgId, action: "Background run interrupted", summary: "Completed decisions remain saved. Run Eve again to retry pending work.", actor: agentActor(target.orgId), status: "escalated", tool: "runAgent" });
}
