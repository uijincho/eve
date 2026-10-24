/** Explicit live-API smoke check using a synthetic receipt. Never run as part of unit tests. */
import { strict as assert } from "node:assert";

import { loadEnvConfig } from "@next/env";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { extractReceipt } from "../lib/agent/receipt";

loadEnvConfig(process.cwd());

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const lines = [
    "SYNTHETIC DEMO RECEIPT - NO REAL TRANSACTION",
    "Maple Air", "Passenger: Priya Raman", "Purchased: 2026-10-03",
    "Flight date: 2026-10-24", "From: YYZ", "To: SFO", "Cabin: Economy",
    "Total paid: CAD 679.40", "Payment status: PAID",
  ];
  lines.forEach((text, index) => page.drawText(text, { x: 40, y: 740 - index * 28, size: 14, font }));
  const result = await extractReceipt({ bytes: await pdf.save(), mimeType: "application/pdf", fileName: "synthetic-receipt.pdf" });
  assert.equal(result.amountMinor, "67940");
  assert.equal(result.currency, "CAD");
  assert.equal(result.purchasedAt, "2026-10-03");
  assert.equal(result.passengerName, "Priya Raman");
  assert.equal(result.cabin, "economy");
  console.log(JSON.stringify({ ok: true, model: result.model, amountMinor: result.amountMinor, currency: result.currency, confidence: result.confidence, requiresReview: result.requiresReview }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Receipt verification failed");
  process.exitCode = 1;
});
