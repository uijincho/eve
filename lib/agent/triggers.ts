import { getHookByToken, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { and, eq, inArray } from "drizzle-orm";

import { getChaseCandidates } from "@/lib/agent/automation";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { demoModeEnabled, type ActorContext } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/contracts";
import { taxChaseWorkflow } from "@/workflows/tax-chase";
import { agentRunWorkflow } from "@/workflows/agent-run";
import { startPayoutApproval } from "./release";
import type { AgentTarget } from "./operations";

/** Call after committing the source action. Hook tokens deduplicate concurrent starts. */
export async function startTaxChases(orgId: string, options: { personId?: string; acceleratedDemo?: boolean } = {}): Promise<string[]> {
  const targets = (await getChaseCandidates(orgId)).filter((target) => !options.personId || target.personId === options.personId);
  const runIds: string[] = [];
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batch = await Promise.all(targets.slice(offset, offset + 5).map(async (target) => {
      const token = `tax-chase:${target.orgId}:${target.personId}:${target.generation}`;
      try { return (await getHookByToken(token)).runId; }
      catch (error) { if (!HookNotFoundError.is(error)) throw error; }
      const run = await start(taxChaseWorkflow, [target, options.acceleratedDemo === true]);
      return run.runId;
    }));
    runIds.push(...batch);
  }
  return runIds;
}

export async function startPendingApprovals(orgId: string): Promise<string[]> {
  const rows = await getDb().select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.orgId, orgId), inArray(s.payout.status, ["proposed", "approved"])));
  const runs: string[] = [];
  for (let offset = 0; offset < rows.length; offset += 5) {
    const batch = await Promise.all(rows.slice(offset, offset + 5).map((row) => startPayoutApproval(orgId, row.id)));
    runs.push(...batch.filter((id): id is string => Boolean(id)));
  }
  return runs;
}

export async function queueAgentRun(actor: ActorContext, kind: AgentTarget["kind"] = "all", evaluateDemo = false): Promise<ActionResult & { status: number }> {
  if (!["organizer", "controller"].includes(actor.role)) return { ok: false, status: 403, message: "Only an organizer or controller can start an event review." };
  const [org] = await getDb().select().from(s.organization).where(eq(s.organization.id, actor.orgId));
  if (!org || (evaluateDemo && (!org.isDemo || !actor.demo || !demoModeEnabled()))) return { ok: false, status: 403, message: "Demo evaluation is available only in the demo organization." };
  const target: AgentTarget = { orgId: org.id, generation: org.createdAt.toISOString(), memberId: actor.memberId, kind, evaluateDemo };
  const { runId } = await start(agentRunWorkflow, [target]);
  return { ok: true, status: 202, message: "Eve's background review has started. Follow each decision in Agent Activity; payout release still requires a controller.", data: { runId } };
}

/** Authenticated cron entrypoint; never accepts an actor/role from an HTTP payload. */
export async function queueScheduledRun(orgId: string, filingYear?: number): Promise<string | null> {
  const [org] = await getDb().select().from(s.organization).where(eq(s.organization.id, orgId));
  if (!org) return null;
  const target: AgentTarget = { orgId, generation: org.createdAt.toISOString(), memberId: null, kind: "all", evaluateDemo: false, filingYear };
  return (await start(agentRunWorkflow, [target])).runId;
}
