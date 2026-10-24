import { describe, expect, it } from "vitest";

import {
  AccountingExportError, QBO_ACCOUNT_MAP, csvCell, exportLedgerCsv, exportQuickBooksAccountsCsv, exportQuickBooksJournalCsv,
  type ExportJournalEntry,
} from "@/lib/accounting";
import { CHART_OF_ACCOUNTS } from "@/lib/ledger";

const prize: ExportJournalEntry = {
  id: "je_prize", entryDate: "2026-10-25", memo: "First Overall prize, Marcus Lee", sourceType: "award", sourceId: "a1",
  lines: [
    { accountCode: "5100", debitMinor: "100000", creditMinor: "0", currency: "USD" },
    { accountCode: "2100", debitMinor: "0", creditMinor: "30000", currency: "USD" },
    { accountCode: "2000", debitMinor: "0", creditMinor: "70000", currency: "USD", personName: "Marcus Lee" },
  ],
};
const payout: ExportJournalEntry = {
  id: "je_pay", entryDate: "2026-10-26", memo: "=HYPERLINK(\"http://evil\")", sourceType: "payout", sourceId: "p1",
  lines: [
    { accountCode: "2000", debitMinor: "70000", creditMinor: "0", currency: "USD" },
    { accountCode: "5300", debitMinor: "375", creditMinor: "0", currency: "USD" },
    { accountCode: "1010", debitMinor: "0", creditMinor: "70375", currency: "USD" },
  ],
};
const cad: ExportJournalEntry = {
  id: "je_cad", entryDate: "2026-10-26", memo: "CAD reimbursement", sourceType: "claim", sourceId: "c9",
  lines: [
    { accountCode: "5000", debitMinor: "48900", creditMinor: "0", currency: "CAD" },
    { accountCode: "2000", debitMinor: "0", creditMinor: "48900", currency: "CAD" },
  ],
};

function parse(csv: string) {
  return csv.trim().split("\r\n").map((r) => r.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));
}

describe("QuickBooks CSV export", () => {
  it("maps every ledger account in the chart", () => {
    for (const a of CHART_OF_ACCOUNTS) expect(QBO_ACCOUNT_MAP[a.code], a.code).toBeDefined();
  });

  it("writes balanced journals whose debits equal credits per journal number", () => {
    const r = exportQuickBooksJournalCsv([payout, prize]);
    expect(r.journalNumbers).toEqual({ je_prize: ["EVE-000001"], je_pay: ["EVE-000002"] });
    const rows = parse(r.csv);
    expect(rows[0]).toEqual(["Journal No.", "Journal Date", "Account Name", "Debits", "Credits", "Description", "Name"]);
    const totals = new Map<string, number>();
    for (const row of rows.slice(1)) {
      const cents = Math.round(Number(row[3] || 0) * 100) - Math.round(Number(row[4] || 0) * 100);
      totals.set(row[0], (totals.get(row[0]) ?? 0) + cents);
    }
    expect([...totals.values()]).toEqual([0, 0]);
    expect(rows[1].slice(0, 5)).toEqual(["EVE-000001", "10/25/2026", "Event Prizes", "1000.00", ""]);
    expect(r.rowCount).toBe(6);
    expect(r.warnings.join(" ")).toMatch(/test mode/i);
    expect(r.accountsUsed.map((a) => a.code)).toEqual(["1010", "2000", "2100", "5100", "5300"]);
  });

  it("neutralizes spreadsheet formulas and quotes safely", () => {
    const r = exportQuickBooksJournalCsv([payout]);
    expect(r.csv).toContain(`"'=HYPERLINK(""http://evil"") | Eve je_pay (payout p1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("a\nb")).toBe("a b");
    expect(csvCell("x,y")).toBe(`"x,y"`);
    expect(csvCell("plain")).toBe("plain");
  });

  it("refuses unbalanced, one-sided, unmapped or malformed entries without writing a file", () => {
    const bad: ExportJournalEntry = { ...prize, id: "je_bad", lines: [...prize.lines.slice(0, 2), { accountCode: "2000", debitMinor: "0", creditMinor: "69999", currency: "USD" }] };
    expect(() => exportQuickBooksJournalCsv([bad])).toThrow(AccountingExportError);
    const both: ExportJournalEntry = { ...cad, id: "je_both", lines: [{ ...cad.lines[0], creditMinor: "1" }, cad.lines[1]] };
    const unmapped: ExportJournalEntry = { ...cad, id: "je_map", currency: undefined, lines: [{ ...cad.lines[0], accountCode: "9999" }, cad.lines[1]] } as ExportJournalEntry;
    const malformed: ExportJournalEntry = { ...cad, id: "je_mal", lines: [{ ...cad.lines[0], debitMinor: "489.00" }, cad.lines[1]] };
    try {
      exportQuickBooksJournalCsv([both, unmapped, malformed, { ...cad }, { ...cad }]);
      expect.unreachable();
    } catch (e) {
      const problems = (e as AccountingExportError).problems.join("\n");
      expect(problems).toMatch(/je_both line 1: exactly one/);
      expect(problems).toMatch(/je_map line 1: account 9999/);
      expect(problems).toMatch(/je_mal line 1: debitMinor/);
      expect(problems).toMatch(/je_cad: duplicate entry id/);
    }
  });

  it("does not silently convert foreign-currency entries", () => {
    const r = exportQuickBooksJournalCsv([prize, cad]);
    expect(r.excluded).toEqual([{ entryId: "je_cad", currency: "CAD", reason: expect.stringMatching(/multicurrency/) }]);
    const multi = exportQuickBooksJournalCsv([prize, cad], { multicurrency: true, dateFormat: "DMY" });
    const rows = parse(multi.csv);
    expect(rows[0].at(-1)).toBe("Currency");
    expect(rows.find((x) => x[0] === "EVE-000001")?.[1]).toBe("25/10/2026");
    expect(rows.filter((x) => x.at(-1) === "CAD")).toHaveLength(2);
  });

  it("splits a mixed-currency entry into one balanced journal per currency", () => {
    const mixed: ExportJournalEntry = { ...prize, id: "je_mix", lines: [...prize.lines, ...cad.lines] };
    const r = exportQuickBooksJournalCsv([mixed], { multicurrency: true });
    expect(r.journalNumbers.je_mix).toEqual(["EVE-000001", "EVE-000002"]);
  });

  it("exports the account list and a native ledger CSV in minor units", () => {
    expect(exportQuickBooksAccountsCsv().split("\r\n")[0]).toBe("Account Name,Type,Detail Type,Description");
    const ledger = parse(exportLedgerCsv([prize]));
    expect(ledger[1]).toEqual(["je_prize", "2026-10-25", "award", "a1", "", "5100", "Prize expense", "USD", "100000", "0", "1000.00", "0.00", "First Overall prize, Marcus Lee", ""]);
  });
});
