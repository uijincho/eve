// Narrow hook from claims to receipt extraction (lib/agent/receipt.ts, owned by
// the coordinator). Extraction reads facts only; checks and money stay here.

import { and, eq } from "drizzle-orm";

import { extractReceipt, ReceiptExtractionError, type ExtractedReceipt } from "@/lib/agent/receipt";
import type { Executor } from "@/lib/db";
import { document } from "@/lib/db/schema";

export type ReceiptEvidence = Pick<ExtractedReceipt,
  "merchant" | "purchasedAt" | "amountMinor" | "currency" | "passengerName" | "travelDate" | "origin" | "destination" |
  "cabin" | "category" | "description" | "confidence" | "warnings" | "receiptHash" | "model" | "requiresReview" | "documentKind">;

export type ExtractionResult = { ok: true; evidence: ReceiptEvidence } | { ok: false; error: string };

/** Loads an org-scoped document and extracts receipt facts. Never throws for extraction failures. */
export async function extractReceiptForDocument(db: Executor, orgId: string, documentId: string): Promise<ExtractionResult> {
  const [doc] = await db.select({ bytes: document.bytes, mimeType: document.mimeType, name: document.name })
    .from(document).where(and(eq(document.id, documentId), eq(document.orgId, orgId)));
  if (!doc) return { ok: false, error: "Document not found." };
  try {
    const r = await extractReceipt({ bytes: new Uint8Array(doc.bytes), mimeType: doc.mimeType, fileName: doc.name });
    return {
      ok: true,
      evidence: {
        merchant: r.merchant, purchasedAt: r.purchasedAt, amountMinor: r.amountMinor, currency: r.currency, passengerName: r.passengerName,
        travelDate: r.travelDate, origin: r.origin, destination: r.destination, cabin: r.cabin, category: r.category,
        description: r.description, confidence: r.confidence, warnings: r.warnings, receiptHash: r.receiptHash, model: r.model,
        requiresReview: r.requiresReview, documentKind: r.documentKind,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof ReceiptExtractionError ? error.message : "The receipt could not be read." };
  }
}
