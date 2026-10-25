// Fills the official IRS Form W-8BEN (Rev. October 2021) with pdf-lib and
// appends Eve's electronic-signature record as the last page. Server only:
// the blank form is read from lib/tax/forms/fw8ben.pdf. Next's file tracer
// follows the literal path.join(process.cwd(), ...) below and ships the PDF
// with every server function that imports this module (checked in
// .next/server/app/api/actions/route.js.nft.json); keep the path literal.
//
// Full TINs never reach this renderer. Line 6a prints "On file, ending 1234";
// the number itself stays in the vault.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb, type PDFFont, type PDFForm } from "pdf-lib";

import { treatyRateText, W8BEN_INCOME_TYPE, W8BEN_REVISION } from "@/lib/tax/w8ben";

import { pdfSafe, renderTaxFormReceipt } from "./index";

export const W8BEN_TEMPLATE_PATH = path.join(process.cwd(), "lib", "tax", "forms", "fw8ben.pdf");

const P = "topmostSubform[0].Page1[0].";

/**
 * AcroForm fields of the Rev. October 2021 form, mapped from each widget's
 * position and the label in the form's XFA template (field names alone say
 * nothing). Checked by eye on a rendered copy; tests/w8ben-pdf.test.ts checks the values print.
 */
export const W8BEN_FIELDS = {
  // Part I, Identification of Beneficial Owner
  name: `${P}f_1[0]`, //               1  Name of individual who is the beneficial owner
  citizenship: `${P}f_2[0]`, //        2  Country of citizenship
  residenceStreet: `${P}f_3[0]`, //    3  Permanent residence address (street, apt. or suite no., or rural route)
  residenceCity: `${P}f_4[0]`, //      3  City or town, state or province. Include postal code
  residenceCountry: `${P}f_5[0]`, //   3  Country
  mailingStreet: `${P}f_6[0]`, //      4  Mailing address (if different from above)
  mailingCity: `${P}f_7[0]`, //        4  City or town, state or province. Include postal code
  mailingCountry: `${P}f_8[0]`, //     4  Country
  usTin: `${P}f_9[0]`, //              5  U.S. taxpayer identification number (SSN or ITIN), max 11
  foreignTin: `${P}f_10[0]`, //        6a Foreign tax identifying number
  ftinNotRequired: `${P}c1_01[0]`, //  6b Check if FTIN not legally required (checkbox)
  reference: `${P}f_11[0]`, //         7  Reference number(s)
  dateOfBirth: `${P}f_12[0]`, //       8  Date of birth (MM-DD-YYYY), max 10
  // Part II, Claim of Tax Treaty Benefits
  treatyCountry: `${P}f_13[0]`, //     9  "...is a resident of ___ within the meaning of the income tax treaty"
  treatyArticle: `${P}f_14[0]`, //     10 "...claiming the provisions of Article and paragraph ___"
  treatyRate: `${P}f_15[0]`, //        10 "...to claim a ___% rate of withholding"
  treatyIncome: `${P}f_16[0]`, //      10 "on (specify type of income): ___"
  treatyConditions1: `${P}f_17[0]`, // 10 Additional conditions, line 1 of 2
  treatyConditions2: `${P}f_18[0]`, // 10 Additional conditions, line 2 of 2
  // Part III, Certification
  capacity: `${P}c1_02[0]`, //         "I certify that I have the capacity to sign..." (checkbox)
  signature: `${P}f_20[0]`, //         Signature of beneficial owner (a signature field; Eve draws the typed name)
  signedDate: `${P}Date[0]`, //        Date (MM-DD-YYYY), max 10
  printName: `${P}f_21[0]`, //         Print name of signer
} as const;

export interface W8benData {
  /** Eve's tax profile id, printed on line 7 and on the signature record. */
  referenceNumber: string;
  legalName: string;
  /** ISO 3166 codes; printed as English country names. */
  citizenship: string;
  residenceCountry: string;
  /** Free-text permanent residence address; split into the street and city lines of line 3. */
  address: string;
  /** YYYY-MM-DD. */
  dateOfBirth?: string;
  /** Last four only (line 6a). Full TINs never reach this renderer. */
  ftinLast4?: string;
  /** Line 6b. Ignored when an FTIN is on file. */
  ftinNotRequired?: boolean;
  /** Line 9, ISO code: treaty residence. */
  treatyCountry?: string;
  /** Line 10, only when an article is claimed. `rateBps` comes from Eve's rules table and is left blank without a rule. */
  treatyClaim?: { article: string; rateBps?: number; verified: boolean };
  /** The typed signature, as typed. */
  signedName: string;
  /** ISO timestamp. */
  signedAt: string;
  signedVia?: string;
  expiresAt?: string;
}

const INK = rgb(0, 0, 0.5); // the form's own field colour (navy)
const MUTED = rgb(0.42, 0.45, 0.52);
const FIELD_SIZE = 8; // the form's default appearance size

let template: Promise<Buffer> | undefined;
function templateBytes(): Promise<Buffer> {
  template ??= readFile(W8BEN_TEMPLATE_PATH).catch((error: unknown) => {
    template = undefined;
    throw new Error(`Form W-8BEN template missing at ${W8BEN_TEMPLATE_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  });
  return template;
}

const regions = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string): string {
  try {
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** YYYY-MM-DD (or an ISO timestamp, read in UTC) to the form's MM-DD-YYYY. */
export function irsDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[2]}-${m[3]}-${m[1]}` : "";
}

const STREET_PART = /\d|^(apt|apartment|suite|ste|unit|flat|floor|fl|room|rm|building|bldg|#)\b/i;

/**
 * Eve keeps one free-text address. Line 3 wants street and unit on its first
 * line and city, region and postal code on the second. A first line break
 * splits them; otherwise the leading comma-separated parts that hold a number
 * or a unit word ("Apt 4", "Flat 2") are the street, and the rest is the city
 * line. The last part is always city line, so "Toronto, ON" is all city.
 */
export function splitAddress(address: string): { street: string; city: string } {
  const text = address.trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return { street: lines[0], city: lines.slice(1).join(", ") };
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let street = 0;
  while (street < parts.length - 1 && STREET_PART.test(parts[street])) street++;
  return { street: parts.slice(0, street).join(", "), city: parts.slice(street).join(", ") };
}

function setText(form: PDFForm, font: PDFFont, name: string, value: string | undefined) {
  if (!value) return;
  const field = form.getTextField(name);
  const text = pdfSafe(value);
  const max = field.getMaxLength();
  const clipped = max !== undefined ? text.slice(0, max) : text;
  // Shrink, never clip: long names and addresses still print in full.
  const widget = field.acroField.getWidgets()[0];
  const room = widget.getRectangle().width - 4;
  const width = font.widthOfTextAtSize(clipped, FIELD_SIZE);
  field.setText(clipped);
  field.setFontSize(width > room ? Math.max(5, Math.floor((FIELD_SIZE * room * 10) / width) / 10) : FIELD_SIZE);
}

/** Drop parts of the IRS file that a filled, flattened copy must not keep. */
function stripInteractiveParts(doc: PDFDocument) {
  // XFA: Acrobat would render the empty XFA form instead of the AcroForm values.
  doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.delete(PDFName.of("XFA"));
  // Reader usage rights: any edit invalidates them and Reader then warns.
  doc.catalog.delete(PDFName.of("Perms"));
  // Adobe's XFA version-check scripts.
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  names?.delete(PDFName.of("JavaScript"));
  if (names && names.keys().length === 0) doc.catalog.delete(PDFName.of("Names"));
}

/** The signature field has no appearance stream; remove its widget by hand (pdf-lib's removeField needs one). */
function removeSignatureField(doc: PDFDocument, form: PDFForm) {
  const field = form.getSignature(W8BEN_FIELDS.signature);
  const rect = field.acroField.getWidgets()[0].getRectangle();
  const refs = [field.ref, ...field.acroField.getWidgets().map((w) => doc.context.getObjectRef(w.dict))];
  for (const page of doc.getPages()) for (const ref of refs) if (ref) page.node.removeAnnot(ref);
  form.acroForm.removeField(field.acroField);
  return rect;
}

/**
 * The filled, flattened Form W-8BEN followed by the signature record. Only the
 * last four of the foreign TIN are printed.
 */
export async function renderW8ben(d: W8benData): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await templateBytes());
  stripInteractiveParts(doc);
  const form = doc.getForm();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const f = W8BEN_FIELDS;
  const set = (name: string, value: string | undefined) => setText(form, bold, name, value);

  // Part I. Line 4 (mailing address) and line 5 (US TIN) stay blank: Eve keeps
  // one permanent address and no US TIN for W-8BEN filers.
  const residence = splitAddress(d.address);
  set(f.name, d.legalName);
  set(f.citizenship, countryName(d.citizenship));
  set(f.residenceStreet, residence.street);
  set(f.residenceCity, residence.city);
  set(f.residenceCountry, countryName(d.residenceCountry));
  if (d.ftinLast4) set(f.foreignTin, `On file, ending ${d.ftinLast4}`);
  else if (d.ftinNotRequired) form.getCheckBox(f.ftinNotRequired).check();
  set(f.reference, d.referenceNumber);
  if (d.dateOfBirth) set(f.dateOfBirth, irsDate(d.dateOfBirth));

  // Part II.
  if (d.treatyCountry) set(f.treatyCountry, countryName(d.treatyCountry));
  if (d.treatyCountry && d.treatyClaim) {
    set(f.treatyArticle, d.treatyClaim.article);
    if (d.treatyClaim.rateBps !== undefined) set(f.treatyRate, treatyRateText(d.treatyClaim.rateBps));
    set(f.treatyIncome, W8BEN_INCOME_TYPE);
  }

  // Part III. The signer is the person on line 1 (the typed name must match it).
  form.getCheckBox(f.capacity).check();
  set(f.signedDate, irsDate(d.signedAt));
  set(f.printName, d.legalName);
  const signature = removeSignatureField(doc, form);

  form.updateFieldAppearances(bold);
  form.flatten({ updateFieldAppearances: false });

  const page = doc.getPage(0);
  const typed = pdfSafe(d.signedName);
  const room = signature.width - 4;
  const size = Math.min(11, (11 * room) / oblique.widthOfTextAtSize(typed, 11));
  page.drawText(typed, { x: signature.x + 2, y: signature.y + 2.5, size, font: oblique, color: INK });
  const note = "Signed electronically in Eve. Signature record attached.";
  const noteX = signature.x + 2 + oblique.widthOfTextAtSize(typed, size) + 8;
  if (noteX + regular.widthOfTextAtSize(note, 6) <= signature.x + signature.width) {
    page.drawText(note, { x: noteX, y: signature.y + 2.5, size: 6, font: regular, color: MUTED });
  }

  const receipt = await PDFDocument.load(await renderTaxFormReceipt({
    documentId: d.referenceNumber, formType: "W-8BEN", attachedTo: `IRS Form W-8BEN (${W8BEN_REVISION})`,
    legalName: d.legalName, citizenship: countryName(d.citizenship), residenceCountry: countryName(d.residenceCountry), address: d.address,
    dateOfBirth: d.dateOfBirth, tinLast4: d.ftinLast4, ftinNotRequired: !d.ftinLast4 && d.ftinNotRequired,
    treaty: d.treatyCountry ? {
      country: countryName(d.treatyCountry),
      article: d.treatyClaim?.article,
      rate: d.treatyClaim?.rateBps !== undefined ? `${treatyRateText(d.treatyClaim.rateBps)}%` : undefined,
      verified: d.treatyClaim?.verified ?? false,
    } : undefined,
    signedName: d.signedName, signedAt: d.signedAt, signedVia: d.signedVia, expiresAt: d.expiresAt,
  }));
  for (const copied of await doc.copyPages(receipt, receipt.getPageIndices())) doc.addPage(copied);

  doc.setTitle(pdfSafe(`Form W-8BEN ${d.referenceNumber} ${d.legalName}`));
  doc.setSubject(`IRS Form W-8BEN (${W8BEN_REVISION}) with Eve's electronic-signature record`);
  doc.setProducer("Eve");
  doc.setCreator("Eve");
  // Fixed dates keep output deterministic for the same input.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc.save();
}
