import { readFile } from "node:fs/promises";

import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderTaxFormReceipt } from "@/lib/pdf";
import { irsDate, renderW8ben, splitAddress, W8BEN_TEMPLATE_PATH, type W8benData } from "@/lib/pdf/w8ben";

import { pageStrings, pdfStrings } from "./pdf-text";

const fixture: W8benData = {
  referenceNumber: "tax_fixture_0001",
  legalName: "Zoë Tremblay",
  citizenship: "CA",
  residenceCountry: "CA",
  address: "88 Queen St W, Apt 1204, Toronto, ON M5H 2N2",
  dateOfBirth: "2001-04-12",
  ftinLast4: "4321",
  treatyCountry: "CA",
  treatyClaim: { article: "Article XXII", rateBps: 0, verified: false },
  signedName: "Zoë Tremblay",
  signedAt: "2026-10-25T14:00:00.000Z",
  signedVia: "Eve portal, signed in as Zoë Tremblay (attendee)",
  expiresAt: "2029-12-31T23:59:59.000Z",
};

describe("official Form W-8BEN", () => {
  it("fills and flattens the IRS form, then appends the signature record", async () => {
    const bytes = await renderW8ben(fixture);
    const doc = await PDFDocument.load(bytes);
    const irs = await PDFDocument.load(await readFile(W8BEN_TEMPLATE_PATH), { updateMetadata: false });
    const record = await PDFDocument.load(await renderTaxFormReceipt({
      documentId: fixture.referenceNumber, formType: "W-8BEN", attachedTo: "IRS Form W-8BEN (Rev. October 2021)", legalName: fixture.legalName,
      citizenship: "Canada", residenceCountry: "Canada", address: fixture.address, dateOfBirth: fixture.dateOfBirth, tinLast4: "4321",
      treaty: { country: "Canada", article: "Article XXII", rate: "0%", verified: false }, signedName: fixture.signedName, signedAt: fixture.signedAt,
      signedVia: fixture.signedVia, expiresAt: fixture.expiresAt,
    }));
    expect(irs.getPageCount()).toBe(1);
    expect(doc.getPageCount()).toBe(irs.getPageCount() + record.getPageCount());

    // Flattened: no fields left to edit, and nothing that would re-render the blank form.
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(PDFName.of("XFA")) ?? false).toBe(false);
    expect(doc.catalog.has(PDFName.of("Perms"))).toBe(false);

    const text = await pdfStrings(bytes);
    for (const value of [
      "Zoë Tremblay", // line 1, signature, print name
      "Canada", // lines 2, 3 and 9
      "88 Queen St W, Apt 1204", // line 3 street
      "Toronto, ON M5H 2N2", // line 3 city
      "On file, ending 4321", // line 6a, masked
      "tax_fixture_0001", // line 7
      "04-12-2001", // line 8
      "Article XXII", // line 10
      "Prize and award income", // line 10
      "10-25-2026", // Part III date
    ]) expect(text).toContain(value);
    expect(pageStrings(doc, doc.getPageCount() - 1)).toContain("Electronic signature record");
    expect(pageStrings(doc, doc.getPageCount() - 1)).toContain("Unverified: held for advisor review");
  });

  it("never prints more than the last four of the foreign TIN", async () => {
    const text = await pdfStrings(await renderW8ben(fixture));
    expect(text).toContain("ending 4321");
    expect(text).not.toMatch(/\d{5,}4321/);
    expect(text).not.toMatch(/[0-9•*X-]{2,}4321/);
  });

  it("is deterministic for the same input", async () => {
    const [a, b] = await Promise.all([renderW8ben(fixture), renderW8ben(fixture)]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("checks line 6b and leaves Part II blank without a TIN or treaty claim", async () => {
    const text = await pdfStrings(await renderW8ben({ ...fixture, address: "Toronto, ON", ftinLast4: undefined, ftinNotRequired: true, treatyCountry: undefined, treatyClaim: undefined }));
    expect(text).toContain("Not legally required (line 6b checked)");
    expect(text).not.toContain("On file, ending");
    expect(text).not.toContain("Prize and award income");
    expect(text).not.toContain("Treaty claim".toUpperCase());
  });

  it("splits a free-text address into line 3's street and city lines", () => {
    expect(splitAddress("88 Queen St W, Apt 1204, Toronto, ON M5H 2N2")).toEqual({ street: "88 Queen St W, Apt 1204", city: "Toronto, ON M5H 2N2" });
    expect(splitAddress("Flat 2, 10 Downing St, London SW1A 2AA")).toEqual({ street: "Flat 2, 10 Downing St", city: "London SW1A 2AA" });
    expect(splitAddress("Hauptstraße 5, 80331 München")).toEqual({ street: "Hauptstraße 5", city: "80331 München" });
    expect(splitAddress("Toronto, ON")).toEqual({ street: "", city: "Toronto, ON" });
    expect(splitAddress("12 MG Road\nBengaluru, Karnataka 560001")).toEqual({ street: "12 MG Road", city: "Bengaluru, Karnataka 560001" });
  });

  it("prints dates as MM-DD-YYYY", () => {
    expect(irsDate("2001-04-12")).toBe("04-12-2001");
    expect(irsDate("2026-10-25T23:59:59.000Z")).toBe("10-25-2026");
    expect(irsDate("not a date")).toBe("");
  });
});

describe("signature receipt for forms Eve does not fill", () => {
  it("stays a standalone receipt that says it is not the IRS form", async () => {
    const bytes = await renderTaxFormReceipt({
      documentId: "tax_w9", formType: "W-9", legalName: "Sam Ortiz", citizenship: "US", residenceCountry: "US", address: "Oakland, CA",
      tinLast4: "5521", signedName: "Sam Ortiz", signedAt: "2026-10-25T14:00:00.000Z",
    });
    const text = await pdfStrings(bytes);
    expect(text).toContain("W-9 signature receipt");
    expect(text).toContain("not the IRS form itself");
    expect(text).toContain("DRAFT, NOT FOR FILING");
    expect(text).not.toContain("Electronic signature record");
  });
});
