// Accounting export: QuickBooks Online journal-entry CSV (the documented
// fallback for the QBO sandbox push) and a native Eve ledger CSV.
//
// Pure functions over plain journal data; no database access. Every entry
// is checked to balance per currency before any row is written, so a bad
// file is never produced. See lib/accounting/README.md for import steps.
import { EngineError, currencyExponent, parseNonNegativeMinor } from "@/lib/engines/money";
import { minorToDecimalString } from "@/lib/design/money";

export interface ExportJournalLine {
  /** Eve chart-of-accounts code, e.g. "5100". */
  accountCode: string;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  memo?: string;
  personName?: string;
}

export interface ExportJournalEntry {
  id: string;
  /** YYYY-MM-DD */
  entryDate: string;
  memo: string;
  sourceType: string;
  sourceId: string;
  reversesEntryId?: string | null;
  lines: ExportJournalLine[];
}

export type QboAccountType = "Bank" | "Other Current Asset" | "Other Current Liability" | "Equity" | "Expense" | "Other Expense";

export interface QboAccount {
  code: string;
  eveName: string;
  /** Account Name to create in QBO and to use in the import. */
  qboName: string;
  type: QboAccountType;
  detailType: string;
  note?: string;
}

/**
 * Eve chart (lib/ledger CHART_OF_ACCOUNTS) → QBO accounts. Attendee payables
 * map to an Other Current Liability, not QBO's Accounts Payable, because
 * QBO requires a matching vendor on every A/P journal line.
 */
export const QBO_ACCOUNT_MAP: Record<string, QboAccount> = {
  "1000": { code: "1000", eveName: "Cash - simulated payouts", qboName: "Eve Payout Clearing", type: "Other Current Asset", detailType: "Other Current Assets", note: "Sandbox companies only." },
  "1010": { code: "1010", eveName: "Cash - Stripe test mode", qboName: "Eve Stripe Test Clearing", type: "Bank", detailType: "Cash on hand", note: "Stripe test mode. Sandbox companies only." },
  "1100": { code: "1100", eveName: "Due from sponsor", qboName: "Due from Fiscal Sponsor", type: "Other Current Asset", detailType: "Other Current Assets" },
  "2000": { code: "2000", eveName: "Accounts payable - attendees", qboName: "Eve Attendee Payables", type: "Other Current Liability", detailType: "Other Current Liabilities" },
  "2100": { code: "2100", eveName: "Withholding payable - federal", qboName: "Federal Withholding Payable", type: "Other Current Liability", detailType: "Other Current Liabilities" },
  "2110": { code: "2110", eveName: "Withholding payable - state", qboName: "State Withholding Payable", type: "Other Current Liability", detailType: "Other Current Liabilities" },
  "3000": { code: "3000", eveName: "Opening funds", qboName: "Event Opening Funds", type: "Equity", detailType: "Opening Balance Equity" },
  "5000": { code: "5000", eveName: "Travel expense", qboName: "Event Travel", type: "Expense", detailType: "Travel" },
  "5010": { code: "5010", eveName: "Other reimbursable expense", qboName: "Event Reimbursable Expenses", type: "Expense", detailType: "Other Miscellaneous Service Cost" },
  "5100": { code: "5100", eveName: "Prize expense", qboName: "Event Prizes", type: "Expense", detailType: "Other Miscellaneous Service Cost" },
  "5200": { code: "5200", eveName: "Stipend expense", qboName: "Judge and Mentor Stipends", type: "Expense", detailType: "Cost of Labor" },
  "5300": { code: "5300", eveName: "Payout fees", qboName: "Payout Fees", type: "Expense", detailType: "Bank Charges" },
  "5400": { code: "5400", eveName: "FX gain/loss", qboName: "Exchange Gain or Loss", type: "Other Expense", detailType: "Exchange Gain or Loss" },
};

export class AccountingExportError extends EngineError {
  constructor(message: string, readonly problems: string[]) {
    super("invalid_input", message);
  }
}

/** RFC 4180 quoting plus spreadsheet formula-injection guard for text cells. */
export function csvCell(value: string, { text = true } = {}): string {
  let v = value.replace(/\r\n|\r|\n/g, " ");
  if (text && /^[=+\-@\t]/.test(v)) v = `'${v}`;
  return /[",;'\t]|^\s|\s$/.test(v) || v === "" ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvRow(cells: { value: string; text?: boolean }[], delimiter: string): string {
  return cells.map((c) => csvCell(c.value, { text: c.text ?? true })).join(delimiter);
}

function formatDate(iso: string, format: "MDY" | "DMY" | "ISO"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new EngineError("invalid_input", `entryDate must be YYYY-MM-DD, got ${JSON.stringify(iso)}`);
  if (format === "ISO") return iso;
  return format === "MDY" ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

interface CheckedGroup {
  entry: ExportJournalEntry;
  currency: string;
  lines: { line: ExportJournalLine; account: QboAccount; debit: bigint; credit: bigint }[];
  total: bigint;
}

/** Validate every entry and split it into one balanced group per currency. Throws with every problem found. */
export function checkEntries(entries: readonly ExportJournalEntry[]): CheckedGroup[] {
  const problems: string[] = [];
  const groups: CheckedGroup[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: duplicate entry id`);
    seen.add(entry.id);
    if (entry.lines.length < 2) problems.push(`${entry.id}: needs at least two lines`);
    const byCurrency = new Map<string, CheckedGroup>();
    for (const [i, line] of entry.lines.entries()) {
      const where = `${entry.id} line ${i + 1}`;
      const account = QBO_ACCOUNT_MAP[line.accountCode];
      if (!account) problems.push(`${where}: account ${line.accountCode} has no QuickBooks mapping`);
      let debit = 0n;
      let credit = 0n;
      try {
        debit = parseNonNegativeMinor(line.debitMinor, "debitMinor");
        credit = parseNonNegativeMinor(line.creditMinor, "creditMinor");
        currencyExponent(line.currency);
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
        continue;
      }
      if ((debit > 0n) === (credit > 0n)) problems.push(`${where}: exactly one of debit or credit must be positive`);
      const g = byCurrency.get(line.currency) ?? { entry, currency: line.currency, lines: [], total: 0n };
      if (account) g.lines.push({ line, account, debit, credit });
      g.total += debit - credit;
      byCurrency.set(line.currency, g);
    }
    for (const g of byCurrency.values()) {
      if (g.total !== 0n) problems.push(`${entry.id}: ${g.currency} debits and credits differ by ${g.total} minor units`);
      groups.push(g);
    }
  }
  if (problems.length) throw new AccountingExportError(`Ledger export refused: ${problems.length} problem(s). ${problems.slice(0, 3).join("; ")}`, problems);
  return groups;
}

export interface QboExportOptions {
  /** QBO company home currency. Lines in other currencies need multicurrency on. */
  homeCurrency?: string;
  /** The QBO company has multicurrency enabled; adds a Currency column. */
  multicurrency?: boolean;
  /** Match the company's date format setting. */
  dateFormat?: "MDY" | "DMY" | "ISO";
  /** Comma by default; QBO on some macOS locales expects semicolons. */
  delimiter?: "," | ";";
  /** Journal No. prefix; numbers stay within QBO's 21-character limit. */
  journalPrefix?: string;
}

export interface QboExportResult {
  csv: string;
  /** Eve entry id → Journal No. written to the file. */
  journalNumbers: Record<string, string[]>;
  /** Entries left out (e.g. foreign currency without multicurrency), with the reason. */
  excluded: { entryId: string; currency: string; reason: string }[];
  /** QBO accounts the file references; create them before importing. */
  accountsUsed: QboAccount[];
  warnings: string[];
  rowCount: number;
}

export function exportQuickBooksJournalCsv(entries: readonly ExportJournalEntry[], options: QboExportOptions = {}): QboExportResult {
  const home = options.homeCurrency ?? "USD";
  const multicurrency = options.multicurrency ?? false;
  const dateFormat = options.dateFormat ?? "MDY";
  const delimiter = options.delimiter ?? ",";
  const prefix = options.journalPrefix ?? "EVE-";
  if (prefix.length > 12 || !/^[A-Za-z0-9-]*$/.test(prefix)) throw new EngineError("invalid_input", "journalPrefix must be up to 12 letters, digits or dashes");

  const groups = checkEntries(entries).sort((a, b) =>
    a.entry.entryDate.localeCompare(b.entry.entryDate) || a.entry.id.localeCompare(b.entry.id) || a.currency.localeCompare(b.currency));

  const header = ["Journal No.", "Journal Date", "Account Name", "Debits", "Credits", "Description", "Name", ...(multicurrency ? ["Currency"] : [])];
  const rows = [header.map((h) => csvCell(h)).join(delimiter)];
  const journalNumbers: Record<string, string[]> = {};
  const excluded: QboExportResult["excluded"] = [];
  const used = new Map<string, QboAccount>();
  const warnings = new Set<string>();
  let seq = 0;

  for (const g of groups) {
    if (g.currency !== home && !multicurrency) {
      excluded.push({ entryId: g.entry.id, currency: g.currency, reason: `${g.currency} lines need multicurrency in the QBO company; not converted silently.` });
      continue;
    }
    seq += 1;
    const no = `${prefix}${String(seq).padStart(6, "0")}`;
    (journalNumbers[g.entry.id] ??= []).push(no);
    const date = formatDate(g.entry.entryDate, dateFormat);
    for (const { line, account, debit, credit } of g.lines) {
      used.set(account.code, account);
      if (account.note) warnings.add(`${account.qboName}: ${account.note}`);
      const description = [
        g.entry.memo,
        line.memo,
        line.personName ? `Payee: ${line.personName}` : "",
        `Eve ${g.entry.id} (${g.entry.sourceType} ${g.entry.sourceId})`,
        g.entry.reversesEntryId ? `reverses ${g.entry.reversesEntryId}` : "",
      ].filter(Boolean).join(" | ");
      rows.push(csvRow([
        { value: no },
        { value: date, text: false },
        { value: account.qboName },
        { value: debit ? minorToDecimalString(debit, g.currency) : "", text: false },
        { value: credit ? minorToDecimalString(credit, g.currency) : "", text: false },
        { value: description },
        { value: "" },
        ...(multicurrency ? [{ value: g.currency }] : []),
      ], delimiter));
    }
  }
  if (excluded.length) warnings.add(`${excluded.length} journal group(s) excluded for currency; see excluded.`);

  return {
    csv: `${rows.join("\r\n")}\r\n`,
    journalNumbers,
    excluded,
    accountsUsed: [...used.values()].sort((a, b) => a.code.localeCompare(b.code)),
    warnings: [...warnings],
    rowCount: rows.length - 1,
  };
}

/** Accounts to create in QBO before importing journals (Settings → Import data → Accounts, or by hand). */
export function exportQuickBooksAccountsCsv(accounts: readonly QboAccount[] = Object.values(QBO_ACCOUNT_MAP)): string {
  const rows = [["Account Name", "Type", "Detail Type", "Description"].map((h) => csvCell(h)).join(",")];
  for (const a of accounts) {
    rows.push(csvRow([{ value: a.qboName }, { value: a.type }, { value: a.detailType }, { value: `Eve ${a.code} ${a.eveName}${a.note ? `. ${a.note}` : ""}` }], ","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** Native Eve ledger CSV for accountants: one row per line, integer minor units and decimal amounts. */
export function exportLedgerCsv(entries: readonly ExportJournalEntry[]): string {
  const groups = checkEntries(entries);
  const header = ["entry_id", "entry_date", "source_type", "source_id", "reverses_entry_id", "account_code", "account_name", "currency", "debit_minor", "credit_minor", "debit", "credit", "memo", "payee"];
  const rows = [header.join(",")];
  for (const g of groups.sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate) || a.entry.id.localeCompare(b.entry.id))) {
    for (const { line, account, debit, credit } of g.lines) {
      rows.push(csvRow([
        { value: g.entry.id }, { value: g.entry.entryDate, text: false }, { value: g.entry.sourceType }, { value: g.entry.sourceId },
        { value: g.entry.reversesEntryId ?? "" }, { value: account.code, text: false }, { value: account.eveName }, { value: g.currency },
        { value: debit.toString(), text: false }, { value: credit.toString(), text: false },
        { value: minorToDecimalString(debit, g.currency), text: false }, { value: minorToDecimalString(credit, g.currency), text: false },
        { value: [g.entry.memo, line.memo].filter(Boolean).join(" | ") }, { value: line.personName ?? "" },
      ], ","));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

export const QBO_IMPORT_INSTRUCTIONS = `QuickBooks Online journal import (fallback for the QBO API push)
1. Use a QBO sandbox or test company. These files contain test money.
2. Turn off account numbers (Settings > Account and settings > Advanced > Chart of accounts) during the import.
3. Create the accounts listed in the accounts CSV (Type and Detail Type columns) if they do not exist. Names must match exactly.
4. Match the company date format: the default export is MM/DD/YYYY; pass dateFormat "DMY" for DD/MM/YYYY companies.
5. Go to Settings > Import data > Journal entries, upload the journal CSV, and map Journal No., Journal Date, Account Name, Debits, Credits, Description (and Currency if multicurrency is on).
6. Review the preview, then Start import. Each Eve entry is one journal per currency, numbered EVE-000001 and up; the Description keeps the Eve entry id for tracing.
Lines in a currency other than the home currency are left out unless the company has multicurrency enabled; the export lists them instead of converting.`;
