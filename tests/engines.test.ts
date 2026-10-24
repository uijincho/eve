import { describe, expect, it } from "vitest";

import type { Award, Claim, EventRecord, Organization, Person, TaxRule } from "@/lib/contracts";
import {
  EngineError,
  MAX_MINOR,
  aggregateYtdByForm,
  ageOn,
  allocate,
  applyBps,
  checkClaim,
  compareQuotes,
  computeTax,
  convertMinor,
  crossRate,
  formValidity,
  grossUp,
  namesMatch,
  parseMinor,
  quotePayout,
  recommendFulfillment,
  selectRule,
  splitAward,
  startingRules,
  stateRuleFlags,
  w8ExpiresAt,
} from "@/lib/engines";

const base = {
  payerCountry: "US",
  hasValidForm: true,
  hasTin: true,
  year: 2026,
  ytdMinor: "0",
};

describe("money", () => {
  it("parses only canonical integer strings", () => {
    expect(parseMinor("0")).toBe(0n);
    expect(parseMinor("-150")).toBe(-150n);
    for (const bad of ["", " 1", "1.5", "1e3", "007", "-0", "abc", null, undefined, 12]) {
      expect(() => parseMinor(bad)).toThrow(EngineError);
    }
  });

  it("rejects amounts beyond the supported range", () => {
    expect(() => parseMinor((MAX_MINOR + 1n).toString())).toThrow(/range/);
    expect(parseMinor(MAX_MINOR.toString())).toBe(MAX_MINOR);
  });

  it("rounds half away from zero at the cent", () => {
    expect(applyBps(5n, 1000)).toBe(1n); // 0.5 → 1
    expect(applyBps(4n, 1000)).toBe(0n); // 0.4 → 0
    expect(applyBps(333_333n, 3000)).toBe(100_000n); // 99,999.9 → 100,000
  });

  it("converts across currencies with different exponents", () => {
    expect(convertMinor(100_000n, "USD", "CAD", "1.3995")).toBe(139_950n);
  });

  it("converts USD to JPY and KWD at the right scale", () => {
    expect(convertMinor(10_000n, "USD", "JPY", "156.8")).toBe(15_680n);
    expect(convertMinor(10_000n, "USD", "KWD", "0.307")).toBe(30_700n);
    expect(() => convertMinor(100n, "USD", "XYZ", "1.2")).toThrow(EngineError);
  });

  it("allocates without losing or creating a cent", () => {
    for (const [total, n] of [[100n, 3], [1n, 4], [99_999n, 7], [0n, 2]] as const) {
      const parts = allocate(total, Array.from({ length: n }, () => 1n));
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      const max = parts.reduce((a, b) => (a > b ? a : b));
      const min = parts.reduce((a, b) => (a < b ? a : b));
      expect(max - min <= 1n).toBe(true);
    }
  });
});

describe("tax engine", () => {
  it("withholds the sourced 30% default from a Canadian prize and reports on 1042-S at any amount", () => {
    const r = computeTax({ ...base, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000" });
    expect(r.ruleId).toBe("us-nonus-prize");
    expect(r.ruleVerified).toBe(true);
    expect(r.rateBps).toBe(3000);
    expect(r.withholdingMinor).toBe("30000");
    expect(r.netMinor).toBe("70000");
    expect(r.reportable).toBe(true);
    expect(r.reportingForm).toMatch(/^1042-S/);
    expect(r.hold).toBe(false);
  });

  it("holds an unresolved Canada treaty claim and shows the default side by side", () => {
    const r = computeTax({ ...base, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000", treatyClaim: true });
    expect(r.ruleId).toBe("us-ca-prize-treaty");
    expect(r.ruleVerified).toBe(false);
    expect(r.hold).toBe(true);
    expect(r.reason).toMatch(/unverified/);
    expect(r.defaultComparison).toMatchObject({ ruleId: "us-nonus-prize", withholdingMinor: "30000" });
  });

  it("takes the rate from the rule record, not from code", () => {
    const rule: TaxRule = { ...startingRules.find((x) => x.id === "us-nonus-prize")!, id: "custom", version: 9, rateBps: 1500 };
    const r = computeTax({ ...base, payeeCountry: "IN", paymentType: "cash_prize", grossMinor: "100000", rule });
    expect(r.withholdingMinor).toBe("15000");
    expect(r.ruleVersion).toBe(9);
  });

  it("holds when the form is missing or expired instead of defaulting", () => {
    const r = computeTax({ ...base, payeeCountry: "DE", paymentType: "cash_prize", grossMinor: "50000", hasValidForm: false });
    expect(r.hold).toBe(true);
    expect(r.reason).toMatch(/missing or expired/);
  });

  it("uses form-specific 1099 thresholds at the $2,000 boundary for 2026", () => {
    const under = computeTax({ ...base, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "50000", ytdMinor: "149999" });
    expect(under.reportable).toBe(false);
    const at = computeTax({ ...base, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "50000", ytdMinor: "150000" });
    expect(at.reportable).toBe(true);
    expect(at.reportingForm).toBe("1099-MISC box 3");
    expect(at.withholdingMinor).toBe("0");
  });

  it("does not combine a prize and a stipend into one threshold", () => {
    const payments = [
      { personId: "p1", reportingForm: "1099-MISC box 3", grossMinor: "150000", paidAt: "2026-03-01" },
      { personId: "p1", reportingForm: "1099-NEC box 1", grossMinor: "150000", paidAt: "2026-05-01" },
      { personId: "p1", reportingForm: "1099-MISC box 3", grossMinor: "999999", paidAt: "2025-12-31" },
      { personId: "p2", reportingForm: "1099-MISC box 3", grossMinor: "500000", paidAt: "2026-02-01" },
    ];
    const ytd = aggregateYtdByForm(payments, "p1", 2026);
    expect(ytd).toEqual({ "1099-MISC": "150000", "1099-NEC": "150000" });
    // $1,500 prize + $1,500 stipend = $3,000 total, but neither form reaches $2,000.
    const r = computeTax({ ...base, payeeCountry: "US", paymentType: "stipend", grossMinor: "40000", ytdMinor: ytd["1099-NEC"] });
    expect(r.reportable).toBe(false);
    expect(r.reportingForm).toMatch(/1099-NEC/);
  });

  it("uses the 2025 $600 rule for 2025 payments", () => {
    const r = computeTax({ ...base, year: 2025, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "60000" });
    expect(r.ruleId).toBe("us-us-prize-2025");
    expect(r.reportable).toBe(true);
  });

  it("applies 24% backup withholding only once a no-TIN payee's form total is reportable", () => {
    const below = computeTax({ ...base, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "100000", hasTin: false });
    expect(below.withholdingMinor).toBe("0");
    const over = computeTax({ ...base, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "250000", hasTin: false });
    expect(over.rateBps).toBe(2400);
    expect(over.withholdingMinor).toBe("60000");
    expect(over.appliedRuleIds).toEqual(["us-us-prize", "us-us-backup"]);
  });

  it("holds when no rule covers the payment, and for unverified Canadian payer rules", () => {
    expect(computeTax({ ...base, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "1000", year: 2027 }).hold).toBe(true);
    const ca = computeTax({ ...base, payerCountry: "CA", payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000" });
    expect(ca.ruleVerified).toBe(false);
    expect(ca.hold).toBe(true);
  });

  it("does not hold reimbursements for an unverified no-report default, but marks them unverified", () => {
    const r = computeTax({ ...base, payeeCountry: "CA", paymentType: "reimbursement", grossMinor: "42000" });
    expect(r.ruleVerified).toBe(false);
    expect(r.hold).toBe(false);
    expect(r.reportable).toBe(false);
    expect(r.withholdingMinor).toBe("0");
  });

  it("rejects negative or malformed money and holds zero", () => {
    expect(() => computeTax({ ...base, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "-1" })).toThrow(EngineError);
    expect(() => computeTax({ ...base, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "10.00" })).toThrow(EngineError);
    expect(computeTax({ ...base, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "0" }).hold).toBe(true);
  });

  it("grosses up an item prize so tax is paid on top", () => {
    const r = computeTax({ ...base, payeeCountry: "CA", paymentType: "item_prize", grossMinor: "109900" });
    expect(r.grossUp).toBeDefined();
    const g = BigInt(r.grossUp!.grossMinor);
    const w = BigInt(r.grossUp!.withholdingMinor);
    expect(g - w).toBeGreaterThanOrEqual(109_900n);
    expect(w).toBe(applyBps(g, 3000));
  });

  it("finds the minimal gross-up for every small net", () => {
    for (let net = 1n; net < 400n; net++) {
      const { grossMinor } = grossUp(net, 3000);
      const g = BigInt(grossMinor);
      expect(g - applyBps(g, 3000)).toBeGreaterThanOrEqual(net);
      expect(g - 1n - applyBps(g - 1n, 3000)).toBeLessThan(net);
    }
    expect(() => grossUp("100", 10_000)).toThrow(EngineError);
  });

  it("expires W-8BEN on the last day of the third succeeding year", () => {
    expect(w8ExpiresAt("2026-03-15")).toBe("2029-12-31");
    expect(formValidity({ taxForm: "W-8BEN", taxSignedAt: "2022-06-01" }, "2026-10-24")).toBe("expired");
    expect(formValidity({ taxForm: "W-8BEN", taxSignedAt: "2023-01-02" }, "2026-10-24")).toBe("valid");
    expect(formValidity({ taxForm: "W-8BEN", taxSignedAt: "2023-01-02" }, "2027-01-01")).toBe("expired");
    expect(formValidity({ taxForm: "W-9", taxSignedAt: "2010-01-01" }, "2026-10-24")).toBe("valid");
    expect(formValidity({ taxForm: "W-9" }, "2026-10-24")).toBe("missing");
  });

  it("every starting rule has a source, an effective date, and a parseable threshold", () => {
    for (const r of startingRules) {
      expect(r.sourceUrl).toMatch(/^https:\/\//);
      expect(r.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(() => parseMinor(r.thresholdMinor)).not.toThrow();
    }
    expect(selectRule(startingRules, { payerCountry: "US", payeeCountry: "US", paymentType: "cash_prize", year: 2026 })?.id).toBe("us-us-prize");
  });

  it("flags but never applies the unverified California layer", () => {
    const flags = stateRuleFlags({ eventState: "CA", payeeState: "NV", paymentType: "cash_prize", grossMinor: "200000", ytdMinor: "0", year: 2026 });
    expect(flags).toHaveLength(1);
    expect(flags[0].verified).toBe(false);
    expect(flags[0].potentialWithholdingMinor).toBe("14000");
    expect(stateRuleFlags({ eventState: "CA", payeeState: "CA", paymentType: "cash_prize", grossMinor: "200000", ytdMinor: "0", year: 2026 })).toEqual([]);
    expect(stateRuleFlags({ eventState: "CA", paymentType: "cash_prize", grossMinor: "100000", ytdMinor: "0", year: 2026 })).toEqual([]);
  });
});

const org: Organization = {
  id: "org", name: "Cal Hacks", country: "US", mode: "direct", agentLimitMinor: "30000",
  organizerLimitMinor: "200000", currency: "USD", sponsorName: "Westbrook", sponsorTurnaroundDays: 10, feesPaidBy: "org",
};
const event: EventRecord = {
  id: "ev", name: "Cal Hacks 13.0", startsAt: "2026-10-23T20:30:00Z", endsAt: "2026-10-25T22:00:00Z", venue: "SF",
  expectedHeadcount: 300, travelCapMinor: "50000", economyOnly: true, bookingDeadline: "2026-10-16T00:00:00Z",
  checkInAt: "2026-10-23T20:30:00Z", closingAt: "2026-10-25T22:00:00Z", locked: false,
};
const person: Person = {
  id: "p1", name: "Marcus Lee", email: "m@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2004-05-01",
  address: "Toronto", role: "hacker", adult: true, taxForm: "W-8BEN", taxStatus: "valid", payoutCurrency: "CAD",
  payoutLast4: "1234", paidYtdMinor: "0", outstandingMinor: "0", chaseCount: 0,
};
const claim: Claim = {
  id: "c1", personId: "p1", personName: "Marcus Lee", type: "travel", merchant: "Air Canada", description: "YYZ-SFO",
  category: "airfare", amountMinor: "25000", currency: "USD", usdMinor: "25000", fxRate: "1", fxSource: "",
  purchasedAt: "2026-10-01T10:00:00Z", travelDate: "2026-10-23T08:00:00Z", cabin: "Economy", origin: "YYZ",
  receiptName: "receipt.pdf", receiptHash: "h1", status: "submitted", checks: [], reason: "",
  dueAt: "2026-11-01T00:00:00Z", createdAt: "2026-10-26T00:00:00Z", requestedBy: "p1",
};
const run = (c: Partial<Claim>, extra: Partial<Parameters<typeof checkClaim>[0]> = {}) =>
  checkClaim({ claim: { ...claim, ...c }, person, event, org, existingClaims: [], asOf: "2026-10-26T00:00:00Z", ...extra });
const failed = (r: ReturnType<typeof checkClaim>) => r.checks.filter((c) => !c.passed).map((c) => c.code);

describe("claim policy", () => {
  it("approves a clean in-policy claim under the agent limit", () => {
    const r = run({});
    expect(failed(r)).toEqual([]);
    expect(r.status).toBe("approved");
  });

  it("escalates a duplicate receipt by hash and by merchant/amount/day", () => {
    expect(failed(run({}, { existingClaims: [{ ...claim, id: "c0", status: "paid" }] }))).toContain("duplicate");
    expect(failed(run({ receiptHash: "other" }, { existingClaims: [{ ...claim, id: "c0", receiptHash: "zzz", merchant: "AIR CANADA " }] }))).toContain("duplicate");
    // A previously rejected claim is not a duplicate source.
    expect(failed(run({}, { existingClaims: [{ ...claim, id: "c0", status: "rejected" }] }))).not.toContain("duplicate");
  });

  it("escalates travel outside the event window", () => {
    const r = run({ travelDate: "2026-11-15T08:00:00Z" });
    expect(failed(r)).toContain("travel_dates");
    expect(r.status).toBe("escalated");
    expect(failed(run({ travelDate: undefined }))).toContain("travel_dates");
  });

  it("escalates business and premium economy cabins when economy only", () => {
    expect(failed(run({ cabin: "Business" }))).toContain("cabin");
    expect(failed(run({ cabin: "Premium Economy" }))).toContain("cabin");
    expect(failed(run({ cabin: "basic economy" }))).not.toContain("cabin");
  });

  it("catches a EUR fare that is over the cap only after conversion", () => {
    // €480 at 1.1193 USD/EUR = $537.26, over the $500 cap.
    const r = run({ currency: "EUR", amountMinor: "48000", fxRate: "1.1193", usdMinor: "53726", fxSource: "ECB 2026-10-01" });
    expect(r.usdMinor).toBe("53726");
    expect(failed(r)).toContain("cap");
    expect(failed(r)).not.toContain("fx_converted");
  });

  it("flags an FX amount that does not match the stated rate, or has no source", () => {
    expect(failed(run({ currency: "EUR", amountMinor: "20000", fxRate: "1.1193", usdMinor: "20000", fxSource: "ECB" }))).toContain("fx_converted");
    expect(failed(run({ currency: "EUR", amountMinor: "20000", fxRate: "1.1193", usdMinor: "22386", fxSource: "" }))).toContain("fx_converted");
  });

  it("flags name mismatches but tolerates accents, case, middle names and LAST/FIRST", () => {
    expect(failed(run({ personName: "Marcia Leigh" }))).toContain("name_match");
    expect(namesMatch("José Álvarez", "JOSE ALVAREZ")).toBe(true);
    expect(namesMatch("Marcus Lee", "LEE/MARCUS")).toBe(true);
    expect(namesMatch("Marcus Lee", "Marcus J. Lee")).toBe(true);
    expect(namesMatch("Marcus Lee", "Marcus Leo")).toBe(false);
  });

  it("computes age at event start from DOB, not the stored adult flag", () => {
    expect(ageOn("2008-10-23", "2026-10-23T20:30:00Z")).toBe(18);
    expect(ageOn("2008-10-24", "2026-10-23T20:30:00Z")).toBe(17);
    const r = checkClaim({ claim, person: { ...person, dateOfBirth: "2009-01-01", adult: true }, event, org, existingClaims: [], asOf: "2026-10-26T00:00:00Z" });
    expect(failed(r)).toContain("adult");
    expect(r.status).toBe("escalated");
  });

  it("asks for info when only the receipt is missing", () => {
    const r = run({ receiptName: undefined, documentId: undefined });
    expect(r.status).toBe("needs_info");
  });

  it("escalates over the agent limit, cap-hugging, late booking, and bad amounts", () => {
    expect(failed(run({ amountMinor: "40000", usdMinor: "40000" }))).toEqual(["agent_limit"]);
    expect(failed(run({ amountMinor: "49500", usdMinor: "49500" }))).toContain("cap_hugging");
    expect(failed(run({ purchasedAt: "2026-10-20T00:00:00Z" }))).toContain("booking_deadline");
    expect(run({ amountMinor: "0" }).status).toBe("escalated");
    expect(run({ amountMinor: "12.50" }).status).toBe("escalated");
  });
});

describe("payout quotes", () => {
  it("conserves money: net + fees = amount when the recipient pays fees", () => {
    for (const provider of ["stripe", "mock_wire", "sponsor_packet"]) {
      const q = quotePayout({ amountMinor: "70000", currency: "USD", destinationCurrency: "CAD", provider, feesPaidBy: "recipient" });
      expect(BigInt(q.netMinor) + BigInt(q.feeMinor)).toBe(70_000n);
      expect(q.fees.reduce((a, f) => a + BigInt(f.amountMinor), 0n)).toBe(BigInt(q.feeMinor));
    }
  });

  it("shows why a $1,000 wire lands as less, labelled simulated", () => {
    const q = quotePayout({ amountMinor: "100000", currency: "USD", destinationCurrency: "USD", destinationCountry: "CA", provider: "simulated", feesPaidBy: "recipient" });
    expect(q.truth).toBe("Simulated");
    expect(q.feeMinor).toBe("5000");
    expect(q.netMinor).toBe("95000");
  });

  it("keeps the announced amount when the org pays fees", () => {
    const q = quotePayout({ amountMinor: "70000", currency: "USD", destinationCurrency: "CAD", provider: "stripe", feesPaidBy: "org" });
    expect(q.netMinor).toBe("70000");
    expect(BigInt(q.payerCostMinor)).toBe(70_000n + BigInt(q.feeMinor));
    expect(q.truth).toBe("Estimate");
    // 0.25% + $0.25 + 0.25% cross-border on $700 = 175 + 25 + 175.
    expect(q.feeMinor).toBe("375");
    // Rate after a 1% spread on 1.3995.
    expect(q.fxRate).toBe("1.385505");
    expect(q.destinationNetMinor).toBe("96985");
  });

  it("rejects zero, negative, unknown providers and currencies", () => {
    expect(() => quotePayout({ amountMinor: "0", currency: "USD", destinationCurrency: "CAD" })).toThrow(EngineError);
    expect(() => quotePayout({ amountMinor: "-5", currency: "USD", destinationCurrency: "CAD" })).toThrow(EngineError);
    expect(() => quotePayout({ amountMinor: "5", currency: "USD", destinationCurrency: "CAD", provider: "venmo" })).toThrow(EngineError);
    expect(() => quotePayout({ amountMinor: "5", currency: "USD", destinationCurrency: "ZZZ" })).toThrow(EngineError);
  });

  it("warns instead of going negative when fees exceed a tiny payout", () => {
    const q = quotePayout({ amountMinor: "100", currency: "USD", destinationCurrency: "USD", destinationCountry: "CA", provider: "mock_wire", feesPaidBy: "recipient" });
    expect(q.netMinor).toBe("0");
    expect(q.warnings[0]).toMatch(/exceed/);
  });

  it("handles zero-decimal destinations", () => {
    const q = quotePayout({ amountMinor: "10000", currency: "USD", destinationCurrency: "JPY", provider: "sponsor_packet" });
    expect(q.destinationNetMinor).toBe("15680");
    expect(crossRate("CAD", "USD")).toBe("0.71454091");
  });

  it("ranks providers by what the recipient receives", () => {
    const ranked = compareQuotes({ amountMinor: "70000", currency: "USD", destinationCurrency: "CAD", feesPaidBy: "recipient" });
    expect(ranked.map((q) => q.provider)[0]).toBe("sponsor_packet");
    expect(ranked.at(-1)!.provider).toBe("mock_wire");
  });
});

describe("splits and fulfillment", () => {
  it("splits a team prize evenly with exact conservation", () => {
    const r = splitAward({ amountMinor: "100000", memberIds: ["a", "b", "c"] });
    expect(r.parts.map((p) => p.amountMinor)).toEqual(["33334", "33333", "33333"]);
    expect(r.confirmed).toBe(true);
  });

  it("requires every member to confirm a custom split", () => {
    const r = splitAward({ amountMinor: "100001", memberIds: ["a", "b"], shares: { a: 60, b: 40 }, confirmedBy: ["a"] });
    expect(r.parts.reduce((s, p) => s + BigInt(p.amountMinor), 0n)).toBe(100_001n);
    expect(r.confirmed).toBe(false);
    expect(() => splitAward({ amountMinor: "100", memberIds: ["a"], shares: { z: 1 } })).toThrow(EngineError);
    expect(() => splitAward({ amountMinor: "100", memberIds: ["a", "a"] })).toThrow(EngineError);
  });

  const award: Award = {
    id: "a1", personId: "p1", personName: "Marcus Lee", track: "Overall", title: "MacBook Air", kind: "item",
    amountMinor: "109900", currency: "USD", fulfillment: "undecided", status: "draft", recommendation: "",
    shippingMinor: "0", localMinor: "0", splitConfirmed: true, dueAt: "2026-11-01", requestedBy: "judge",
  };

  it("buys locally for a Canadian winner when duty and shipping are too high", () => {
    const r = recommendFulfillment(award, person);
    expect(r.choice).toBe("local");
    expect(r.truth).toBe("Simulated");
    expect(r.recommendation).toMatch(/reportable/);
  });

  it("ships domestically, offers cash where shipping is blocked, and passes cash through", () => {
    expect(recommendFulfillment(award, { ...person, country: "US" }).choice).toBe("ship");
    expect(recommendFulfillment(award, { ...person, country: "NG" }).choice).toBe("cash");
    expect(recommendFulfillment(award, { ...person, country: "ZZ" }).choice).toBe("cash");
    expect(recommendFulfillment({ ...award, kind: "cash" }, person).choice).toBe("cash");
  });
});

describe("policy date and name validation", () => {
  it("rejects impossible, offset-less and future dates instead of trusting Date.parse", async () => {
    const { parseCalendarDate, parseInstant } = await import("@/lib/engines");
    expect(parseCalendarDate("2026-02-30")).toBeUndefined();
    expect(parseCalendarDate("2026-13-01")).toBeUndefined();
    expect(parseCalendarDate("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseInstant("2026-10-23T08:00:00")).toBeUndefined(); // no offset: server-zone dependent
    expect(parseInstant("2026-10-23T25:00:00Z")).toBeUndefined();
    expect(parseInstant("2026-10-23")).toBe(Date.UTC(2026, 9, 23));
    expect(() => ageOn("2008-02-30", "2026-10-23")).toThrow(EngineError);
    expect(() => ageOn("2030-01-01", "2026-10-23")).toThrow(/after the event/);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
  });

  it("fails checks with readable details rather than throwing on bad event or claim dates", () => {
    expect(failed(run({ travelDate: "2026-10-23T08:00:00" }))).toContain("travel_dates");
    expect(failed(run({ purchasedAt: "yesterday" }))).toContain("purchase_date");
    expect(failed(run({ purchasedAt: "2026-12-01T00:00:00Z" }))).toContain("purchase_date");
    const bad = checkClaim({ claim, person, event: { ...event, startsAt: "nope", bookingDeadline: "2026-02-31" }, org: { ...org, agentLimitMinor: "x" }, existingClaims: [], asOf: "2026-10-26T00:00:00Z" });
    expect(failed(bad)).toEqual(expect.arrayContaining(["travel_dates", "booking_deadline", "agent_limit", "adult"]));
    expect(failed(run({}, { person: { ...person, dateOfBirth: "2004-13-01" } } as never))).toContain("adult");
  });

  it("keeps non-Latin names and refuses to call different scripts a mismatch", async () => {
    const { compareNames, normalizeName } = await import("@/lib/engines");
    expect(normalizeName("Мария Иванова")).toEqual(["мария", "иванова"]);
    expect(compareNames("Мария Иванова", "Мария Иванова")).toBe("match");
    expect(compareNames("Мария Иванова", "Ольга Петрова")).toBe("mismatch");
    expect(compareNames("李小龙", "李小龙")).toBe("match");
    expect(compareNames("李小龙", "LI/XIAOLONG")).toBe("uncomparable");
    expect(compareNames("Jörg Straße", "STRASSE/JORG MR")).toBe("match");
    expect(compareNames("Søren Kierkegaard", "KIERKEGAARD/SOREN")).toBe("match");
    expect(compareNames("Anne-Marie Lee", "ANNEMARIE LEE")).toBe("match");
    expect(compareNames("", "LEE/MARCUS")).toBe("uncomparable");
    const r = checkClaim({ claim: { ...claim, personName: "LI/XIAOLONG" }, person: { ...person, name: "李小龙" }, event, org, existingClaims: [], asOf: "2026-10-26T00:00:00Z" });
    expect(r.checks.find((c) => c.code === "name_match")?.detail).toMatch(/different scripts/);
    expect(r.status).toBe("escalated");
  });
});
