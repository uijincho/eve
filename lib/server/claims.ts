// Claims: intake (with server-side receipt extraction), policy checks via the
// canonical engine, auto-approval within the agent limit, human review.
//
// Trust rule: a claim can only auto-approve on facts the SERVER established,
// i.e. receipt extraction that read the document clearly and agrees with any
// client-entered amount/currency. Manually entered details always go to a
// person, except trusted seed fixtures (flag only settable in server code)
// and org booking requests whose fare comes from a server-verified offer.
// Critical travel facts (passenger name, travel date, cabin, purchase date)
// that the receipt does not show are never filled in as corroborated: a
// client-entered value is kept for review but the claim goes to a person.

import { postJournal } from "@/lib/ledger";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { Check, FareReview } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import * as s from "@/lib/db/schema";
import { FARE_FLAG_CODES, fareQuestion, type MarketSnapshot } from "@/lib/engines/fare-anomaly";
import { PROJECT_CHECK_CODE } from "@/lib/engines/project-submission";
import { destinationFor } from "@/lib/flights";

import {
  ActionError, agentActor, assertSelfOrStaff, limitsInBooks, money, conflict, forbidden, invalid, loadOrgEvent, loadPerson, notFound, recordDecision, recordNotice,
  toClaim, toEvent, toOrg, toPerson, toUsd, usd, type ClaimRow, type EventRow, type OrgRow, type PersonRow,
} from "./core";
import { claimBudgetRoom, ORG_BOOKED_FLIGHT, overBudgetMessage } from "./budget";
import { checkClaim } from "./engines";
import { assertNotBeneficiary, lockOrgFinance, proposePayout } from "./payouts";
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
  /** Critical facts the receipt did not show. */
  missingFacts?: string[];
  /** Of those, the ones the submitter typed in (kept, never treated as verified). */
  manualFields?: string[];
  /** Org booking requests: the server-verified offer the fare came from. */
  /** Set when the agent asked the attendee about a high fare; holds their answer once given. */
  fareReview?: FareReview;
  offer?: { id: string; carrier: string; flightNumber: string; origin: string; destination: string; departAt: string; cabin: string; totalMinor: string; currency: string; source: string; truth: string; policyOk: boolean; policyReason: string };
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
  if (draft.cabin && ex.cabin && ex.cabin !== "unknown" && draft.cabin.toLowerCase().replace(/\s+/g, "_") !== ex.cabin) mismatches.push(`cabin (entered ${draft.cabin}, receipt ${ex.cabin})`);
  if (draft.travelDate && ex.travelDate && draft.travelDate.slice(0, 10) !== ex.travelDate.slice(0, 10)) mismatches.push(`travel date (entered ${draft.travelDate.slice(0, 10)}, receipt ${ex.travelDate.slice(0, 10)})`);
  // Facts a policy decision depends on must come from the document itself.
  const critical: [string, unknown, unknown][] = [
    ["amount", ex.amountMinor, draft.amountMinor], ["currency", ex.currency, draft.currency], ["purchase date", ex.purchasedAt, draft.purchasedAt], ["merchant", ex.merchant, draft.merchant],
  ];
  if (draft.type === "travel") {
    critical.push(["passenger name", ex.passengerName, draft.nameOnReceipt], ["travel date", ex.travelDate, draft.travelDate], ["cabin", ex.cabin && ex.cabin !== "unknown" ? ex.cabin : null, draft.cabin]);
  }
  const missingFacts = critical.filter(([, fromReceipt]) => fromReceipt == null || fromReceipt === "").map(([name]) => name);
  const manualFields = critical.filter(([, fromReceipt, typed]) => (fromReceipt == null || fromReceipt === "") && typed != null && typed !== "").map(([name]) => name);
  return {
    source: "extraction", extraction: ex, mismatches, missingFacts, manualFields,
    corroborated: !ex.requiresReview && mismatches.length === 0 && missingFacts.length === 0,
  };
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

/** Checks that send a claim to a person without saying anything is wrong with it. */
const NEEDS_A_PERSON = new Set(["agent_limit", "evidence", "budget"]);

/** Engine checks plus Eve's evidence rule. Pure. */
export function evaluate(input: {
  claim: ClaimRow; person: PersonRow; org: OrgRow; event: EventRow; existing: ClaimRow[]; personNames: Map<string, string>;
  /** Remaining room on the claim's budget line (cap minus approved/paid), if the org has one for it. */
  budget?: { name: string; remainingMinor: bigint };
  /** Travel claims from the same event and origin, for the peer fare check. Omitted, the check does not run. */
  farePeers?: ClaimRow[];
  /** Market snapshots for the claim's route. Omitted, the market check does not run. */
  fareSnapshots?: MarketSnapshot[];
}): { checks: Check[]; status: ClaimRow["status"]; reason: string; fareReview?: FareReview } {
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
    // Org bookings are priced by a server-verified offer, not chosen by the attendee.
    fareCandidates: claim.category === ORG_BOOKED_FLIGHT ? undefined : input.farePeers?.map((c) => toClaim(c, "")),
    fareSnapshots: claim.category === ORG_BOOKED_FLIGHT ? undefined : input.fareSnapshots,
  });
  const checks = [...result.checks];
  const trusted = ev.source === "trusted_fixture" || ev.source === "org_booking";
  if (!trusted) {
    const detail = ev.corroborated ? "Receipt read by extraction and matches the entered details."
      : ev.extractionError ? `Receipt could not be read automatically: ${ev.extractionError}`
        : ev.mismatches?.length ? `Entered details differ from the receipt: ${ev.mismatches.join(", ")}.`
          : ev.missingFacts?.length ? `The receipt does not show the ${ev.missingFacts.join(", ")}${ev.manualFields?.length ? `; the ${ev.manualFields.join(", ")} entered by hand must be checked by a person` : ""}.`
          : ev.extraction?.requiresReview ? `Extraction needs review: ${(ev.extraction.warnings ?? []).join("; ") || "low confidence"}.`
            : "Details were entered by hand; a person must compare them with the receipt.";
    checks.push({ code: "evidence", label: "Receipt facts verified", passed: Boolean(ev.corroborated), detail });
  }
  if (input.budget) {
    const fits = claim.usdMinor <= input.budget.remainingMinor;
    checks.push({ code: "budget", label: "Within the budget line", passed: fits, detail: fits ? `${usd(claim.usdMinor)} fits the ${input.budget.name} line (${usd(input.budget.remainingMinor)} left).` : `${usd(claim.usdMinor)} exceeds what is left on the ${input.budget.name} line (${usd(input.budget.remainingMinor)}).` });
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
  // A fare that only looks high: ask the attendee once, then a person decides with their answer. Never a rejection.
  // Limit, budget and hand-entered-receipt checks need a person anyway; they do not stop the question.
  const fareOnly = failed.some((c) => FARE_FLAG_CODES.has(c.code)) && failed.every((c) => FARE_FLAG_CODES.has(c.code) || NEEDS_A_PERSON.has(c.code));
  if (fareOnly && !ev.fareReview && status === "escalated") {
    const route = claim.origin ? `${claim.origin.trim().toUpperCase()} → ${destinationFor(event.venue).airport}` : "flight";
    const { fare, fareMarket: market } = result;
    const fareReview: FareReview = {
      question: fareQuestion({ usdMinor: claim.usdMinor, capMinor: event.travelCapMinor, route, evidence: fare, market }),
      askedAt: claim.createdAt.toISOString(), route,
      ...(fare ? { peerCount: fare.peerCount, medianMinor: fare.medianMinor, percentileMinor: fare.percentileMinor } : {}),
      ...(market ? { market: { basis: market.basis, referenceMinor: market.referenceMinor, capturedOn: market.capturedOn, source: market.source, truth: market.truth, ...(market.priceOnDateMinor ? { priceOnDateMinor: market.priceOnDateMinor } : {}) } } : {}),
    };
    const first = person.name.split(" ")[0];
    return { checks, status: "needs_info", reason: `The fare looks high, so Eve asked ${first} about it before a person decides. ${failed.filter((c) => FARE_FLAG_CODES.has(c.code)).map((c) => c.detail).join(" ")}`, fareReview };
  }
  return { checks, status, reason };
}

/** Travel claims on the same route for the same event (the engine picks comparable ones). */
async function farePeersFor(db: Executor, claim: Pick<ClaimRow, "orgId" | "eventId" | "type" | "origin">): Promise<ClaimRow[] | undefined> {
  if (claim.type !== "travel" || !claim.origin?.trim()) return undefined;
  return db.select().from(s.claim).where(and(eq(s.claim.orgId, claim.orgId), eq(s.claim.eventId, claim.eventId), eq(s.claim.type, "travel"),
    sql`upper(trim(${s.claim.origin})) = ${claim.origin.trim().toUpperCase()}`));
}

/** Stored market snapshots in the engine's shape. */
export function toMarketSnapshots(rows: (typeof s.fareSnapshot.$inferSelect)[]): MarketSnapshot[] {
  return rows.map((r) => ({
    kind: r.kind, capturedOn: r.capturedOn, source: r.source, truth: r.truth, history: r.history,
    ...(r.typicalHighMinor != null ? { typicalHighMinor: r.typicalHighMinor.toString() } : {}),
    ...(r.lowestMinor != null ? { lowestMinor: r.lowestMinor.toString() } : {}),
  }));
}

async function fareSnapshotsFor(db: Executor, claim: Pick<ClaimRow, "eventId" | "type" | "origin">): Promise<MarketSnapshot[] | undefined> {
  if (claim.type !== "travel" || !claim.origin?.trim()) return undefined;
  const rows = await db.select().from(s.fareSnapshot).where(and(eq(s.fareSnapshot.eventId, claim.eventId), eq(s.fareSnapshot.origin, claim.origin.trim().toUpperCase())));
  return toMarketSnapshots(rows);
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
  // The org finance lock serializes budget room across concurrent approvals.
  await lockOrgFinance(tx, org.id);
  const budget = await claimBudgetRoom(tx, claim);
  // Claims are in USD books; a non-USD org's limits and travel cap are converted, never compared raw.
  const books = await limitsInBooks(tx, org, event);
  const farePeers = await farePeersFor(tx, claim);
  const fareSnapshots = await fareSnapshotsFor(tx, claim);
  const result = evaluate({ claim, person, org: books.org, event: books.event, existing: rows, personNames: names, budget: budget ? { name: budget.name, remainingMinor: budget.remainingMinor } : undefined, farePeers, fareSnapshots });
  if (claim.category === ORG_BOOKED_FLIGHT && result.status === "approved") {
    // The agent never buys tickets: an organizer approves every org booking.
    result.status = "escalated";
    result.reason = `Within policy (fare from server-verified offer ${(claim.extracted as Partial<ClaimEvidence> | null)?.offer?.id ?? ""}). An organizer must approve the booking; it is bought by the organization, never reimbursed to the attendee.`;
  }
  // A missing project escalates. It must never become an agent approval or a payout.
  const projectFailed = result.checks.find((c) => c.code === PROJECT_CHECK_CODE && !c.passed);
  if (projectFailed && result.status === "approved") {
    result.status = "escalated";
    result.reason = projectFailed.detail;
  }
  const [updated] = await tx.update(s.claim).set({
    status: result.status, checks: result.checks, reason: result.reason, reviewedBy: result.status === "approved" ? "agent" : null, budgetLineId: budget?.lineId ?? claim.budgetLineId,
    ...(result.fareReview ? { extracted: { ...(claim.extracted ?? {}), fareReview: result.fareReview } } : {}),
  }).where(eq(s.claim.id, claim.id)).returning();
  if (result.fareReview) {
    await recordNotice(tx, { orgId: org.id, personId: person.id, channel: "portal", title: `A question about your ${result.fareReview.route} fare`, body: `${result.fareReview.question} Answer on your claim in the portal.` });
  }
  const agent = agentActor(org.id);
  await recordDecision(tx, {
    orgId: org.id, runId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "claim.check",
    summary: result.status === "approved" ? `Auto-approved ${usd(claim.usdMinor)}: all checks passed within the agent limit.` : result.fareReview ? `Asked ${person.name} about the fare: ${result.fareReview.question}` : `${result.status === "needs_info" ? "Asked for info" : "Escalated"}: ${result.reason}`,
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
  if (draft.category === ORG_BOOKED_FLIGHT && evidence.source !== "org_booking") throw invalid("Org-booked flights are requested from flight search, not submitted as claims.");
  const merged = mergeDraft(draft, evidence);
  if (!merged.merchant || merged.amountMinor === undefined || !merged.currency || !merged.purchasedAt) {
    throw invalid("Enter the merchant, amount, currency and purchase date (the receipt could not supply them).");
  }
  const { org, event } = await loadOrgEvent(tx, actor.orgId);
  const person = await loadPerson(tx, actor.orgId, personId);
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
  await lockOrgFinance(tx, actor.orgId);
  const [claim] = await tx.select().from(s.claim).where(and(eq(s.claim.id, claimId), eq(s.claim.orgId, actor.orgId))).for("update");
  if (!claim) throw notFound("Claim not found.");
  if (!["submitted", "processing"].includes(claim.status)) return claim;
  const { org, event } = await loadOrgEvent(tx, actor.orgId);
  const person = await loadPerson(tx, actor.orgId, claim.personId);
  return applyEvaluation(tx, actor, claim, person, org, event, runId);
}

/** claim.explain: the attendee answers the agent's fare question; the claim goes to a person with the answer. */
export async function explainClaim(tx: Executor, actor: ActorContext, input: { id: string; explanation: string }) {
  const [claim] = await tx.select().from(s.claim).where(and(eq(s.claim.id, input.id), eq(s.claim.orgId, actor.orgId))).for("update");
  if (!claim) throw notFound("Claim not found.");
  assertSelfOrStaff(actor, claim.personId);
  const review = (claim.extracted as Partial<ClaimEvidence> | null)?.fareReview;
  if (!review) throw conflict("Eve has not asked about this claim's fare.");
  if (review.explanation) throw conflict("You already answered; an organizer will review it.");
  if (claim.status !== "needs_info") throw conflict(`Claim is already ${claim.status}.`);
  const person = await loadPerson(tx, actor.orgId, claim.personId);
  const answered: FareReview = { ...review, explanation: input.explanation, explainedAt: new Date().toISOString() };
  const reason = `${person.name.split(" ")[0]} explained the fare: "${input.explanation}" A person decides with the evidence.`;
  const [updated] = await tx.update(s.claim).set({ status: "escalated", reason, extracted: { ...(claim.extracted ?? {}), fareReview: answered } }).where(eq(s.claim.id, claim.id)).returning();
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "claim.explain",
    summary: `${person.name} explained the ${review.route} fare (${usd(claim.usdMinor)}); routed to an organizer.`,
    actor, status: "escalated", tool: "review", checks: claim.checks, facts: { fareReview: answered },
  });
  return { status: updated.status };
}

/** claim.review by an organizer (within their limit) or a controller. */
export async function reviewClaim(tx: Executor, actor: ActorContext, input: { id: string; decision: "approve" | "reject" | "needs_info"; reason: string }) {
  await lockOrgFinance(tx, actor.orgId);
  const [claim] = await tx.select().from(s.claim).where(and(eq(s.claim.id, input.id), eq(s.claim.orgId, actor.orgId))).for("update");
  if (!claim) throw notFound("Claim not found.");
  if (claim.requestedBy === actor.memberId) throw forbidden("You cannot review your own claim.");
  assertNotBeneficiary(actor, await loadPerson(tx, actor.orgId, claim.personId), "review");
  if (!["escalated", "needs_info", "submitted", "processing"].includes(claim.status)) throw conflict(`Claim is already ${claim.status}.`);
  const { org } = await loadOrgEvent(tx, actor.orgId);
  const { event } = await loadOrgEvent(tx, actor.orgId);
  const books = await limitsInBooks(tx, org, event);
  if (input.decision === "approve" && actor.role === "organizer" && claim.usdMinor > books.org.organizerLimitMinor) {
    throw forbidden(`Claims above ${usd(books.org.organizerLimitMinor)}${books.note ? ` (${money(org.organizerLimitMinor, org.currency)}; ${books.note})` : ""} need a controller.`);
  }
  const person = await loadPerson(tx, actor.orgId, claim.personId);
  if (input.decision === "approve" && !person.adult) throw conflict("Recipient is under 18; claim cannot be approved.");
  if (input.decision === "approve") {
    const room = await claimBudgetRoom(tx, claim);
    if (room && claim.usdMinor > room.remainingMinor) throw new ActionError(409, overBudgetMessage(room, claim.usdMinor, "Approving"), { budgetLineId: room.lineId });
  }
  const orgBooking = claim.category === ORG_BOOKED_FLIGHT;
  const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_info";
  await tx.update(s.claim).set({ status, reason: input.reason, reviewedBy: actor.memberId, budgetLineId: claim.budgetLineId }).where(eq(s.claim.id, claim.id));
  await tx.insert(s.approval).values({ id: newId("apr"), orgId: actor.orgId, objectType: "claim", objectId: claim.id, requestedBy: claim.requestedBy, approverId: actor.memberId, approverRole: actor.role, decision: input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_info", reason: input.reason });
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "claim.review",
    summary: `${actor.name} ${status === "approved" ? "approved" : status === "rejected" ? "rejected" : "asked for more information on"} ${orgBooking ? "the org booking of " : ""}${usd(claim.usdMinor)}: ${input.reason}`,
    actor, status: "done", tool: "review", checks: claim.checks, facts: { decision: input.decision },
  });
  if (status === "approved" && orgBooking) {
    await bookOrgFlight(tx, actor, claim, person);
    return { status: "paid" as const, booked: true };
  }
  if (status === "approved") await proposePayout(tx, agentActor(actor.orgId), { sourceType: "claim", sourceId: claim.id });
  return { status };
}

/**
 * The organization buys an approved org-booked flight. Simulated: no ticket is
 * purchased and no airline is contacted. The cost is travel expense paid from
 * simulated cash; the attendee is never paid for it.
 */
async function bookOrgFlight(tx: Executor, actor: ActorContext, claim: ClaimRow, person: PersonRow) {
  const offer = (claim.extracted as Partial<ClaimEvidence> | null)?.offer;
  const ref = `simbook_${claim.id.slice(-12)}`;
  await postJournal(tx, {
    orgId: actor.orgId, memo: `Org booking ${claim.merchant} for ${person.name} (simulated; no ticket purchased)`, sourceType: "claim", sourceId: claim.id,
    idempotencyKey: `org-booking:${claim.id}`, createdBy: actor.memberId,
    lines: [
      { account: "5000", debitMinor: claim.usdMinor, currency: "USD", personId: person.id, memo: `Flight ${offer?.id ?? ""}`.trim() },
      { account: "1000", creditMinor: claim.usdMinor, currency: "USD", memo: `Simulated airline purchase ${ref}` },
    ],
  });
  await tx.update(s.claim).set({ status: "paid", reason: `Booked by the organization (simulated booking ${ref}; no ticket was purchased). Nothing is reimbursed to the attendee.` }).where(eq(s.claim.id, claim.id));
  await recordDecision(tx, {
    orgId: actor.orgId, objectType: "claim", objectId: claim.id, personId: person.id, personName: person.name, action: "flight.book",
    summary: `Org booking recorded for ${person.name}: ${claim.merchant}, ${usd(claim.usdMinor)} (Simulated, ${ref}). No payout to the attendee.`,
    actor, status: "done", tool: "bookFlight", facts: { truth: "Simulated", bookingRef: ref, offer: offer ?? null, approvedBy: actor.memberId },
  });
  await recordNotice(tx, { orgId: actor.orgId, personId: person.id, channel: "portal", title: "Your flight request was approved", body: `The organizers approved ${claim.merchant} (${usd(claim.usdMinor)}). This demo records a simulated booking (${ref}); no real ticket was purchased.` });
}
