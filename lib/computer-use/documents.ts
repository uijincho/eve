import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { dollars, type PortalPacket } from "./packet";

/** A one-page PDF stamped as a sample, for anything the agent uploads that Eve has no stored file for. */
export async function samplePdf(title: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const ascii = (t: string) => t.replace(/[^\x20-\x7e]/g, "?");
  page.drawText("SAMPLE DOCUMENT FOR A FICTIONAL DEMO. NOT A REAL TAX FORM OR PAYMENT.", { x: 40, y: 752, size: 9, font: bold, color: rgb(0.6, 0.1, 0.1) });
  page.drawText(ascii(title), { x: 40, y: 716, size: 18, font: bold });
  lines.forEach((text, i) => page.drawText(ascii(text).slice(0, 95), { x: 40, y: 680 - i * 22, size: 12, font }));
  return pdf.save();
}

/** The lab's two files: an award letter and a sample W-8BEN for the packet's payee. */
export async function packetDocuments(p: PortalPacket): Promise<{ path: string; bytes: Uint8Array }[]> {
  const letter = await samplePdf("Award letter", [
    `Winner: ${p.payee.name} (${p.payee.country})`,
    `Award: ${p.description}`,
    `Gross award: USD ${dollars(p.grossCents)}`,
    `US federal withholding: USD ${dollars(p.withheldCents)}`,
    `Net payment: USD ${dollars(p.netCents)}`,
    `Packet: ${p.id}`,
  ]);
  const files = [{ path: p.documents.supporting, bytes: letter }];
  if (p.documents.taxForm) {
    files.push({
      path: p.documents.taxForm,
      bytes: await samplePdf("Form W-8BEN (sample)", [
        "Certificate of Foreign Status of Beneficial Owner for United States Tax Withholding",
        `1. Name of individual: ${p.payee.name}`,
        `2. Country of citizenship: ${p.payee.country}`,
        "3. Permanent residence address: (on file with Eve; not shown in this sample)",
        "6. Foreign tax identifying number: (vaulted; not shown)",
        "Signed: typed signature, sample",
      ]),
    });
  }
  return files;
}
