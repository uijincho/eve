import { describe, expect, it } from "vitest";

import type { Claim, EventRecord, Organization, Person } from "@/lib/contracts";
import { claimReasonText } from "@/lib/client/derive";
import { checkClaim } from "@/lib/engines";
import { checkProjectSubmission } from "@/lib/engines/project-submission";

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
  id: "p1", name: "Priya Raman", email: "p@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2001-04-12",
  address: "Toronto", role: "hacker", adult: true, projectStatus: "unknown", taxForm: "W-8BEN", taxStatus: "valid",
  payoutCurrency: "CAD", payoutLast4: "1234", paidYtdMinor: "0", outstandingMinor: "0", chaseCount: 0,
};
const claim: Claim = {
  id: "c1", personId: "p1", personName: "Priya Raman", type: "travel", merchant: "Air Canada", description: "YYZ-SFO",
  category: "airfare", amountMinor: "25000", currency: "USD", usdMinor: "25000", fxRate: "1", fxSource: "",
  purchasedAt: "2026-10-01T10:00:00Z", travelDate: "2026-10-23T08:00:00Z", cabin: "Economy", origin: "YYZ",
  receiptName: "receipt.pdf", receiptHash: "h1", status: "submitted", checks: [], reason: "",
  dueAt: "2026-11-01T00:00:00Z", createdAt: "2026-10-20T00:00:00Z", requestedBy: "p1",
};

const BEFORE = "2026-10-24T12:00:00Z";
const AFTER = "2026-10-26T00:00:00Z";

function run(over: Partial<Person> & { type?: Claim["type"]; asOf: string }) {
  const { type, asOf, ...who } = over;
  return checkClaim({
    claim: { ...claim, ...(type ? { type } : {}) },
    person: { ...person, ...who },
    event, org, existingClaims: [], asOf,
  });
}
const project = (r: ReturnType<typeof checkClaim>) => r.checks.find((c) => c.code === "project_submission");

const statuses = ["submitted", "none", "unknown"] as const;
const whens = [["before", BEFORE], ["after", AFTER]] as const;
const roles = ["hacker", "mentor"] as const;

describe("project submission × status × closing × role", () => {
  for (const status of statuses) {
    for (const [when, asOf] of whens) {
      for (const role of roles) {
        it(`${status} ${when} closing as ${role}`, () => {
          const r = run({ projectStatus: status, role, asOf });
          const check = project(r);
          if (role !== "hacker") {
            expect(check).toBeUndefined();
            expect(r.status).not.toBe("rejected");
            return;
          }
          expect(check).toBeDefined();
          if (status === "submitted") {
            expect(check!.passed).toBe(true);
            expect(check!.detail).toBe("Project on record for Priya Raman.");
            expect(r.status).toBe("approved");
          } else if (status === "none") {
            expect(check!.passed).toBe(false);
            expect(check!.detail).toBe("No project submission on record for Priya Raman.");
            expect(r.status).toBe("escalated");
            expect(r.status).not.toBe("rejected");
            expect(claimReasonText({ checks: r.checks, status: r.status, reason: r.reason })).toContain("No project submission on record for Priya Raman");
          } else if (when === "before") {
            expect(check!.passed).toBe(true);
            expect(check!.detail).toContain("not on record yet");
            expect(check!.detail).toContain("held if it is still unknown after closing");
            expect(r.status).toBe("approved");
          } else {
            expect(check!.passed).toBe(false);
            expect(check!.detail).toBe("No project submission on record for Priya Raman after the submission deadline.");
            expect(r.status).toBe("escalated");
          }
        });
      }
    }
  }

  it("treats Hacker and judge the same way as their lowercase roles", () => {
    expect(project(run({ role: "Hacker", projectStatus: "none", asOf: BEFORE }))?.passed).toBe(false);
    expect(project(run({ role: "judge", projectStatus: "none", asOf: AFTER }))).toBeUndefined();
    expect(project(run({ role: "volunteer", projectStatus: "none", asOf: AFTER }))).toBeUndefined();
  });

  it("skips expense claims", () => {
    expect(project(run({ type: "expense", projectStatus: "none", asOf: AFTER }))).toBeUndefined();
  });

  it("accepts unknown at the exact closing instant and fails when closing is unreadable", () => {
    expect(project(run({ projectStatus: "unknown", asOf: event.closingAt }))!.passed).toBe(true);
    const bad = checkProjectSubmission({
      role: "hacker", name: "Priya Raman", projectStatus: "unknown", claimType: "travel",
      closingAt: "not-a-date", asOf: BEFORE,
    });
    expect(bad.applies && bad.check.passed).toBe(false);
    if (bad.applies) expect(bad.check.detail).toContain("not a valid date");
  });

  it("keeps a project URL on a submitted pass", () => {
    const r = run({ projectStatus: "submitted", projectUrl: "https://devpost.example/priya", asOf: AFTER });
    expect(project(r)?.detail).toBe("Project on record for Priya Raman: https://devpost.example/priya.");
    expect(r.status).toBe("approved");
  });
});
