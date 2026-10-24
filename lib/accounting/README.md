# Accounting export

The PRD's QuickBooks Online sandbox push is optional, and no Intuit credentials exist. This is the documented fallback: CSV files that a QBO company imports with its built-in journal-entry importer. Nothing here calls an external service.

## Files

| Function | File | Use |
| --- | --- | --- |
| `exportQuickBooksAccountsCsv()` | Accounts list (Account Name, Type, Detail Type, Description) | Create these accounts in QBO first; names must match exactly. |
| `exportQuickBooksJournalCsv(entries, options)` | Journal No., Journal Date, Account Name, Debits, Credits, Description, Name, [Currency] | QBO: Settings > Import data > Journal entries. |
| `exportLedgerCsv(entries)` | Native Eve ledger, one row per line, minor units and decimals | Accountant review, other systems. |

`entries` are plain journal entries (`ExportJournalEntry`): `{ id, entryDate (YYYY-MM-DD), memo, sourceType, sourceId, reversesEntryId?, lines: [{ accountCode, debitMinor, creditMinor, currency, memo?, personName? }] }`. The backend maps rows from `journal_entry` / `journal_line` / `ledger_account` into this shape.

## Guarantees

- **Refuses bad input.** Before writing anything, each entry is checked. Each currency group must balance. Each line must have exactly one positive side. Amounts must be canonical minor-unit strings. Every account code must have a mapping. Entry ids must be unique. `AccountingExportError.problems` lists every failure.
- **No silent conversion.** QBO journals are single-currency, so a mixed-currency entry is split into one balanced journal per currency. Without `multicurrency: true`, non-home-currency groups are left out and listed in `excluded`.
- **Safe cells.** Fields follow RFC 4180 quoting. Text cells that start with `= + - @` or a tab get a leading `'` so spreadsheets don't run them as formulas. Newlines are flattened.
- **Deterministic output.** Rows are ordered by date, then entry id, then currency. Journal numbers are `EVE-000001` and up, within QBO's 21-character limit, and `journalNumbers` maps each Eve entry id to its journal numbers. Each Description ends with the Eve entry id and source, so imports can be traced.
- **Account mapping** (`QBO_ACCOUNT_MAP`). Attendee payables (2000) go to an Other Current Liability, not QBO's Accounts Payable, because QBO requires a vendor on every A/P journal line. Simulated cash (1000) and Stripe test cash (1010) carry warnings: import them into sandbox or test companies only.

## Import steps

These are the same steps as `QBO_IMPORT_INSTRUCTIONS`. They follow Intuit's help article ["Import journal entries"](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US), read 2026-10-24.

1. Use a sandbox or test company.
2. Turn off account numbers during the import.
3. Create the accounts from the accounts CSV.
4. Match the date format: the default is MM/DD/YYYY; use `dateFormat: "DMY"` for DD/MM/YYYY companies.
5. Upload the journal CSV, map the columns, review the preview, and start the import.

## Gaps

- **The native importer may not be available in every QBO region or edition.** Intuit community threads disagree on this. Third-party importers accept the same columns.
- **No QBO API adapter.** No Intuit developer credentials exist, and none were requested.
- **Headers have not been checked against a live QBO import.** They follow Intuit's documented journal fields.
- **The `Name` column is left blank.** QBO rejects names that don't match an existing customer, vendor or employee, so the payee goes in the Description instead.
