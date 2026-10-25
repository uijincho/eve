import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildBatchBundle, batchBrief, canonical, matchesBatchImport, zipFiles } from "@/lib/computer-use/batch-packet";
import { DEMO_PACKET } from "@/lib/computer-use/packet";

function loaded(n = 1) {
  return Array.from({ length: n }, (_, i) => ({
    packet: { ...DEMO_PACKET, id: `sp-${i}`, payee: { ...DEMO_PACKET.payee, name: `Payee ${i}` } },
    documents: [DEMO_PACKET.documents.supporting, DEMO_PACKET.documents.taxForm!].map((path) => ({ path, bytes: Buffer.from("%PDF-1.7\nsynthetic fixture\n") })),
  }));
}
function portalImport(bytes: Buffer) {
  return JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'lab/westbrook-portal');from bulk import import_bundle;print(json.dumps(import_bundle(sys.stdin.buffer.read())))"], { input: bytes, stdio: ["pipe", "pipe", "pipe"] }).toString());
}
describe("one bundle for a batch", () => {
  it("round-trips 50 recipients through the real Python portal validator, with a constant-size agent brief", () => {
    const b = buildBatchBundle("batch-50", loaded(50));
    const imported = portalImport(b.bytes);
    expect(imported.manifest.payments).toHaveLength(50);
    expect(imported.manifest.documents).toHaveLength(100);
    expect(imported.manifest.totals).toEqual({ count: 50, grossCents: 5000000, withheldCents: 1500000, netCents: 3500000 });
    expect(matchesBatchImport(imported, b.manifestHash, JSON.parse(canonical(b.manifest)))).toBe(true);
    expect(batchBrief(b.manifest).length).toBeLessThan(1000);
    expect(batchBrief(b.manifest)).not.toContain("Payee 0");
  });
  it("refuses an empty batch, duplicate packet, missing PDF and invalid arithmetic", () => {
    expect(() => buildBatchBundle("b", [])).toThrow();
    const one = loaded()[0];
    expect(() => buildBatchBundle("b", [one, one])).toThrow(/twice/);
    expect(() => buildBatchBundle("b", [{ ...one, documents: [] }])).toThrow(/Missing PDF/);
    expect(() => buildBatchBundle("b", [{ ...one, packet: { ...one.packet, netCents: 1 } }])).toThrow(/amounts/);
  });
  it("refuses a changed import even when its reported total matches", () => {
    const b = buildBatchBundle("b", loaded());
    const changed = structuredClone(b.manifest); changed.payments[0].email = "changed@example.test";
    expect(matchesBatchImport({ batchId: "b", manifestHash: b.manifestHash, manifest: changed }, b.manifestHash, b.manifest)).toBe(false);
    expect(matchesBatchImport({ batchId: "b", manifestHash: "wrong", manifest: b.manifest }, b.manifestHash, b.manifest)).toBe(false);
  });
  it("the Python validator refuses tampered totals and unsafe ZIP paths", () => {
    const b = buildBatchBundle("b", loaded());
    const bad = zipFiles([{ name: "../manifest.json", bytes: Buffer.from(JSON.stringify(b.manifest)) }]);
    expect(() => portalImport(bad)).toThrow();
    const code = "import sys,json,io,zipfile;sys.path.insert(0,'lab/westbrook-portal');from bulk import import_bundle;a=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));m=json.loads(a.read('manifest.json'));m['totals']['netCents']+=1;out=io.BytesIO();z=zipfile.ZipFile(out,'w');[z.writestr(n,json.dumps(m) if n=='manifest.json' else a.read(n)) for n in a.namelist()];z.close();import_bundle(out.getvalue())";
    expect(() => execFileSync("python3", ["-c", code], { input: b.bytes, stdio: ["pipe", "pipe", "pipe"] })).toThrow();
  });
});
