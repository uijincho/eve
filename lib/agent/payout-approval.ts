import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { demoModeEnabled } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";

type PayoutRow = typeof s.payout.$inferSelect;
export interface ApprovalTarget { orgId: string; payoutId: string; quoteFingerprint: string }
export interface ControllerApproval { memberId: string; quoteFingerprint: string }
export class ApprovalConflictError extends Error {}

/** Approval is bound to these exact terms. A bank change or re-quote needs a new release. */
export function payoutQuoteFingerprint(p: Pick<PayoutRow, "id" | "orgId" | "personId" | "grossMinor" | "withholdingMinor" | "feeMinor" | "netMinor" | "currency" | "destinationCurrency" | "destinationNetMinor" | "fxRate" | "provider" | "payoutMethodId" | "bankVersion" | "ruleId" | "ruleVersion" | "ruleVerified" | "reportingForm" | "reportable" | "createdAt" | "requestedBy" | "idempotencyKey">): string {
  return createHash("sha256").update(JSON.stringify([
    p.id, p.orgId, p.personId, p.grossMinor.toString(), p.withholdingMinor.toString(), p.feeMinor.toString(), p.netMinor.toString(),
    p.currency, p.destinationCurrency, p.destinationNetMinor.toString(), p.fxRate, p.provider,
    p.payoutMethodId, p.bankVersion, p.ruleId, p.ruleVersion, p.ruleVerified, p.reportingForm, p.reportable,
    p.createdAt.toISOString(), p.requestedBy, p.idempotencyKey,
  ])).digest("hex");
}

export function approvalToken(target: ApprovalTarget): string {
  return `payout-release:${target.orgId}:${target.payoutId}:${target.quoteFingerprint}`;
}

export function assertControllerApproval(actor: Pick<ActorContext, "role" | "memberId" | "orgId" | "personId">, payout: Pick<PayoutRow, "orgId" | "requestedBy" | "status" | "personId">): void {
  if (actor.role !== "controller") throw new ApprovalConflictError("Only a controller can release money.");
  if (payout.orgId !== actor.orgId) throw new ApprovalConflictError("Payout not found.");
  if (payout.requestedBy === actor.memberId) throw new ApprovalConflictError("The requester cannot release their own payout.");
  if (actor.personId && actor.personId === payout.personId) throw new ApprovalConflictError("The recipient cannot release their own payout.");
  if (!["proposed", "approved"].includes(payout.status)) throw new ApprovalConflictError(`This payout is ${payout.status} and cannot be released.`);
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
    if (!payout) return false;
    if (!["proposed", "approved"].includes(payout.status) || payoutQuoteFingerprint(payout) !== target.quoteFingerprint) {
      const id = createHash("sha256").update(`${runId}:superseded`).digest("hex").slice(0, 32);
      await tx.insert(s.decisionLog).values({ id: `dec_${id}`, orgId: target.orgId, runId, objectType: "payout", objectId: payout.id, action: "Previous release request closed", summary: "This quote changed or the payout no longer awaits release. Any new proposal needs a fresh controller approval.", actor: "Eve (agent)", actorRole: "agent", status: "done", tool: "waitForController" }).onConflictDoNothing();
      return false;
    }
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

/** Runs only after the authenticated controller route resumes the hook. Re-check everything under the payout lock. */
export async function executeControllerApproval(target: ApprovalTarget, approval: ControllerApproval, runId: string): Promise<{ payoutId: string; status: string; replayed: boolean }> {
  const { releasePayout } = await import("@/lib/server/payouts");
  return getDb().transaction(async (tx) => {
    const [org] = await tx.select().from(s.organization).where(eq(s.organization.id, target.orgId)).for("no key update");
    if (!org) throw new ApprovalConflictError("Organization no longer exists.");
    const [member] = await tx.select().from(s.orgMember).where(and(eq(s.orgMember.id, approval.memberId), eq(s.orgMember.orgId, target.orgId))).for("update");
    if (!member || member.role !== "controller") throw new ApprovalConflictError("The approver no longer has controller access.");
    if (!org || (member.demoPersona && (!org.isDemo || !demoModeEnabled()))) throw new ApprovalConflictError("The demo approval is no longer valid.");
    const [recipient] = await tx.select({ personId: s.payout.personId }).from(s.payout).where(and(eq(s.payout.id, target.payoutId), eq(s.payout.orgId, target.orgId)));
    if (recipient) await tx.select({ id: s.person.id }).from(s.person).where(and(eq(s.person.id, recipient.personId), eq(s.person.orgId, target.orgId))).for("no key update");
    const [payout] = await tx.select().from(s.payout).where(and(eq(s.payout.id, target.payoutId), eq(s.payout.orgId, target.orgId))).for("update");
    if (!payout) throw new ApprovalConflictError("Payout no longer exists.");
    if (approval.quoteFingerprint !== target.quoteFingerprint || payoutQuoteFingerprint(payout) !== target.quoteFingerprint) {
      throw new ApprovalConflictError("The payout quote or bank details changed. A fresh controller release is required.");
    }
    if (payout.status === "paid" && payout.releasedBy === member.id) return { payoutId: payout.id, status: "paid", replayed: true };
    const actor: ActorContext = {
      memberId: member.id, orgId: member.orgId, role: member.role, name: member.name, email: member.email,
      personId: member.personId, userId: member.userId, demo: member.demoPersona && org.isDemo,
    };
    assertControllerApproval(actor, payout);
    const released = await releasePayout(tx, actor, payout.id);
    const settled = released.status === "paid";
    const processing = released.status === "processing";
    const id = createHash("sha256").update(`${runId}:released`).digest("hex").slice(0, 32);
    await tx.insert(s.decisionLog).values({
      id: `dec_${id}`, orgId: target.orgId, runId, objectType: "payout", objectId: released.id, personId: released.personId,
      action: settled ? "Controller hook resumed" : processing ? "Payment submitted; settlement pending" : "Payout re-quoted; fresh approval needed",
      summary: settled
        ? "The authenticated controller approved these exact terms. Release, bank-version checks, approval evidence and journal posting completed in one transaction."
        : processing
          ? "The controller authorized this payment. The provider has not confirmed bank settlement, so it is still processing."
          : "Tax, year-to-date income or eligibility changed during the final checks. The updated proposal is saved and no money was released. A controller must review it again.",
      actor: actor.name, actorRole: actor.role, status: settled ? "done" : processing ? "waiting" : "escalated", tool: "executePayout",
      facts: { approverId: member.id, quoteFingerprint: target.quoteFingerprint, currentFingerprint: payoutQuoteFingerprint(released), providerRef: released.providerRef, truth: released.truth },
    }).onConflictDoNothing();
    return { payoutId: released.id, status: released.status, replayed: false };
  });
}

export async function recordApprovalFailure(target: ApprovalTarget, runId: string, reason: string): Promise<void> {
  const [payout] = await getDb().select({ id: s.payout.id }).from(s.payout).where(and(eq(s.payout.id, target.payoutId), eq(s.payout.orgId, target.orgId)));
  if (!payout) return;
  const id = createHash("sha256").update(`${runId}:blocked`).digest("hex").slice(0, 32);
  await getDb().insert(s.decisionLog).values({
    id: `dec_${id}`, orgId: target.orgId, runId, objectType: "payout", objectId: payout.id,
    action: "Controller release needs another review", summary: reason, actor: "Eve (agent)", actorRole: "agent", status: "escalated", tool: "waitForController",
    facts: { quoteFingerprint: target.quoteFingerprint },
  }).onConflictDoNothing();
}
