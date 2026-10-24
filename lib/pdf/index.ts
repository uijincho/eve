// PDF renderers built with pdf-lib. Inputs are plain serializable data; each
// function returns PDF bytes and touches no database or network.
//
// These are Eve-generated drafts, not the official IRS forms. Every page is
// stamped "DRAFT, NOT FOR FILING" and says so in its footer; a controller
// transcribes or files through the official channel.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { minorToDecimalString } from "@/lib/design/money";

const INK = rgb(0.11, 0.13, 0.18);
const MUTED = rgb(0.42, 0.45, 0.52);
const RULE = rgb(0.82, 0.84, 0.88);
const STAMP = rgb(0.75, 0.2, 0.2);

/** Standard fonts are WinAnsi; replace anything they cannot encode. */
export function pdfSafe(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\u0009\u000A -~ -ÿ]/g, "?");
}

function money(minor: string, currency: string): string {
  return `${minorToDecimalString(BigInt(minor), currency)} ${currency}`;
}

class Writer {
  private page!: PDFPage;
  private y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string, private stamp = "DRAFT, NOT FOR FILING") {
    this.addPage();
  }
  private addPage() {
    this.page = this.doc.addPage([612, 792]);
    this.y = 740;
    const size = 11;
    const width = this.bold.widthOfTextAtSize(this.stamp, size);
    this.page.drawText(pdfSafe(this.stamp), { x: 564 - width, y: 760, size, font: this.bold, color: STAMP });
    const footerLines = wrap(pdfSafe(this.footer), this.font, 7.5, 516);
    footerLines.forEach((line, index) => this.page.drawText(line, { x: 48, y: 36 - index * 9, size: 7.5, font: this.font, color: MUTED }));
  }
  private ensure(h: number) {
    if (this.y - h < 60) this.addPage();
  }
  title(text: string, sub?: string) {
    this.ensure(50);
    for (const line of wrap(pdfSafe(text), this.bold, 18, 516)) {
      this.ensure(22);
      this.page.drawText(line, { x: 48, y: this.y, size: 18, font: this.bold, color: INK });
      this.y -= 22;
    }
    if (sub) {
      for (const line of wrap(pdfSafe(sub), this.font, 9.5, 516)) {
        this.ensure(13);
        this.page.drawText(line, { x: 48, y: this.y, size: 9.5, font: this.font, color: MUTED });
        this.y -= 13;
      }
      this.y -= 5;
    }
  }
  section(text: string) {
    this.ensure(36);
    this.y -= 8;
    this.page.drawText(pdfSafe(text.toUpperCase()), { x: 48, y: this.y, size: 8.5, font: this.bold, color: MUTED });
    this.y -= 6;
    this.page.drawLine({ start: { x: 48, y: this.y }, end: { x: 564, y: this.y }, thickness: 0.5, color: RULE });
    this.y -= 14;
  }
  row(label: string, value: string) {
    const lines = wrap(pdfSafe(value), this.font, 10, 330);
    const labels = wrap(pdfSafe(label), this.font, 10, 170);
    const height = 14 * Math.max(lines.length, labels.length);
    this.ensure(height);
    labels.forEach((line, index) => this.page.drawText(line, { x: 48, y: this.y - 14 * index, size: 10, font: this.font, color: MUTED }));
    lines.forEach((line, index) => this.page.drawText(line, { x: 234, y: this.y - 14 * index, size: 10, font: this.font, color: INK }));
    this.y -= height;
  }
  warning(text: string) {
    for (const line of wrap(pdfSafe(text), this.bold, 10, 516)) {
      this.ensure(14);
      this.page.drawText(line, { x: 48, y: this.y, size: 10, font: this.bold, color: STAMP });
      this.y -= 14;
    }
    this.y -= 6;
  }
  para(text: string, size = 9.5) {
    for (const line of wrap(pdfSafe(text), this.font, size, 516)) {
      this.ensure(13);
      this.page.drawText(line, { x: 48, y: this.y, size, font: this.font, color: INK });
      this.y -= 13;
    }
    this.y -= 4;
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const words = paragraph.split(/\s+/).flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= width) return [word];
      const pieces: string[] = [];
      let piece = "";
      for (const char of word) {
        if (piece && font.widthOfTextAtSize(piece + char, size) > width) { pieces.push(piece); piece = ""; }
        piece += char;
      }
      return [...pieces, piece];
    });
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

async function start(title: string, footer: string, stamp?: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(title));
  doc.setProducer("Eve");
  doc.setCreator("Eve (draft generator)");
  // Fixed dates keep output deterministic for the same input.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, w: new Writer(doc, font, bold, footer, stamp) };
}

const FOOTER = "Generated by Eve from recorded data. This is not an official IRS or CRA form and has not been filed. A human controller reviews and signs all filings.";

export interface TaxFormReceiptData {
  documentId: string;
  formType: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration";
  legalName: string;
  citizenship: string;
  residenceCountry: string;
  address: string;
  dateOfBirth?: string;
  /** Last four digits only; full TINs never reach this renderer. */
  tinLast4?: string;
  treaty?: { country: string; article: string; rate: string; verified: boolean };
  signedName: string;
  signedAt: string;
  signerIp?: string;
  expiresAt?: string;
}

/** Signed-form receipt: what the attendee certified, when, and how it was signed. */
export async function renderTaxFormReceipt(d: TaxFormReceiptData): Promise<Uint8Array> {
  const { doc, w } = await start(`${d.formType} receipt ${d.documentId}`, FOOTER);
  w.title(`${d.formType} signature receipt`, `Document ${d.documentId}. Records the certification the payee made in Eve; not the IRS form itself.`);
  w.section("Payee");
  w.row("Legal name", d.legalName);
  w.row("Citizenship", d.citizenship);
  w.row("Country of residence", d.residenceCountry);
  w.row("Address", d.address);
  if (d.dateOfBirth) w.row("Date of birth", d.dateOfBirth);
  w.row("Taxpayer ID", d.tinLast4 ? `On file in vault, ending ${d.tinLast4}` : "Not provided");
  if (d.treaty) {
    w.section("Treaty claim");
    w.row("Country", d.treaty.country);
    w.row("Article", d.treaty.article);
    w.row("Claimed rate", d.treaty.rate);
    w.row("Rule status", d.treaty.verified ? "Verified" : "Unverified: held for advisor review");
  }
  w.section("Signature");
  w.row("Signed by", d.signedName);
  w.row("Signed at", d.signedAt);
  if (d.signerIp) w.row("IP address", d.signerIp);
  if (d.expiresAt) w.row("Valid until", d.expiresAt);
  w.para("The payee typed their name to sign electronically under penalties of perjury, as presented in the Eve portal.");
  return doc.save();
}

export interface PayoutPacketData {
  packetId: string;
  sponsorName: string;
  preparedAt: string;
  payee: { name: string; country: string; taxForm: string; taxStatus: string; payoutLast4?: string };
  source: { type: "claim" | "award"; id: string; description: string };
  amounts: {
    currency: string; grossMinor: string; withholdingMinor: string; feeMinor: string; netMinor: string;
    destinationCurrency: string; destinationNetMinor: string; fxRate: string; fxSource?: string;
  };
  provider: string;
  truth: string;
  rule: { id: string; version: number; verified: boolean; reportingForm?: string };
  approvals: { role: string; name: string; at: string }[];
  attachments: string[];
  instructions?: string;
}

/** Disbursement request for a fiscal sponsor or the org's own records. */
export async function renderPayoutPacket(d: PayoutPacketData): Promise<Uint8Array> {
  const { doc, w } = await start(`Payout packet ${d.packetId}`, FOOTER);
  w.title("Disbursement request", `Packet ${d.packetId} for ${d.sponsorName}, prepared ${d.preparedAt}.`);
  w.section("Payee");
  w.row("Name", d.payee.name);
  w.row("Country", d.payee.country);
  w.row("Tax form", `${d.payee.taxForm} (${d.payee.taxStatus})`);
  if (d.payee.payoutLast4) w.row("Account ending", d.payee.payoutLast4);
  w.section("Payment");
  w.row("For", `${d.source.type} ${d.source.id}: ${d.source.description}`);
  const a = d.amounts;
  w.row("Gross", money(a.grossMinor, a.currency));
  w.row("Withholding", money(a.withholdingMinor, a.currency));
  w.row("Fees", money(a.feeMinor, a.currency));
  w.row("Net to payee", money(a.netMinor, a.currency));
  if (a.destinationCurrency !== a.currency) {
    w.row("Expected received", `${money(a.destinationNetMinor, a.destinationCurrency)} at ${a.fxRate}${a.fxSource ? ` (${a.fxSource})` : ""}`);
  }
  w.row("Provider", `${d.provider} (${d.truth})`);
  w.row("Tax rule", `${d.rule.id} v${d.rule.version}${d.rule.verified ? "" : " (unverified)"}${d.rule.reportingForm ? `, reported on ${d.rule.reportingForm}` : ""}`);
  w.section("Approvals");
  if (d.approvals.length === 0) w.para("No approvals recorded.");
  for (const ap of d.approvals) w.row(ap.role, `${ap.name}, ${ap.at}`);
  w.section("Attachments");
  if (d.attachments.length === 0) w.para("None.");
  for (const f of d.attachments) w.para(`- ${f}`);
  if (d.instructions) {
    w.section("Instructions");
    w.para(d.instructions);
  }
  return doc.save();
}

export type FilingForm = "1099-MISC" | "1099-NEC" | "1042-S" | "T4A" | "NR4";

export interface FilingDraftData {
  form: FilingForm;
  year: number;
  /** For T4A/NR4 the payer id is the CRA account number; only its last four are shown. */
  payer: { name: string; address: string; tinLast4?: string };
  payee: { name: string; address: string; country: string; tinLast4?: string };
  /** USD for IRS forms, CAD for CRA slips. */
  currency: string;
  grossMinor: string;
  withholdingMinor: string;
  /** e.g. "Box 3, Other income", "Income code 23", "Code 028 Other income (to verify)". */
  box: string;
  rateBps?: number;
  exemptionCode?: string;
  rule: { id: string; version: number; verified: boolean };
  payments: { date: string; description: string; grossMinor: string }[];
}

const FORM_LABELS: Record<FilingForm, { title: string; payerId: string; payeeId: string; withheld: string; agency: "IRS" | "CRA" }> = {
  "1099-MISC": { title: "Form 1099-MISC", payerId: "Payer TIN", payeeId: "Recipient TIN", withheld: "Federal income tax withheld", agency: "IRS" },
  "1099-NEC": { title: "Form 1099-NEC", payerId: "Payer TIN", payeeId: "Recipient TIN", withheld: "Federal income tax withheld", agency: "IRS" },
  "1042-S": { title: "Form 1042-S", payerId: "Withholding agent EIN", payeeId: "Recipient TIN", withheld: "Federal tax withheld", agency: "IRS" },
  T4A: { title: "T4A slip", payerId: "Payer's account number", payeeId: "Recipient SIN", withheld: "Income tax deducted", agency: "CRA" },
  NR4: { title: "NR4 slip", payerId: "Payer or agent identification number", payeeId: "Foreign tax identification number", withheld: "Non-resident tax withheld", agency: "CRA" },
};

/**
 * Year-end information return worksheet that mirrors the form's boxes.
 * Unverified rules, and every CRA slip, get an explicit "not confirmed"
 * banner: Eve has not established that the slip is required or which box
 * applies, so the worksheet must not be filed or sent from as-is.
 */
export async function renderFilingDraft(d: FilingDraftData): Promise<Uint8Array> {
  const label = FORM_LABELS[d.form];
  const unverified = !d.rule.verified;
  const { doc, w } = await start(
    `${d.form} draft ${d.year} ${d.payee.name}`,
    FOOTER,
    unverified ? "DRAFT, UNVERIFIED RULE, NOT FOR FILING" : undefined,
  );
  w.title(
    `${label.title} worksheet, tax year ${d.year}`,
    `Worksheet of the amounts Eve recorded. Not an official ${label.agency} form; transcribe or e-file only after controller review.`,
  );
  if (unverified) {
    w.warning(
      `Unverified rule ${d.rule.id} v${d.rule.version}. Eve has not confirmed that this ${label.title} is required, which box or code applies, the threshold, or the withholding. A qualified ${label.agency === "CRA" ? "Canadian" : "US"} tax advisor must confirm before anything is filed or sent to the recipient.`,
    );
  }
  w.section("Payer");
  w.row("Name", d.payer.name);
  w.row("Address", d.payer.address);
  w.row(label.payerId, d.payer.tinLast4 ? `Ending ${d.payer.tinLast4}` : "On file");
  w.section("Recipient");
  w.row("Name", d.payee.name);
  w.row("Address", d.payee.address);
  w.row("Country", d.payee.country);
  w.row(label.payeeId, d.payee.tinLast4 ? `Ending ${d.payee.tinLast4}` : "Not provided");
  w.section("Amounts");
  w.row(d.box, money(d.grossMinor, d.currency));
  w.row(label.withheld, money(d.withholdingMinor, d.currency));
  if (d.rateBps !== undefined) w.row("Tax rate", `${(d.rateBps / 100).toFixed(2)}%`);
  if (d.exemptionCode) w.row("Exemption code", d.exemptionCode);
  w.row("Rule", `${d.rule.id} v${d.rule.version}${unverified ? " (unverified)" : ""}`);
  w.section("Payments in this total");
  for (const p of d.payments) w.row(p.date, `${money(p.grossMinor, d.currency)}  ${p.description}`);
  return doc.save();
}

type CraDraftInput = Omit<FilingDraftData, "form" | "currency" | "box"> & { currency?: string; box?: string };

/** T4A worksheet for a Canadian payer and resident (rule ca-ca-prize, unverified). */
export function renderT4ADraft(d: CraDraftInput): Promise<Uint8Array> {
  return renderFilingDraft({ ...d, form: "T4A", currency: d.currency ?? "CAD", box: d.box ?? "Code 028 Other income (code to verify)" });
}

/** NR4 worksheet for a Canadian payer and non-resident (rule ca-nonca-prize, unverified). */
export function renderNR4Draft(d: CraDraftInput): Promise<Uint8Array> {
  return renderFilingDraft({ ...d, form: "NR4", currency: d.currency ?? "CAD", box: d.box ?? "Gross income (income code to verify)" });
}

export interface Annual1042SummaryData {
  year: number;
  payerName: string;
  recipients: { name: string; country: string; grossMinor: string; withholdingMinor: string; filingId: string }[];
}

/** Reconciles saved 1042-S drafts; it does not assert that tax deposits were made. */
export async function render1042Summary(d: Annual1042SummaryData): Promise<Uint8Array> {
  const { doc, w } = await start(`1042 annual summary ${d.year}`, FOOTER);
  w.title(`1042 annual summary, tax year ${d.year}`, "Reconciliation worksheet of saved 1042-S drafts. Not an official Form 1042 or an e-filing export.");
  w.row("Withholding agent", d.payerName);
  w.row("1042-S drafts included", String(d.recipients.length));
  let gross = 0n, withheld = 0n;
  for (const recipient of d.recipients) {
    if (!/^\d+$/.test(recipient.grossMinor) || !/^\d+$/.test(recipient.withholdingMinor)) throw new Error("Summary amounts must be nonnegative integer minor units.");
    gross += BigInt(recipient.grossMinor);
    withheld += BigInt(recipient.withholdingMinor);
  }
  w.section("Recorded totals");
  w.row("Gross reportable income", money(gross.toString(), "USD"));
  w.row("Withholding recorded", money(withheld.toString(), "USD"));
  w.warning("Tax deposits are not tracked by Eve. Recorded withholding is not evidence of payment to the IRS. The controller must reconcile deposits, adjustments, exemptions and liability dates before preparing the official return.");
  w.section("Recipients and source drafts");
  if (!d.recipients.length) w.para("No saved 1042-S drafts for this year. Generate the filing packet before using this worksheet.");
  for (const recipient of d.recipients) {
    w.row(recipient.name, `${recipient.country}; gross ${money(recipient.grossMinor, "USD")}; withheld ${money(recipient.withholdingMinor, "USD")}`);
    w.row("Source filing", recipient.filingId);
  }
  return doc.save();
}
