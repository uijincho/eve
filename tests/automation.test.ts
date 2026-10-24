import { describe, expect, it } from "vitest";
import { taxNeedsAttention } from "../lib/agent/automation";

describe("tax chase eligibility", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const signedAt = new Date("2023-01-01");
  it("chases absent and expired forms, and stops for a current valid form", () => {
    expect(taxNeedsAttention(undefined, now)).toBe("missing");
    expect(taxNeedsAttention({ status: "valid", signedAt, expiresAt: new Date("2025-12-31") }, now)).toBe("expired");
    expect(taxNeedsAttention({ status: "valid", signedAt, expiresAt: new Date("2026-12-31T23:59:59Z") }, now)).toBeNull();
    expect(taxNeedsAttention({ status: "valid", signedAt, expiresAt: null }, now)).toBeNull();
  });
  it("renews soon-expiring forms without calling them expired", () => {
    expect(taxNeedsAttention({ status: "valid", signedAt, expiresAt: new Date("2026-11-15") }, now)).toBe("expiring");
    expect(taxNeedsAttention({ status: "review", signedAt, expiresAt: null }, now)).toBe("review");
  });
});
