import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { DEMO_PACKET, dollars } from "./packet";

async function onePager(title: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText("SAMPLE DOCUMENT FOR A FICTIONAL DEMO. NOT A REAL TAX FORM OR PAYMENT.", { x: 40, y: 752, size: 9, font: bold, color: rgb(0.6, 0.1, 0.1) });
  page.drawText(title, { x: 40, y: 716, size: 18, font: bold });
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 680 - i * 22, size: 12, font }));
  return pdf.save();
}

/** The two files the agent attaches on the portal's Documents page. */
export async function packetDocuments(): Promise<{ path: string; bytes: Uint8Array }[]> {
  const p = DEMO_PACKET;
  const [letter, w8] = await Promise.all([
    onePager("Cal Hacks 13.0 award letter", [
      `Winner: ${p.payee.name} (${p.payee.country})`,
      `Award: ${p.prize}`,
      `Gross award: USD ${dollars(p.grossCents)}`,
      `US federal withholding: USD ${dollars(p.withheldCents)}`,
      `Net payment: USD ${dollars(p.netCents)}`,
      `Packet: ${p.id}`,
    ]),
    onePager("Form W-8BEN (sample)", [
      "Certificate of Foreign Status of Beneficial Owner for United States Tax Withholding",
      `1. Name of individual: ${p.payee.name}`,
      `2. Country of citizenship: ${p.payee.country}`,
      "3. Permanent residence address: (on file with Eve; not shown in this sample)",
      "6. Foreign tax identifying number: (vaulted; not shown)",
      "9. Treaty claim: Canada (rate unverified; 30% default applied)",
      "Signed: 2026-10-19 (typed signature, sample)",
    ]),
  ]);
  return [
    { path: p.documents.supporting, bytes: letter },
    { path: p.documents.taxForm, bytes: w8 },
  ];
}
