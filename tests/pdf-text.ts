import { decodePDFRawStream, PDFDocument, PDFRawStream, type PDFRef } from "pdf-lib";

function strings(content: string): string[] {
  // pdf-lib writes standard-font text as WinAnsi hex strings; WinAnsi matches latin1 for the characters tests use.
  return [content, ...[...content.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((m) => Buffer.from(m[1].replace(/\s+/g, ""), "hex").toString("latin1"))];
}

function decode(stream: PDFRawStream): string {
  try {
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  } catch {
    return ""; // images and other filters pdf-lib cannot decode
  }
}

/** Every stream in the file, decompressed, plus its hex strings decoded: lets tests search what a PDF prints. */
export async function pdfStrings(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) out.push(...strings(decode(object)));
  }
  return out.join("\n");
}

/** The text drawn by one page's own content streams (not XObjects it references). */
export function pageStrings(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const refs: unknown[] = contents && "asArray" in contents ? contents.asArray() : [contents];
  return refs
    .map((ref) => doc.context.lookup(ref as PDFRef))
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .flatMap((s) => strings(decode(s)))
    .join("\n");
}
