// Double-entry ledger: postJournal, reverseEntry, lockPeriod.
//
// Posted entries are immutable; corrections are reversing entries linked to
// the original. Debits = credits per entry is enforced by a deferred
// constraint trigger in the database (lib/db/migrations/0001_ledger_integrity.sql),
// and checked here first only to give a readable error. Locked periods reject
// new entries in the database too.

import { and, eq, sql } from "drizzle-orm";

import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { accountingPeriod, journalEntry, journalLine, ledgerAccount } from "@/lib/db/schema";

export const CHART_OF_ACCOUNTS = [
  { code: "1000", name: "Cash - simulated payouts", type: "asset" },
  { code: "1010", name: "Cash - Stripe test mode", type: "asset" },
  { code: "1100", name: "Due from sponsor", type: "asset" },
  { code: "2000", name: "Accounts payable - attendees", type: "liability" },
  { code: "2100", name: "Withholding payable - federal", type: "liability" },
  { code: "2110", name: "Withholding payable - state", type: "liability" },
  { code: "3000", name: "Opening funds", type: "equity" },
  { code: "5000", name: "Travel expense", type: "expense" },
  { code: "5010", name: "Other reimbursable expense", type: "expense" },
  { code: "5100", name: "Prize expense", type: "expense" },
  { code: "5200", name: "Stipend expense", type: "expense" },
  { code: "5300", name: "Payout fees", type: "expense" },
  { code: "5400", name: "FX gain/loss", type: "expense" },
] as const;

export type AccountCode = (typeof CHART_OF_ACCOUNTS)[number]["code"];

export class LedgerError extends Error {
  constructor(public readonly code: "unbalanced" | "empty" | "locked_period" | "not_found" | "already_reversed", message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface JournalLineInput {
  account: AccountCode;
  debitMinor?: bigint;
  creditMinor?: bigint;
  currency: string;
  personId?: string | null;
  memo?: string;
}

export interface PostJournalInput {
  orgId: string;
  /** ISO date (YYYY-MM-DD); defaults to today in UTC. */
  entryDate?: string;
  memo: string;
  sourceType: string;
  sourceId: string;
  /** Unique per org. Re-posting with the same key returns the original entry. */
  idempotencyKey: string;
  createdBy: string;
  lines: JournalLineInput[];
  reversesEntryId?: string;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ensureAccounts(db: Executor, orgId: string): Promise<Map<string, string>> {
  await db
    .insert(ledgerAccount)
    .values(CHART_OF_ACCOUNTS.map((a) => ({ id: `${orgId}:${a.code}`, orgId, code: a.code, name: a.name, type: a.type })))
    .onConflictDoNothing();
  const rows = await db.select({ id: ledgerAccount.id, code: ledgerAccount.code }).from(ledgerAccount).where(eq(ledgerAccount.orgId, orgId));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Readable pre-check; the database trigger is the real enforcement. */
export function assertBalanced(lines: JournalLineInput[]): void {
  if (lines.length < 2) throw new LedgerError("empty", "A journal entry needs at least two lines.");
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    const debit = line.debitMinor ?? 0n;
    const credit = line.creditMinor ?? 0n;
    if (debit < 0n || credit < 0n || (debit > 0n) === (credit > 0n)) {
      throw new LedgerError("unbalanced", "Each line must have exactly one positive side.");
    }
    totals.set(line.currency, (totals.get(line.currency) ?? 0n) + debit - credit);
  }
  for (const [currency, diff] of totals) {
    if (diff !== 0n) throw new LedgerError("unbalanced", `Entry does not balance in ${currency} (off by ${diff}).`);
  }
}

export async function isPeriodLocked(db: Executor, orgId: string, date: string): Promise<boolean> {
  const rows = await db
    .select({ id: accountingPeriod.id })
    .from(accountingPeriod)
    .where(and(eq(accountingPeriod.orgId, orgId), eq(accountingPeriod.locked, true),
      sql`${date}::date BETWEEN ${accountingPeriod.startsOn} AND ${accountingPeriod.endsOn}`))
    .limit(1);
  return rows.length > 0;
}

/**
 * Posts a balanced entry. Must run inside a transaction (lines are only
 * accepted in the transaction that created the entry). Idempotent per key.
 */
export async function postJournal(tx: Executor, input: PostJournalInput): Promise<{ entryId: string; replayed: boolean }> {
  assertBalanced(input.lines);
  const entryDate = input.entryDate ?? today();
  const existing = await tx
    .select({ id: journalEntry.id })
    .from(journalEntry)
    .where(and(eq(journalEntry.orgId, input.orgId), eq(journalEntry.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing[0]) return { entryId: existing[0].id, replayed: true };
  if (await isPeriodLocked(tx, input.orgId, entryDate)) {
    throw new LedgerError("locked_period", `The accounting period containing ${entryDate} is locked.`);
  }
  const accounts = await ensureAccounts(tx, input.orgId);
  const entryId = newId("je");
  const inserted = await tx
    .insert(journalEntry)
    .values({
      id: entryId, orgId: input.orgId, entryDate, memo: input.memo, sourceType: input.sourceType,
      sourceId: input.sourceId, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy,
      reversesEntryId: input.reversesEntryId ?? null,
    })
    .onConflictDoNothing({ target: [journalEntry.orgId, journalEntry.idempotencyKey] })
    .returning({ id: journalEntry.id });
  if (!inserted[0]) {
    const [row] = await tx.select({ id: journalEntry.id }).from(journalEntry)
      .where(and(eq(journalEntry.orgId, input.orgId), eq(journalEntry.idempotencyKey, input.idempotencyKey)));
    return { entryId: row.id, replayed: true };
  }
  await tx.insert(journalLine).values(input.lines.map((line) => ({
    id: newId("jl"), entryId, accountId: accounts.get(line.account)!, debitMinor: line.debitMinor ?? 0n,
    creditMinor: line.creditMinor ?? 0n, currency: line.currency, personId: line.personId ?? null, memo: line.memo ?? "",
  })));
  return { entryId, replayed: false };
}

/** Posts the mirror image of an entry, linked to it. An entry can be reversed once. */
export async function reverseEntry(tx: Executor, input: { orgId: string; entryId: string; createdBy: string; memo: string; entryDate?: string }) {
  const [original] = await tx.select().from(journalEntry)
    .where(and(eq(journalEntry.id, input.entryId), eq(journalEntry.orgId, input.orgId)));
  if (!original) throw new LedgerError("not_found", "Journal entry not found.");
  const already = await tx.select({ id: journalEntry.id }).from(journalEntry).where(eq(journalEntry.reversesEntryId, original.id)).limit(1);
  if (already[0]) throw new LedgerError("already_reversed", "This entry has already been reversed.");
  const lines = await tx
    .select({ code: ledgerAccount.code, debit: journalLine.debitMinor, credit: journalLine.creditMinor, currency: journalLine.currency, personId: journalLine.personId, memo: journalLine.memo })
    .from(journalLine)
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, journalLine.accountId))
    .where(eq(journalLine.entryId, original.id));
  return postJournal(tx, {
    orgId: input.orgId, entryDate: input.entryDate, memo: input.memo, sourceType: original.sourceType,
    sourceId: original.sourceId, idempotencyKey: `reversal:${original.id}`, createdBy: input.createdBy,
    reversesEntryId: original.id,
    lines: lines.map((l) => ({ account: l.code as AccountCode, debitMinor: l.credit, creditMinor: l.debit, currency: l.currency, personId: l.personId, memo: l.memo })),
  });
}

/** Locks a calendar month (YYYY-MM). Locks are one-way (enforced in SQL). */
export async function lockPeriod(tx: Executor, input: { orgId: string; month: string; lockedBy: string }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new LedgerError("not_found", "Period must be YYYY-MM.");
  const [y, m] = input.month.split("-").map(Number);
  const startsOn = `${input.month}-01`;
  const endsOn = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  await tx.insert(accountingPeriod)
    .values({ id: newId("per"), orgId: input.orgId, startsOn, endsOn, locked: true, lockedBy: input.lockedBy, lockedAt: new Date() })
    .onConflictDoUpdate({ target: [accountingPeriod.orgId, accountingPeriod.startsOn], set: { locked: true, lockedBy: input.lockedBy, lockedAt: new Date() } });
  return { startsOn, endsOn };
}

export async function trialBalance(db: Executor, orgId: string) {
  return db
    .select({
      code: ledgerAccount.code, name: ledgerAccount.name, currency: journalLine.currency,
      debitMinor: sql<string>`coalesce(sum(${journalLine.debitMinor}), 0)::text`,
      creditMinor: sql<string>`coalesce(sum(${journalLine.creditMinor}), 0)::text`,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.entryId))
    .innerJoin(ledgerAccount, eq(ledgerAccount.id, journalLine.accountId))
    .where(eq(journalEntry.orgId, orgId))
    .groupBy(ledgerAccount.code, ledgerAccount.name, journalLine.currency)
    .orderBy(ledgerAccount.code);
}
