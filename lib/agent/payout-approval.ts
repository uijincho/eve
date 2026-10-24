import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";

type PayoutRow = typeof s.payout.$inferSelect;
export interface ApprovalTarget { orgId: string; payoutId: string; quoteFingerprint: string }
export interface ControllerApproval { memberId: string; quoteFingerprint: string }

/** Approval is bound to these exact terms. A bank change or re-quote needs a new release. */
export function payoutQuoteFingerprint(p: Pick<PayoutRow, "id" | "orgId" | "personId" | "grossMinor" | "withholdingMinor" | "feeMinor" | "netMinor" | "currency" | "destinationCurrency" | "destinationNetMinor" | "fxRate" | "provider" | "payoutMethodId" | "bankVersion" | "ruleId" | "ruleVersion" | "requestedBy" | "idempotencyKey">): string {
  return createHash("sha256").update(JSON.stringify([
    p.id, p.orgId, p.personId, p.grossMinor.toString(), p.withholdingMinor.toString(), p.feeMinor.toString(), p.netMinor.toString(),
    p.currency, p.destinationCurrency, p.destinationNetMinor.toString(), p.fxRate, p.provider,
    p.payoutMethodId, p.bankVersion, p.ruleId, p.ruleVersion, p.requestedBy, p.idempotencyKey,
  ])).digest("hex");
}

export function approvalToken(target: ApprovalTarget): string {
  return `payout-release:${target.orgId}:${target.payoutId}:${target.quoteFingerprint}`;
}

export function assertControllerApproval(actor: Pick<ActorContext, "role" | "memberId" | "orgId">, payout: Pick<PayoutRow, "orgId" | "requestedBy" | "status">): void {
  if (actor.role !== "controller") throw new Error("Only a controller can release money.");
  if (payout.orgId !== actor.orgId) throw new Error("Payout not found.");
  if (payout.requestedBy === actor.memberId) throw new Error("The requester cannot release their own payout.");
  if (!["proposed", "approved"].includes(payout.status)) throw new Error(`This payout is ${payout.status} and cannot be released.`);
}

export async function loadApprovalTarget(orgId: string, payoutId: string): Promise<ApprovalTarget | null> {
  const [payout] = await getDb().select().from(s.payout).where(and(eq(s.payout.id, payoutId), eq(s.payout.orgId, orgId)));
  return payout && ["proposed", "approved"].includes(payout.status)
    ? { orgId, payoutId, quoteFingerprint: payoutQuoteFingerprint(payout) } : null;
}

/** Re-check validity before every reminder so stale workflows stop after bank changes or manual action. */
export async function recordApprovalWait(target: ApprovalTarget, runId: string, stage: number): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [payout] = await tx.select().from(s.payout).where(and(eq(s.payout.id, target.payoutId), eq(s.payout.orgId, target.orgId))).for("update");
    if (!payout || !["proposed", "approved"].includes(payout.status) || payoutQuoteFingerprint(payout) !== target.quoteFingerprint) return false;
    const [person] = await tx.select({ name: s.person.name }).from(s.person).where(eq(s.person.id, payout.personId));
    const id = createHash("sha256").update(`${runId}:approval-wait:${stage}`).digest("hex").slice(0, 32);
    const next = stage < 3 ? new Date(Date.now() + (stage === 0 ? 60 * 60_000 : 24 * 60 * 60_000)) : null;
    await tx.insert(s.decisionLog).values({
      id: `dec_${id}`, orgId: target.orgId, runId, objectType: "payout", objectId: payout.id,
      personId: payout.personId, personName: person?.name ?? "", action: stage === 0 ? "Controller release requested" : "Controller release reminder",
      summary: stage < 3 ? "This exact payout quote is waiting for a controller. Eve cannot approve or release its own proposal." : "The payout is still waiting. A backup controller should review it; release authority has not changed.",
      actor: "Eve (agent)", actorRole: "agent", status: stage < 3 ? "waiting" : "escalated", tool: "waitForController",
      facts: { stage, quoteFingerprint: target.quoteFingerprint, bankVersion: payout.bankVersion, grossMinor: payout.grossMinor.toString(), netMinor: payout.netMinor.toString() }, nextActionAt: next,
    }).onConflictDoNothing();
    if (stage > 0) await tx.insert(s.notice).values({
      id: `ntc_${id}`, orgId: target.orgId, channel: "portal", title: stage === 3 ? "Backup controller review needed" : "Payout awaits controller release",
      body: `${person?.name ?? "A recipient"}'s payout remains unpaid. Review the quote and evidence in Payouts. The requester cannot release it.`, status: "sent",
    }).onConflictDoNothing();
    return true;
  });
}
