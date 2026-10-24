// Claims: intake (with server-side receipt extraction), policy checks via the
// canonical engine, auto-approval within the agent limit, human review.
//
// Trust rule: a claim can only auto-approve on facts the SERVER established,
// i.e. receipt extraction that read the document clearly and agrees with any
// client-entered amount/currency. Manually entered details always go to a
// person, except trusted seed fixtures (flag only settable in server code).

import { and, eq, inArray, or } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { Check } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";

import {
  agentActor, assertSelfOrStaff, conflict, forbidden, invalid, loadOrgEvent, loadPerson, notFound, recordDecision,
  toClaim, toEvent, toOrg, toPerson, toUsd, usd, type ClaimRow, type EventRow, type OrgRow, type PersonRow,
} from "./core";
import { checkClaim } from "./engines";
import { proposePayout } from "./payouts";
import { extractReceiptForDocument, type ReceiptEvidence } from "./receipt";

export interface ClaimDraft {
  personId?: string; type: "travel" | "expense"; merchant?: string; description?: string; category?: string;
  amountMinor?: bigint; currency?: string; purchasedAt?: string; travelDate?: string; cabin?: string; origin?: string;
  nameOnReceipt?: string; documentId?: string; idempotencyKey?: string;
}

/** Stored in claim.extracted. `source` says where facts came from. */
export interface ClaimEvidence {
  source: "extraction" | "manual" | "trusted_fixture" | "org_booking";
  extraction?: ReceiptEvidence | null;
  extractionError?: string;
  corroborated: boolean;
  mismatches: string[];
}

const CATEGORY_DEFAULT = { travel: "travel", expense: "other" } as const;

/** Runs OUTSIDE a transaction: may call the vision model. */
export async function prepareClaim(db: Executor, actor: ActorContext, draft: ClaimDraft): Promise<ClaimEvidence> {
  if (!draft.documentId) return { source: "manual", corroborated: false, mismatches: [] };
  const [doc] = await db.select({ id: s.document.id, personId: s.document.personId, uploadedBy: s.document.uploadedBy })
    .from(s.document).where(and(eq(s.document.id, draft.documentId), eq(s.document.orgId, actor.orgId)));
  if (!doc) throw notFound("Receipt document not found.");
  if (actor.role === "attendee" && doc.personId !== actor.personId && doc.uploadedBy !== actor.memberId) throw forbidden("That document is not yours.");
  const result = await extractReceiptForDocument(db, actor.orgId, draft.documentId);
  if (!result.ok) return { source: "manual", extraction: null, extractionError: result.error, corroborated: false, mismatches: [] };
  const ex = result.evidence;
  const mismatches: string[] = [];
  if (draft.amountMinor !== undefined && ex.amountMinor && BigInt(ex.amountMinor) !== draft.amountMinor) mismatches.push(`amount (entered ${draft.amountMinor}, receipt ${ex.amountMinor})`);
  if (draft.currency && ex.currency && draft.currency !== ex.currency) mismatches.push(`currency (entered ${draft.currency}, receipt ${ex.currency})`);
  if (draft.nameOnReceipt && ex.passengerName && draft.nameOnReceipt.toLowerCase() !== ex.passengerName.toLowerCase()) mismatches.push("name on receipt");
  return { source: "extraction", extraction: ex, corroborated: !ex.requiresReview && mismatches.length === 0 && Boolean(ex.amountMinor && ex.currency), mismatches };
}

function mergeDraft(draft: ClaimDraft, ev: ClaimEvidence): ClaimDraft {
  const ex = ev.extraction;
  if (!ex) return draft;
  // Server-extracted facts win; client values only fill gaps.
  return {
    ...draft,
    merchant: ex.merchant ?? draft.merchant,
    amountMinor: ex.amountMinor ? BigInt(ex.amountMinor) : draft.amountMinor,
    currency: ex.currency ?? draft.currency,
    purchasedAt: ex.purchasedAt ?? draft.purchasedAt,
    travelDate: ex.travelDate ?? draft.travelDate,
    cabin: ex.cabin && ex.cabin !== "unknown" ? ex.cabin : draft.cabin,
    origin: ex.origin ?? draft.origin,
    nameOnReceipt: ex.passengerName ?? draft.nameOnReceipt,
    description: draft.description || ex.description,
    category: draft.category ?? (ex.category === "travel" ? undefined : ex.category),
  };
}

/** Engine checks plus Eve's evidence rule. Pure. */
export function evaluate(input: {
  claim: ClaimRow; person: PersonRow; org: OrgRow; event: EventRow; existing: ClaimRow[]; personNames: Map<string, string>;
}): { checks: Check[]; status: ClaimRow["status"]; reason: string } {
  const { claim, person, org, event } = input;
  const ev = (claim.extracted ?? {}) as Partial<ClaimEvidence>;
  const contractClaim = toClaim(claim, person.name);
  const result = checkClaim({
    claim: contractClaim,
    person: toPerson(person, { paidYtdMinor: 0n, outstandingMinor: 0n, now: new Date() }),
    event: toEvent(event), org: toOrg(org),
    existingClaims: input.existing.filter((c) => c.id !== claim.id).map((c) => toClaim(c, input.personNames.get(c.personId) ?? "")),
    // Travel tickets must show a name; a missing one fails the match rather than defaulting to the profile.
    ticketName: claim.type === "travel" ? (claim.nameOnReceipt ?? "") : (claim.nameOnReceipt ?? undefined),
    asOf: claim.createdAt.toISOString(),
  });
  const checks = [...result.checks];
  const trusted = ev.source === "trusted_fixture" || ev.source === "org_booking";
  if (!trusted) {
    const detail = ev.corroborated ? "Receipt read by extraction and matches the entered details."
      : ev.extractionError ? `Receipt could not be read automatically: ${ev.extractionError}`
        : ev.mismatches?.length ? `Entered details differ from the receipt: ${ev.mismatches.join(", ")}.`
          : ev.extraction?.requiresReview ? `Extraction needs review: ${(ev.extraction.warnings ?? []).join("; ") || "low confidence"}.`
            : "Details were entered by hand; a person must compare them with the receipt.";
    checks.push({ code: "evidence", label: "Receipt facts verified", passed: Boolean(ev.corroborated), detail });
  }
  const failed = checks.filter((c) => !c.passed);
  let status = result.status;
  let reason = result.reason;
  if (status === "approved" && failed.length) {
    status = "escalated";
    reason = failed.map((c) => c.detail).join(" ");
  }
  if (status === "approved" && claim.usdMinor > org.agentLimitMinor) {
    status = "escalated";
    reason = `All checks passed; ${usd(claim.usdMinor)} is above the ${usd(org.agentLimitMinor)} auto-approve limit.`;
  }
  return { checks, status, reason };
}

async function claimsForChecks(db: Executor, orgId: string, claim: Pick<ClaimRow, "personId" | "receiptHash">) {
  const rows = await db.select().from(s.claim).where(and(eq(s.claim.orgId, orgId),
    claim.receiptHash ? or(eq(s.claim.personId, claim.personId), eq(s.claim.receiptHash, claim.receiptHash)) : eq(s.claim.personId, claim.personId)));
  const ids = [...new Set(rows.map((r) => r.personId))];
  const people = ids.length ? await db.select({ id: s.person.id, name: s.person.name }).from(s.person).where(inArray(s.person.id, ids)) : [];
  return { rows, names: new Map(people.map((p) => [p.id, p.name])) };
}

/** Applies an evaluation, logs it, and queues approved claims for payout (agent-requested). */
async function applyEvaluation(tx: Executor, actor: ActorContext, claim: ClaimRow, person: PersonRow, org: OrgRow, event: EventRow, runId?: string) {
  const { rows, names } = await claimsForChecks(tx, org.id, claim);
  const result = evaluate({ claim, person, org, event, existing: rows, personNames: names });
  const [updated] = await tx.update(s.claim).set({ status: result.status, checks: result.checks, reason: result.reason, reviewedBy: result.status === "approved" ? "agent" : null })
    .where(eq(s.claim.id, claim.id)).returning();
  const agent = agentActor(org.id);
  await recordDecision(tx, {
    orgId: org.id, runId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "claim.check",
    summary: result.status === "approved" ? `Auto-approved ${usd(claim.usdMinor)}: all checks passed within the agent limit.` : `${result.status === "needs_info" ? "Asked for info" : "Escalated"}: ${result.reason}`,
    actor: agent, status: result.status === "approved" ? "done" : "escalated", tool: "checkPolicy", checks: result.checks,
    documentId: claim.documentId, facts: { usdMinor: claim.usdMinor.toString(), fxRate: claim.fxRate, fxSource: claim.fxSource, evidence: claim.extracted ?? null, submittedBy: actor.name },
  });
  if (result.status === "approved") {
    await tx.insert(s.approval).values({ id: newId("apr"), orgId: org.id, objectType: "claim", objectId: claim.id, requestedBy: claim.requestedBy, approverId: "agent", approverRole: "agent", decision: "approved", reason: "Within policy and the agent limit" });
    await proposePayout(tx, agent, { sourceType: "claim", sourceId: claim.id });
  }
  return updated;
}

/** claim.submit (transaction part). `evidence` comes from prepareClaim. */
export async function submitClaim(tx: Executor, actor: ActorContext, draft: ClaimDraft, evidence: ClaimEvidence) {
  const personId = draft.personId ?? actor.personId;
  if (!personId) throw invalid("personId is required.");
  assertSelfOrStaff(actor, personId);
  if (draft.idempotencyKey) {
    const [dup] = await tx.select().from(s.claim).where(and(eq(s.claim.orgId, actor.orgId), eq(s.claim.idempotencyKey, draft.idempotencyKey)));
    if (dup) return { claim: dup, replayed: true };
  }
  const merged = mergeDraft(draft, evidence);
  if (!merged.merchant || merged.amountMinor === undefined || !merged.currency || !merged.purchasedAt) {
    throw invalid("Enter the merchant, amount, currency and purchase date (the receipt could not supply them).");
  }
  const [{ org, event }, person] = await Promise.all([loadOrgEvent(tx, actor.orgId), loadPerson(tx, actor.orgId, personId)]);
  const purchasedAt = new Date(merged.purchasedAt);
  const fx = await toUsd(tx, merged.amountMinor, merged.currency, purchasedAt);
  let receiptHash: string | null = evidence.extraction?.receiptHash ?? null;
  let receiptName: string | null = null;
  if (merged.documentId) {
    const [doc] = await tx.select({ sha: s.document.sha256, name: s.document.name }).from(s.document).where(eq(s.document.id, merged.documentId));
    receiptHash = doc?.sha ?? receiptHash;
    receiptName = doc?.name ?? null;
  }
  const [claim] = await tx.insert(s.claim).values({
    id: newId("clm"), orgId: org.id, eventId: event.id, personId, type: merged.type, merchant: merged.merchant,
    description: merged.description ?? "", category: merged.category ?? CATEGORY_DEFAULT[merged.type],
    amountMinor: merged.amountMinor, currency: merged.currency, usdMinor: fx.usdMinor, fxRate: fx.fxRate, fxSource: fx.fxSource,
    purchasedAt, travelDate: merged.travelDate ? new Date(merged.travelDate) : null, cabin: merged.cabin ?? null, origin: merged.origin ?? null,
    nameOnReceipt: merged.nameOnReceipt ?? null, receiptName, documentId: merged.documentId ?? null, receiptHash,
    extracted: evidence as unknown as Record<string, unknown>, status: "processing", dueAt: new Date(Date.now() + 3 * 86_400_000),
    requestedBy: actor.memberId, idempotencyKey: draft.idempotencyKey ?? null,
  }).onConflictDoNothing().returning();
  if (!claim) throw conflict("This claim was already submitted.");
  return { claim: await applyEvaluation(tx, actor, claim, person, org, event), replayed: false };
}

/** Re-runs checks for one claim (workflow entrypoint). Never re-approves a decided claim. */
export async function processClaim(tx: Executor, actor: ActorContext, claimId: string, runId?: string) {
  const [claim] = await tx.select().from(s.claim).where(and(eq(s.claim.id, claimId), eq(s.claim.orgId, actor.orgId))).for("update");
  if (!claim) throw notFound("Claim not found.");
  if (!["submitted", "processing"].includes(claim.status)) return claim;
  const [{ org, event }, person] = await Promise.all([loadOrgEvent(tx, actor.orgId), loadPerson(tx, actor.orgId, claim.personId)]);
  return applyEvaluation(tx, actor, claim, person, org, event, runId);
}

/** claim.review by an organizer (within their limit) or a controller. */
export async function reviewClaim(tx: Executor, actor: ActorContext, input: { id: string; decision: "approve" | "reject" | "needs_info"; reason: string }) {
  const [claim] = await tx.select().from(s.claim).where(and(eq(s.claim.id, input.id), eq(s.claim.orgId, actor.orgId))).for("update");
  if (!claim) throw notFound("Claim not found.");
  if (claim.requestedBy === actor.memberId || (actor.personId && actor.personId === claim.personId)) throw forbidden("You cannot review your own claim.");
  if (!["escalated", "needs_info", "submitted", "processing"].includes(claim.status)) throw conflict(`Claim is already ${claim.status}.`);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  if (input.decision === "approve" && actor.role === "organizer" && claim.usdMinor > org.organizerLimitMinor) {
    throw forbidden(`Claims above ${usd(org.organizerLimitMinor)} need a controller.`);
  }
  const person = await loadPerson(tx, actor.orgId, claim.personId);
  if (input.decision === "approve" && !person.adult) throw conflict("Recipient is under 18; claim cannot be approved.");
  const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_info";
  await tx.update(s.claim).set({ status, reason: input.reason, reviewedBy: actor.memberId }).where(eq(s.claim.id, claim.id));
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "claim", objectId: claim.id, requestedBy: claim.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_info", reason: input.reason });
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "claim.review",
    summary: `${actor.name} ${status === "approved" ? "approved" : status === "rejected" ? "rejected" : "asked for more information on"} ${usd(claim.usdMinor)}: ${input.reason}`,
    actor, status: "done", tool: "review", checks: claim.checks, facts: { decision: input.decision },
  });
  if (status === "approved") await proposePayout(tx, agentActor(actor.orgId), { sourceType: "claim", sourceId: claim.id });
  return { status };
}
