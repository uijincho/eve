import { describe, expect, it } from "vitest";

import type { Claim, EventRecord, Organization, Person } from "@/lib/contracts";
import { checkClaim, checkFarePeers, farePeers, isEconomyCabin, percentileMinor } from "@/lib/engines";

const org: Organization = {
  id: "org", name: "Cal Hacks", country: "US", mode: "direct", agentLimitMinor: "60000",
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
  category: "airfare", amountMinor: "30000", currency: "USD", usdMinor: "30000", fxRate: "1", fxSource: "",
  purchasedAt: "2026-10-01T10:00:00Z", travelDate: "2026-10-23T08:00:00Z", cabin: "Economy", origin: "YYZ",
  receiptName: "receipt.pdf", receiptHash: "h1", status: "submitted", checks: [], reason: "",
  dueAt: "2026-11-01T00:00:00Z", createdAt: "2026-10-26T00:00:00Z", requestedBy: "p1",
};

/** Other attendees on YYZ → SFO paying about $300. */
const peerFares = [28000, 29000, 30000, 30500, 31000, 32000];
const peers: Claim[] = peerFares.map((usd, i) => ({ ...claim, id: `peer${i}`, personId: `pp${i}`, receiptHash: `ph${i}`, usdMinor: String(usd), amountMinor: String(usd) }));

/** `null` runs without peer candidates. */
const run = (c: Partial<Claim>, fareCandidates: Claim[] | null = peers) =>
  checkClaim({ claim: { ...claim, ...c }, person, event, org, existingClaims: [], fareCandidates: fareCandidates ?? undefined, asOf: "2026-10-26T00:00:00Z" });
const fare = (r: ReturnType<typeof checkClaim>) => r.checks.find((c) => c.code === "fare_peer");

describe("percentileMinor", () => {
  it("uses nearest rank", () => {
    const xs = [10n, 20n, 30n, 40n];
    expect(percentileMinor(xs, 50)).toBe(20n);
    expect(percentileMinor(xs, 75)).toBe(30n);
    expect(percentileMinor(xs, 100)).toBe(40n);
    expect(percentileMinor([7n], 75)).toBe(7n);
    expect(() => percentileMinor([], 50)).toThrow();
  });
});

describe("farePeers", () => {
  it("keeps only other people's non-rejected economy fares from the same origin", () => {
    const candidates: Claim[] = [
      ...peers,
      { ...peers[0], id: "self", personId: "p1", usdMinor: "10000" },
      { ...peers[0], id: "rej", personId: "x1", status: "rejected", usdMinor: "10000" },
      { ...peers[0], id: "biz", personId: "x2", cabin: "business", usdMinor: "90000" },
      { ...peers[0], id: "yvr", personId: "x3", origin: "YVR", usdMinor: "10000" },
      { ...peers[0], id: "exp", personId: "x4", type: "expense", usdMinor: "10000" },
      { ...peers[0], id: "bad", personId: "x5", usdMinor: "abc" },
      { ...peers[0], id: "low", personId: "x6", origin: " yyz ", usdMinor: "27000" },
    ];
    expect(farePeers(claim, candidates, isEconomyCabin)).toEqual([27000n, 28000n, 29000n, 30000n, 30500n, 31000n, 32000n]);
  });
});

describe("peer fare check", () => {
  it("flags a $495 YYZ fare when peers paid about $300", () => {
    const r = run({ usdMinor: "49512", amountMinor: "49512" });
    expect(fare(r)?.passed).toBe(false);
    expect(fare(r)?.detail).toContain("above the YYZ peer 75th percentile ($310.00");
    // Flag only: it goes to a person.
    expect(r.status).toBe("escalated");
  });

  it("catches an expensive fare that is not near the cap and under the agent limit", () => {
    const r = run({ usdMinor: "40000", amountMinor: "40000" });
    expect(r.checks.find((c) => c.code === "cap_hugging")).toBeUndefined();
    expect(fare(r)?.passed).toBe(false);
  });

  it("passes fares within the margin above the 75th percentile", () => {
    // p75 is $310; 20% margin allows up to $372.
    expect(fare(run({ usdMinor: "37200", amountMinor: "37200" }))?.passed).toBe(true);
    expect(fare(run({ usdMinor: "37201", amountMinor: "37201" }))?.passed).toBe(false);
    expect(run({}).status).toBe("approved");
  });

  it("compares the converted USD amount for foreign-currency claims", () => {
    // CA$679.40 at 0.72876 = $495.12.
    const r = run({ currency: "CAD", amountMinor: "67940", fxRate: "0.72876", usdMinor: "49512", fxSource: "seed" });
    expect(fare(r)?.passed).toBe(false);
    expect(fare(r)?.detail).toContain("$495.12");
  });

  it("skips the check when there are too few peers or none were supplied", () => {
    expect(fare(run({ usdMinor: "49512", amountMinor: "49512" }, peers.slice(0, 4)))).toBeUndefined();
    expect(fare(run({ usdMinor: "49512", amountMinor: "49512" }, null))).toBeUndefined();
    expect(fare(run({ usdMinor: "49512", amountMinor: "49512", origin: undefined }))).toBeUndefined();
  });

  it("does not compare non-economy cabins (the cabin check already covers them)", () => {
    expect(fare(run({ cabin: "business", usdMinor: "49512", amountMinor: "49512" }))).toBeUndefined();
  });

  it("returns evidence and honours a tuned policy", () => {
    const sorted = peerFares.map(BigInt);
    const out = checkFarePeers({ usdMinor: 33000n, origin: "YYZ", peers: sorted, policy: { peerMarginBps: 0 } });
    expect(out.check?.passed).toBe(false);
    expect(out.evidence).toEqual({ origin: "YYZ", peerCount: 6, medianMinor: "30000", percentileMinor: "31000", deltaMinor: "2000", flagged: true });
    expect(checkFarePeers({ usdMinor: 99999n, origin: "YYZ", peers: sorted, policy: { minPeers: 7 } })).toEqual({});
  });
});
