import { and, asc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { ExportJournalEntry } from "@/lib/accounting";

/** Join only the authenticated org's immutable journal and preserve exact minor units. */
export async function loadAccountingJournal(db: Executor, orgId: string): Promise<ExportJournalEntry[]> {
  const rows = await db.select({ entry: s.journalEntry, line: s.journalLine, account: s.ledgerAccount, personName: s.person.name }).from(s.journalEntry)
    .innerJoin(s.journalLine, eq(s.journalLine.entryId, s.journalEntry.id))
    .innerJoin(s.ledgerAccount, and(eq(s.ledgerAccount.id, s.journalLine.accountId), eq(s.ledgerAccount.orgId, orgId)))
    .leftJoin(s.person, and(eq(s.person.id, s.journalLine.personId), eq(s.person.orgId, orgId)))
    .where(eq(s.journalEntry.orgId, orgId)).orderBy(asc(s.journalEntry.entryDate), asc(s.journalEntry.id), asc(s.journalLine.id));
  const entries = new Map<string, ExportJournalEntry>();
  for (const { entry, line, account, personName } of rows) {
    const item = entries.get(entry.id) ?? { id: entry.id, entryDate: entry.entryDate, memo: entry.memo, sourceType: entry.sourceType, sourceId: entry.sourceId, reversesEntryId: entry.reversesEntryId, lines: [] };
    item.lines.push({ accountCode: account.code, debitMinor: line.debitMinor.toString(), creditMinor: line.creditMinor.toString(), currency: line.currency, memo: line.memo, personName: personName ?? undefined });
    entries.set(entry.id, item);
  }
  return [...entries.values()];
}
