import { inflateSync } from "node:zlib";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { startingRules } from "@/lib/engines";
import { renderFilingDraft, renderNR4Draft, renderT4ADraft } from "@/lib/pdf";

/** Inflate content streams and decode the hex strings pdf-lib draws with standard fonts. */
function drawnText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = raw.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      content = raw.slice(start, end);
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

const rule = (id: string) => {
  const r = startingRules.find((x) => x.id === id)!;
  return { id: r.id, version: r.version, verified: r.verified };
};
const base = {
  year: 2026,
  payer: { name: "Maple Hacks Society", address: "Toronto, ON", tinLast4: "0001" },
  payee: { name: "Amélie Roy", address: "Montréal, QC", country: "CA", tinLast4: "9876" },
  grossMinor: "150000",
  withholdingMinor: "0",
  payments: [{ date: "2026-10-25", description: "Best Hardware prize", grossMinor: "150000" }],
};

describe("CRA slip worksheets", () => {
  it("renders a T4A worksheet in CAD with the unverified banner from the rule record", async () => {
    expect(rule("ca-ca-prize").verified).toBe(false);
    const bytes = await renderT4ADraft({ ...base, rule: rule("ca-ca-prize") });
    const text = drawnText(bytes);
    expect(text).toContain("DRAFT, UNVERIFIED RULE, NOT FOR FILING");
    expect(text).toContain("T4A slip worksheet, tax year 2026");
    expect(text).toMatch(/has not confirmed that this T4A slip is required/);
    expect(text).toContain("Code 028 Other income (code to verify)");
    expect(text).toContain("1500.00 CAD");
    expect(text).toContain("Recipient SIN");
    expect(text).not.toMatch(/ready to file|filing-ready/i);
    expect((await PDFDocument.load(bytes)).getTitle()).toContain("T4A");
  });

  it("renders an NR4 worksheet with non-resident labels", async () => {
    const text = drawnText(await renderNR4Draft({ ...base, payee: { ...base.payee, country: "US" }, withholdingMinor: "0", rule: rule("ca-nonca-prize") }));
    expect(text).toContain("NR4 slip worksheet, tax year 2026");
    expect(text).toContain("Non-resident tax withheld");
    expect(text).toContain("DRAFT, UNVERIFIED RULE, NOT FOR FILING");
  });

  it("keeps the plain draft stamp and no warning for verified IRS rules", async () => {
    const text = drawnText(await renderFilingDraft({
      ...base, form: "1042-S", currency: "USD", box: "Income code 23", rateBps: 3000, withholdingMinor: "45000", rule: rule("us-nonus-prize"),
    }));
    expect(text).toContain("DRAFT, NOT FOR FILING");
    expect(text).not.toContain("UNVERIFIED");
    expect(text).toContain("30.00%");
  });
});
