// Budget cap enforcement. A budget line's usage is spent plus committed money:
// approved or paid claims attributed to the line (travel, ground transport,
// supplies...), and for the "prizes" line every award payout that is not
// failed or returned (held, proposed, in flight, paid or fulfilled in kind).
// Callers hold the org finance lock (lockOrgFinance), so two approvals cannot
// both see the same room. Attribution matches the snapshot's budget view.

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

import { ActionError, usd, type ClaimRow } from "./core";

export const PRIZE_CATEGORY = "prizes";
export const ORG_BOOKED_FLIGHT = "org_booked_flight";
export const CLAIM_COMMITTED = ["approved", "paid"] as const;

export interface BudgetRoom { lineId: string; name: string; capMinor: bigint; usedMinor: bigint; remainingMinor: bigint }

/** Budget category a claim draws on: every travel claim (including org-booked flights) is "travel". */
export function claimCategory(c: Pick<ClaimRow, "type" | "category">): string {
  return c.type === "travel" ? "travel" : c.category;
}

async function lineFor(tx: Executor, eventId: string, category: string, lineId?: string | null) {
  const [line] = await tx.select().from(s.budgetLine)
    .where(lineId ? eq(s.budgetLine.id, lineId) : and(eq(s.budgetLine.eventId, eventId), eq(s.budgetLine.category, category)));
  return line;
}

/** Room left on the claim's line, excluding the claim itself. Null when the org set no line for it. */
export async function claimBudgetRoom(tx: Executor, claim: Pick<ClaimRow, "id" | "eventId" | "type" | "category" | "budgetLineId">): Promise<BudgetRoom | null> {
  const category = claimCategory(claim);
  const line = await lineFor(tx, claim.eventId, category, claim.budgetLineId);
  if (!line) return null;
  const matchesLine = category === "travel"
    ? sql`${s.claim.type} = 'travel'`
    : sql`${s.claim.category} = ${category} AND ${s.claim.type} = 'expense'`;
  const [{ used }] = await tx.select({ used: sql<string>`coalesce(sum(${s.claim.usdMinor}), 0)::text` }).from(s.claim)
    .where(and(eq(s.claim.eventId, claim.eventId), inArray(s.claim.status, [...CLAIM_COMMITTED]), sql`${s.claim.id} <> ${claim.id}`,
      sql`(${s.claim.budgetLineId} = ${line.id} OR (${s.claim.budgetLineId} IS NULL AND ${matchesLine}))`));
  const usedMinor = BigInt(used);
  return { lineId: line.id, name: line.name, capMinor: line.capMinor, usedMinor, remainingMinor: line.capMinor - usedMinor };
}

/** Room left on the event's prizes line, excluding one payout. Null when there is no prizes line. */
export async function prizeBudgetRoom(tx: Executor, eventId: string, excludePayoutId?: string | null): Promise<BudgetRoom | null> {
  const line = await lineFor(tx, eventId, PRIZE_CATEGORY);
  if (!line) return null;
  const [{ used }] = await tx.select({ used: sql<string>`coalesce(sum(${s.payout.grossMinor}), 0)::text` }).from(s.payout)
    .innerJoin(s.award, eq(s.award.id, s.payout.awardId))
    .where(and(eq(s.award.eventId, eventId), sql`${s.payout.status} NOT IN ('failed', 'returned')`,
      excludePayoutId ? sql`${s.payout.id} <> ${excludePayoutId}` : sql`true`));
  const usedMinor = BigInt(used);
  return { lineId: line.id, name: line.name, capMinor: line.capMinor, usedMinor, remainingMinor: line.capMinor - usedMinor };
}

export function overBudgetMessage(room: BudgetRoom, amountMinor: bigint, verb: string): string {
  const left = room.remainingMinor > 0n ? room.remainingMinor : 0n;
  return `${verb} ${usd(amountMinor)} would exceed the ${room.name} budget: ${usd(room.capMinor)} cap, ${usd(room.usedMinor)} already spent or committed, ${usd(left)} left. Raise the ${room.name} line in Budget or reduce the amount first.`;
}

/** Throws a 409 with the line's numbers when `amountMinor` does not fit. */
export function assertFits(room: BudgetRoom | null, amountMinor: bigint, verb: string): void {
  if (room && amountMinor > room.remainingMinor) {
    throw new ActionError(409, overBudgetMessage(room, amountMinor, verb), { budgetLineId: room.lineId, remainingMinor: room.remainingMinor.toString(), amountMinor: amountMinor.toString() });
  }
}
