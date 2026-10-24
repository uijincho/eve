// Receipt evidence: critical travel facts the receipt does not show are never
// treated as corroborated, even when the submitter typed them in.
import { describe, expect, it, vi } from "vitest";

const extraction = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/server/receipt", () => ({
  extractReceiptForDocument: async () => ({ ok: true, evidence: extraction.current }),
}));

const { prepareClaim } = await import("@/lib/server/claims");

const db = { select: () => ({ from: () => ({ where: async () => [{ id: "doc_1", personId: "per_1", uploadedBy: "mem_1" }] }) }) } as never;
const actor = { memberId: "mem_1", orgId: "org_1", role: "attendee" as const, name: "A", email: "a@example.com", personId: "per_1", demo: false, userId: null };
const full = { merchant: "Air Canada", purchasedAt: "2026-09-02", amountMinor: "48900", currency: "CAD", passengerName: "Priya Raman", travelDate: "2026-10-23", cabin: "economy", requiresReview: false, warnings: [] };

describe("prepareClaim evidence", () => {
  it("corroborates only when the receipt itself shows every critical travel fact", async () => {
    extraction.current = full;
    const ok = await prepareClaim(db, actor, { type: "travel", documentId: "doc_1", amountMinor: 48900n, currency: "CAD" });
    expect(ok.corroborated).toBe(true);
    expect(ok.missingFacts).toEqual([]);
  });

  it("keeps typed cabin, name and date for review but does not corroborate them", async () => {
    extraction.current = { ...full, passengerName: null, travelDate: null, cabin: "unknown" };
    const ev = await prepareClaim(db, actor, { type: "travel", documentId: "doc_1", cabin: "economy", nameOnReceipt: "Priya Raman", travelDate: "2026-10-23T12:00:00Z" });
    expect(ev.corroborated).toBe(false);
    expect(ev.missingFacts).toEqual(["passenger name", "travel date", "cabin"]);
    expect(ev.manualFields).toEqual(["passenger name", "travel date", "cabin"]);
  });

  it("flags typed facts that disagree with the receipt", async () => {
    extraction.current = full;
    const ev = await prepareClaim(db, actor, { type: "travel", documentId: "doc_1", cabin: "business", travelDate: "2026-10-30T00:00:00Z" });
    expect(ev.corroborated).toBe(false);
    expect(ev.mismatches.join(" ")).toMatch(/cabin.*travel date/);
  });

  it("does not require travel facts on a general expense", async () => {
    extraction.current = { ...full, passengerName: null, travelDate: null, cabin: "unknown" };
    expect((await prepareClaim(db, actor, { type: "expense", documentId: "doc_1" })).corroborated).toBe(true);
  });
});
