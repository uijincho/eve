/** Bulk portal contract. All arithmetic, documents and fingerprints are produced without an LLM. */
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { PACKET_DIR, PORTAL_URL, PORTAL_USERNAME, type PortalPacket } from "./packet";

export const BATCH_FILE = `${PACKET_DIR}/batch.zip`;
export const MAX_BATCH_SIZE = 200;
export interface BatchPayment {
  packetId: string; name: string; email: string; country: string; requestType: string;
  grossCents: number; withheldCents: number; netCents: number; accountCode: string;
  method: string; purpose: string; supportingDocument: string; taxForm: string | null;
}
export interface BatchManifest {
  version: 1; batchId: string; currency: "USD"; payments: BatchPayment[];
  totals: { count: number; grossCents: number; withheldCents: number; netCents: number };
  documents: { name: string; sha256: string }[];
}
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Store-only ZIP: PDFs are already compressed. UTF-8 names, CRCs and central directory; no shell or temp files. */
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.bytes), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function buildBatchBundle(batchId: string, loaded: { packet: PortalPacket; documents: { path: string; bytes: Uint8Array }[] }[]) {
  if (!loaded.length || loaded.length > MAX_BATCH_SIZE) throw new Error(`Choose 1–${MAX_BATCH_SIZE} payouts.`);
  if (new Set(loaded.map((x) => x.packet.id)).size !== loaded.length) throw new Error("A packet occurs twice in the batch.");
  const documents: { name: string; bytes: Uint8Array }[] = [];
  const payments = loaded.map(({ packet: p, documents: source }, i): BatchPayment => {
    const add = (path: string | null) => {
      if (!path) return null;
      const doc = source.find((d) => d.path === path);
      if (!doc || !Buffer.from(doc.bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`Missing PDF for ${p.payee.name}.`);
      const name = `documents/${i + 1}-${path.split("/").pop()}`;
      documents.push({ name, bytes: doc.bytes }); return name;
    };
    return { packetId: p.id, name: p.payee.name, email: p.payee.email, country: p.payee.country, requestType: p.requestType,
      grossCents: p.grossCents, withheldCents: p.withheldCents, netCents: p.netCents, accountCode: p.accountCode.split(" ")[0],
      method: p.paymentMethod, purpose: p.purpose, supportingDocument: add(p.documents.supporting)!, taxForm: add(p.documents.taxForm) };
  });
  const totals = { count: payments.length, grossCents: 0, withheldCents: 0, netCents: 0 };
  for (const p of payments) for (const key of ["grossCents", "withheldCents", "netCents"] as const) {
    if (!Number.isSafeInteger(p[key]) || p[key] < 0 || p.grossCents - p.withheldCents !== p.netCents) throw new Error("Invalid payment amounts.");
    totals[key] += p[key]; if (!Number.isSafeInteger(totals[key])) throw new Error("Batch total exceeds the portal limit.");
  }
  const manifest: BatchManifest = { version: 1, batchId, currency: "USD", payments, totals, documents: documents.map((d) => ({ name: d.name, sha256: sha256(d.bytes) })) };
  const json = JSON.stringify(manifest);
  const bytes = zipFiles([{ name: "manifest.json", bytes: Buffer.from(json) }, ...documents]);
  if (bytes.length > 30_000_000) throw new Error("Batch documents exceed 30 MB. Release a smaller batch.");
  return { manifest, manifestHash: sha256(json), bytes };
}

export function batchBrief(m: BatchManifest): string {
  return `Bulk payment batch ${m.batchId}\nPortal: ${PORTAL_URL}\nUsername: ${PORTAL_USERNAME}; use type_portal_password.\nUpload ${BATCH_FILE} using “Bulk payment request”. This ZIP contains every recipient and document; do not enter individual payments.\nExpected: ${m.totals.count} payments, USD ${(m.totals.netCents / 100).toFixed(2)} net.\nStop on Review. Eve's code will validate the complete imported manifest against the controller-authorized batch before allowing submission. After authorization, click “Submit batch” once and report its confirmation. If validation fails, escalate; do not change the bundle.`;
}

/** JSONB reorders keys; compare content independently of serialization order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function matchesBatchImport(record: Record<string, unknown>, manifestHash: string, manifest: BatchManifest): boolean {
  return record.batchId === manifest.batchId && record.manifestHash === manifestHash && canonical(record.manifest) === canonical(manifest);
}
