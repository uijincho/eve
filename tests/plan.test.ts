import { describe, expect, it } from "vitest";

import { TAX_SCENARIOS, computeTax, planPayout } from "@/lib/engines";

describe("tax scenarios", () => {
  for (const s of TAX_SCENARIOS) {
    it(s.title, () => {
      expect(computeTax(s.input)).toMatchObject(s.expect);
    });
  }
});

describe("planPayout", () => {
  const ca = {
    payerCountry: "US", payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000", currency: "USD",
    destinationCurrency: "CAD", hasValidForm: true, hasTin: true, year: 2026, ytdMinor: "0",
  };

  it("chains tax then fees and conserves every cent when the recipient pays fees", () => {
    const { payout, quote } = planPayout({ ...ca, provider: "stripe", feesPaidBy: "recipient" });
    expect(payout.withholdingMinor).toBe("30000");
    expect(BigInt(payout.withholdingMinor) + BigInt(payout.feeMinor) + BigInt(payout.netMinor)).toBe(100_000n);
    expect(payout.status).toBe("proposed");
    expect(payout.truth).toBe("Estimate");
    expect(quote?.provider).toBe("stripe");
  });

  it("holds an unresolved treaty claim and labels it", () => {
    const { payout, tax } = planPayout({ ...ca, treatyClaim: true });
    expect(payout.status).toBe("held");
    expect(payout.truth).toBe("Unverified rule");
    expect(tax.defaultComparison?.withholdingMinor).toBe("30000");
  });

  it("sends no cash for an item prize and surfaces the gross-up", () => {
    const { payout, quote, tax } = planPayout({ ...ca, paymentType: "item_prize", grossMinor: "109900" });
    expect(quote).toBeUndefined();
    expect(payout.netMinor).toBe("0");
    expect(tax.grossUp).toBeDefined();
  });
});
