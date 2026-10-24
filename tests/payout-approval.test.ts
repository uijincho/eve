import { describe, expect, it } from "vitest";
import { assertControllerApproval, payoutQuoteFingerprint } from "../lib/agent/payout-approval";

const quote = {
  id: "pay_1", orgId: "org_1", personId: "person_1", grossMinor: 100000n, withholdingMinor: 30000n, feeMinor: 500n,
  netMinor: 70000n, currency: "USD", destinationCurrency: "CAD", destinationNetMinor: 98000n, fxRate: "1.40000000",
  provider: "mock_wire", payoutMethodId: "method_1", bankVersion: 1, ruleId: "us-nonus-prize", ruleVersion: 1,
  requestedBy: "organizer_1", idempotencyKey: "payout:award:1",
  ruleVerified: true, reportingForm: "1042-S", reportable: true, createdAt: new Date("2026-10-24T10:00:00Z"),
};

describe("controller approval scope", () => {
  it("binds approval to bank details, monetary terms, tax rule and requester", () => {
    const original = payoutQuoteFingerprint(quote);
    expect(payoutQuoteFingerprint({ ...quote })).toBe(original);
    for (const change of [{ bankVersion: 2 }, { payoutMethodId: "new-bank" }, { netMinor: 71000n }, { destinationNetMinor: 95000n }, { ruleVersion: 2 }, { requestedBy: "someone-else" }, { reportable: false }, { ruleVerified: false }, { createdAt: new Date("2026-10-24T11:00:00Z") }]) {
      expect(payoutQuoteFingerprint({ ...quote, ...change })).not.toBe(original);
    }
  });
  it("rejects agents, organizers, cross-org releases, self-approval and frozen quotes", () => {
    const payout = { orgId: "org_1", personId: "person_1", requestedBy: "organizer_1", status: "proposed" as const };
    const controller = { orgId: "org_1", personId: null, memberId: "controller_1", role: "controller" as const };
    expect(() => assertControllerApproval(controller, payout)).not.toThrow();
    expect(() => assertControllerApproval({ ...controller, role: "agent" }, payout)).toThrow("Only a controller");
    expect(() => assertControllerApproval({ ...controller, role: "organizer" }, payout)).toThrow("Only a controller");
    expect(() => assertControllerApproval({ ...controller, orgId: "org_2" }, payout)).toThrow("not found");
    expect(() => assertControllerApproval({ ...controller, memberId: "organizer_1" }, payout)).toThrow("own payout");
    expect(() => assertControllerApproval({ ...controller, personId: "person_1" }, payout)).toThrow("recipient");
    expect(() => assertControllerApproval(controller, { ...payout, status: "frozen" })).toThrow("frozen");
  });
});
