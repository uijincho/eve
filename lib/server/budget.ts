// Budget cap enforcement. A budget line's usage is spent plus committed money:
// approved or paid claims attributed to the line (travel, ground transport,
// supplies...), and for the "prizes" line every award payout that is not
// failed or returned (held, proposed, in flight, paid or fulfilled in kind).
// Callers hold the org finance lock (lockOrgFinance), so two approvals cannot
// both see the same room. Attribution matches the snapshot's budget view.

import { and, eq, inArray, sql } from "drizzle-orm";

import type * as C from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

import { ActionError, BOOKS_CURRENCY, str, toUsd, usd, type AwardRow, type ClaimRow, type PayoutRow } from "./core";

export const PRIZE_CATEGORY = "prizes";
export const ORG_BOOKED_FLIGHT = "org_booked_flight";
export const CLAIM_COMMITTED = ["approved", "paid"] as const;

/** All amounts in the USD books; `note` records the conversion of a cap entered in another currency. */
export interface BudgetRoom { lineId: string; name: string; capMinor: bigint; usedMinor: bigint; remainingMinor: bigint; note?: string }

/** Budget category a claim draws on: every travel claim (including org-booked flights) is "travel". */
export function claimCategory(c: Pick<ClaimRow, "type" | "category">): string {
  return c.type === "travel" ? "travel" : c.category;
}

/** The line with its cap in book currency (caps are entered in the org's currency). */
async function lineFor(tx: Executor, eventId: string, category: string, lineId?: string | null) {
  const [row] = await tx.select({ line: s.budgetLine, currency: s.organization.currency }).from(s.budgetLine)
    .innerJoin(s.organization, eq(s.organization.id, s.budgetLine.orgId))
    .where(lineId ? eq(s.budgetLine.id, lineId) : and(eq(s.budgetLine.eventId, eventId), eq(s.budgetLine.category, category)));
  if (!row) return undefined;
  if (row.currency === BOOKS_CURRENCY) return { ...row.line, note: undefined };
  const fx = await toUsd(tx, row.line.capMinor, row.currency, new Date());
  return { ...row.line, capMinor: fx.usdMinor, note: `cap ${row.currency} ${usd(row.line.capMinor).replace("$", "")} converted to USD books at ${fx.fxRate}` };
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
  return { lineId: line.id, name: line.name, capMinor: line.capMinor, usedMinor, remainingMinor: line.capMinor - usedMinor, note: line.note };
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
  return { lineId: line.id, name: line.name, capMinor: line.capMinor, usedMinor, remainingMinor: line.capMinor - usedMinor, note: line.note };
}

/**
 * A budget cap (entered in the org's currency) in book currency, for views
 * that compare it with spent/committed book amounts. Same conversion the
 * guards use.
 */
export async function capInBooks(tx: Executor, capMinor: bigint, orgCurrency: string, on = new Date()): Promise<{ capMinor: bigint; note?: string }> {
  if (orgCurrency === BOOKS_CURRENCY) return { capMinor };
  const fx = await toUsd(tx, capMinor, orgCurrency, on);
  return { capMinor: fx.usdMinor, note: `${orgCurrency} cap converted at ${fx.fxRate} (${fx.fxSource})` };
}

export function overBudgetMessage(room: BudgetRoom, amountMinor: bigint, verb: string): string {
  const left = room.remainingMinor > 0n ? room.remainingMinor : 0n;
  return `${verb} ${usd(amountMinor)} would exceed the ${room.name} budget (USD books): ${usd(room.capMinor)} cap, ${usd(room.usedMinor)} already spent or committed, ${usd(left)} left${room.note ? ` (${room.note})` : ""}. Raise the ${room.name} line in Budget or reduce the amount first.`;
}

/** Throws a 409 with the line's numbers when `amountMinor` does not fit. */
export function assertFits(room: BudgetRoom | null, amountMinor: bigint, verb: string): void {
  if (room && amountMinor > room.remainingMinor) {
    throw new ActionError(409, overBudgetMessage(room, amountMinor, verb), { budgetLineId: room.lineId, remainingMinor: room.remainingMinor.toString(), amountMinor: amountMinor.toString() });
  }
}

/**
 * Spent and committed money per budget line, in book currency: what the Budget
 * screen, Slack budget alerts and the Slack digest all show. Claims count by
 * line (or category), prizes by award payout, and an award with no live payout
 * yet commits its value.
 */
export async function budgetLinesView(db: Executor, orgCurrency: string, lines: (typeof s.budgetLine.$inferSelect)[], rows: { claims: ClaimRow[]; awards: AwardRow[]; payouts: PayoutRow[] }, now = new Date()): Promise<C.BudgetLine[]> {
  const { claims, awards, payouts } = rows;
  const payoutByClaim = new Map(payouts.filter((p) => p.claimId).map((p) => [p.claimId!, p]));
  return Promise.all(lines.map(async (b) => {
    const cap = await capInBooks(db, b.capMinor, orgCurrency, now);
    let spent = 0n, committed = 0n;
    if (b.category === PRIZE_CATEGORY) {
      for (const p of payouts) {
        if (!p.awardId) continue;
        if (p.status === "paid") spent += p.grossMinor;
        else if (["held", "proposed", "approved", "processing", "frozen"].includes(p.status)) committed += p.grossMinor;
      }
      for (const a of awards) if (!payouts.some((p) => p.awardId === a.id && !["failed", "returned"].includes(p.status)) && a.status !== "paid") committed += (await toUsd(db, a.amountMinor, a.currency, now)).usdMinor;
    } else {
      for (const c of claims) {
        const matches = c.budgetLineId === b.id || (!c.budgetLineId && (c.category === b.category || (b.category === "travel" && c.type === "travel")));
        if (!matches) continue;
        const p = payoutByClaim.get(c.id);
        if (c.status === "paid" || p?.status === "paid") spent += c.usdMinor;
        else if (c.status === "approved") committed += c.usdMinor;
      }
    }
    return { id: b.id, name: b.name, capMinor: str(cap.capMinor), spentMinor: str(spent), committedMinor: str(committed), fundingSource: b.fundingSource, currency: BOOKS_CURRENCY, enteredCapMinor: str(b.capMinor), enteredCurrency: orgCurrency, fxSource: cap.note };
  }));
}
