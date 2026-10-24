import { describe, expect, it } from "vitest";

import type { AppAction } from "@/lib/contracts";
import { payloads, type ActionCall } from "@/lib/client/payloads";

// Every payload builder the UI uses, with representative input.
const calls: ActionCall[] = [
  payloads.claimReview("C-1", "reject", "Business class is outside policy"),
  payloads.claimSubmit({ type: "travel", documentId: "doc_1", origin: "YYZ", amountMinor: "67940", currency: "CAD", purchasedAt: "2026-10-03", idempotencyKey: "claim-key-123456" }),
  payloads.awardCreate({ personId: "p1", track: "First Overall", title: "MacBook Air", kind: "item", amountMinor: "129900", currency: "USD" }),
  payloads.awardCreate({ teamPersonIds: ["p1", "p2"], track: "Best Hardware", title: "Cash", kind: "cash", amountMinor: "300000" }),
  payloads.awardChoose("A-1", "cash"),
  payloads.awardSplit("team-1", [{ personId: "p1", bps: 6000 }, { personId: "p2", bps: 4000 }]),
  payloads.awardConfirm("A-1"),
  payloads.payoutPropose("A-1", "award"),
  payloads.payoutRelease(["PO-1"]),
  payloads.payoutRelease(["PO-1", "PO-2"]),
  payloads.payoutVerify("p1", "123456", "confirm"),
  payloads.payoutRetry("PO-1"),
  payloads.payoutBankChange("p1", "9902", "CAD"),
  payloads.taxSubmit({ personId: "p1", form: "W-8BEN", signature: "Priya Raman", tin: "123456789", treatyCountry: "CA" }),
  payloads.personUpdate("p1", { country: "CA", dateOfBirth: "2001-04-12", address: "Toronto, ON" }),
  payloads.peopleImport([{ name: "Sample Winner", email: "try@winners.example", country: "CA", citizenship: "CA", dateOfBirth: "1998-05-01" }]),
  payloads.sponsorCreate("PO-1"),
  payloads.sponsorSubmit("SP-1"),
  payloads.sponsorReconcile("SP-1", { acceptShortfall: true, note: "Wire fee" }),
  payloads.orgUpdate({ mode: "hybrid", agentLimitMinor: "30000", sponsorTurnaroundDays: 10 }),
  payloads.eventUpdate({ travelCapMinor: "50000", economyOnly: true }),
  payloads.budgetUpdate({ id: "b1", name: "Travel", capMinor: "6000000", fundingSource: "University" }),
  payloads.periodLock("2026-10"),
  payloads.filingsGenerate(2026),
  payloads.agentRun("all"),
  payloads.demoRun(),
  payloads.demoReset(),
  payloads.flightSearch({ origin: "YYZ", date: "2026-10-23" }),
  payloads.flightRequest({ offerId: "off_1", origin: "YYZ", carrier: "Air Canada", departAt: "2026-10-23T08:00:00Z", amountMinor: "41200", currency: "USD", cabin: "economy" }),
];

describe("action payloads", () => {
  it("never carry a role or actor", () => {
    for (const c of calls) {
      expect(Object.keys(c.payload)).not.toContain("role");
      expect(Object.keys(c.payload)).not.toContain("actor");
    }
  });

  it("drop empty optional fields", () => {
    const c = payloads.claimSubmit({ type: "expense", merchant: "" });
    expect(c.payload).toEqual({ type: "expense" });
  });

  it("certify tax submissions explicitly", () => {
    expect(payloads.taxSubmit({ personId: "p1", form: "W-9", signature: "A B" }).payload.certify).toBe(true);
  });

  // Validates against the server's strict schemas once the backend is merged.
  const schemaModules = import.meta.glob("../lib/server/action-schemas.ts");
  const load = schemaModules["../lib/server/action-schemas.ts"];
  it.skipIf(!load)("match lib/server/action-schemas.ts", async () => {
    const mod = (await load!()) as { actionSchemas: Record<AppAction, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }> };
    for (const c of calls) {
      const r = mod.actionSchemas[c.action].safeParse(c.payload);
      expect(r.success, `${c.action}: ${JSON.stringify(r.error)}`).toBe(true);
    }
  });
});
