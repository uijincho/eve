import { describe, expect, it } from "vitest";

import { isInitialEnrollment } from "@/lib/server/payouts";

const self = { role: "attendee" as const, personId: "per_1" };
const never: { status: "active" | "superseded" | "rejected" | "pending_verification"; verifiedAt: Date | null }[] = [];

describe("isInitialEnrollment", () => {
  it("allows only the attendee's own first portal entry", () => {
    expect(isInitialEnrollment(self, "per_1", never)).toBe(true);
    expect(isInitialEnrollment(self, "per_1", never, "portal")).toBe(true);
    expect(isInitialEnrollment(self, "per_2", never)).toBe(false);
    expect(isInitialEnrollment(self, "per_1", never, "email")).toBe(false);
    for (const role of ["organizer", "controller", "agent"] as const) expect(isInitialEnrollment({ role, personId: "per_1" }, "per_1", never)).toBe(false);
    expect(isInitialEnrollment({ role: "attendee", personId: null }, "per_1", never)).toBe(false);
  });

  it("refuses once any account was active, superseded or confirmed", () => {
    expect(isInitialEnrollment(self, "per_1", [{ status: "active", verifiedAt: null }])).toBe(false);
    expect(isInitialEnrollment(self, "per_1", [{ status: "superseded", verifiedAt: null }])).toBe(false);
    expect(isInitialEnrollment(self, "per_1", [{ status: "rejected", verifiedAt: new Date() }])).toBe(false);
    // Unconfirmed requests that never activated do not count as a prior account.
    expect(isInitialEnrollment(self, "per_1", [{ status: "pending_verification", verifiedAt: null }, { status: "rejected", verifiedAt: null }])).toBe(true);
  });
});
