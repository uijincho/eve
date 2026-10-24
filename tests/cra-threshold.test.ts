import { describe, expect, it } from "vitest";

import { computeTax, startingRules } from "@/lib/engines";
import { thresholdReached } from "@/lib/tax";

const ca = { payerCountry: "CA", payeeCountry: "CA", paymentType: "cash_prize", hasValidForm: true, hasTin: false, year: 2026, ytdMinor: "0", rules: startingRules };

describe("CRA T4A threshold (more than CAD 500)", () => {
  it("is strict for T4A and inclusive for 1099s", () => {
    expect(thresholdReached("T4A (box to verify)", 50000n, 50000n)).toBe(false);
    expect(thresholdReached("T4A (box to verify)", 50001n, 50000n)).toBe(true);
    expect(thresholdReached("1099-MISC box 3", 200000n, 200000n)).toBe(true);
    expect(thresholdReached("1099-NEC", 199999n, 200000n)).toBe(false);
  });

  it("does not mark exactly CAD 500.00 reportable, but CAD 500.01 is, and the rule stays unverified", () => {
    const at = computeTax({ ...ca, grossMinor: "50000" });
    expect(at).toMatchObject({ ruleId: "ca-ca-prize", reportable: false, ruleVerified: false, hold: true });
    expect(at.reason).toMatch(/unverified/);
    expect(computeTax({ ...ca, grossMinor: "50001" }).reportable).toBe(true);
    // Year-to-date on the same form: 300.00 already paid + 200.00 is exactly 500.00.
    expect(computeTax({ ...ca, grossMinor: "20000", ytdMinor: "30000" }).reportable).toBe(false);
    expect(computeTax({ ...ca, grossMinor: "20001", ytdMinor: "30000" }).reportable).toBe(true);
    expect(computeTax({ ...ca, paymentType: "stipend", grossMinor: "50000" }).reportable).toBe(false);
    expect(computeTax({ ...ca, paymentType: "item_prize", grossMinor: "50000" }).reportable).toBe(false);
  });

  it("leaves US 'or more' thresholds and NR4 any-amount reporting unchanged", () => {
    const us = { ...ca, payerCountry: "US", payeeCountry: "US", hasTin: true };
    expect(computeTax({ ...us, grossMinor: "200000" }).reportable).toBe(true);
    expect(computeTax({ ...us, grossMinor: "199999" }).reportable).toBe(false);
    const nr4 = computeTax({ ...ca, payeeCountry: "US", grossMinor: "1" });
    expect(nr4).toMatchObject({ ruleId: "ca-nonca-prize", reportable: true });
  });
});
