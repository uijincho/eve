import { describe, expect, it } from "vitest";

import type { AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import {
  buildInbox,
  canRelease,
  canReview,
  groupRuns,
  isAdultOn,
  prizeOptions,
  payoutFees,
  prizeRule,
  ruleLabel,
  runCounters,
  suggestedForm,
} from "@/lib/client/derive";
import { toMinor } from "@/lib/client/payloads";

const s = fixtureSnapshot();
const organizer = s.personas.find((p) => p.role === "organizer")!;
const controller = s.personas.find((p) => p.role === "controller")!;
const auditor = s.personas.find((p) => p.role === "auditor")!;

describe("buildInbox", () => {
  const inbox = buildInbox(s);

  it("orders items soonest first", () => {
    const due = inbox.map((i) => new Date(i.dueAt).getTime());
    expect([...due].sort((a, b) => a - b)).toEqual(due);
  });

  it("surfaces the frozen payout as a critical exception", () => {
    const frozen = inbox.find((i) => i.id === "payout:PO-7");
    expect(frozen?.category).toBe("exceptions");
    expect(frozen?.critical).toBe("Frozen");
  });

  it("collects proposed payouts into one release item", () => {
    const batch = inbox.filter((i) => i.ref.kind === "payouts");
    expect(batch).toHaveLength(1);
  });

  it("does not list a held person twice", () => {
    const ids = inbox.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips auto-approved claims", () => {
    expect(inbox.some((i) => i.id === "claim:C-2231")).toBe(false);
  });
});

describe("authority explanations", () => {
  const proposed = s.payouts.find((p) => p.status === "proposed")!;

  it("only a controller may release, and never their own request", () => {
    expect(canRelease(organizer, proposed, s)).toMatchObject({ allowed: false });
    expect(canRelease(controller, proposed, s)).toEqual({ allowed: true });
    expect(canRelease(controller, { ...proposed, requestedBy: controller.id }, s)).toMatchObject({ allowed: false });
  });

  it("names the controller in the blocked reason", () => {
    const r = canRelease(organizer, proposed, s);
    expect(r.allowed ? "" : r.reason).toContain(controller.name);
  });

  it("frozen payouts cannot be released by anyone", () => {
    const frozen = s.payouts.find((p) => p.status === "frozen")!;
    expect(canRelease(controller, frozen, s).allowed).toBe(false);
  });

  it("auditors are read-only", () => {
    expect(canReview(auditor, s.claims[0]).allowed).toBe(false);
  });
});

describe("prizeOptions", () => {
  it("estimates withholding from the matched rule with exact integers", () => {
    const award = s.awards[0];
    const o = prizeOptions(s, award, s.people.find((p) => p.id === award.personId));
    expect(o.withholding).toBe(38970n);
    expect(o.cashNet).toBe(90930n);
    expect(o.recommended).toBe("cash");
  });

  it("takes the engine's choice from its first sentence only", () => {
    const award = {
      ...s.awards[0],
      recommendation: "Buy it locally. Sold locally for about $1,350.96. Cash lets withholding come out of the payout.",
    };
    expect(prizeOptions(s, award).recommended).toBe("local");
    expect(prizeOptions(s, { ...award, recommendation: "Offer the cash equivalent. Not sold locally in BR." }).recommended).toBe("cash");
    expect(prizeOptions(s, { ...award, recommendation: "Ship the item. Domestic winner." }).recommended).toBe("ship");
  });
});

describe("prizeRule with seeded rule shapes", () => {
  const rule = (id: string, payeeCountry: string, paymentType: string, rateBps: number, extra: Partial<AppSnapshot["rules"][number]> = {}) => ({
    id, version: 1, payerCountry: "US", payeeCountry, paymentType, rateBps, thresholdMinor: "0", form: "W-8BEN",
    reportingForm: "1042-S", verified: true, sourceUrl: "", explanation: "", effectiveFrom: "2025-01-01", ...extra,
  });
  const rules = [
    rule("us-us-prize-2025", "US", "cash_prize", 0, { effectiveTo: "2025-12-31" }),
    rule("us-us-prize", "US", "cash_prize", 0, { version: 2 }),
    rule("us-nonus-prize", "NONUS", "cash_prize", 3000),
    rule("us-nonus-item-prize", "NONUS", "item_prize", 3000),
    rule("us-ca-item-prize-treaty", "CA", "item_prize:treaty", 0, { verified: false }),
  ];
  const snap = { rules, org: { ...s.org, country: "US" }, now: "2026-10-24T00:00:00Z" };
  const priya = { ...s.people[0], country: "CA", taxStatus: "missing" as const };

  it("uses the 30% default until a valid form is on file", () => {
    expect(prizeRule(snap, priya, "item")?.id).toBe("us-nonus-item-prize");
  });
  it("uses the treaty rule once the form is valid", () => {
    expect(prizeRule(snap, { ...priya, taxStatus: "valid" }, "item")?.id).toBe("us-ca-item-prize-treaty");
  });
  it("skips expired versions for domestic winners", () => {
    expect(prizeRule(snap, { ...priya, country: "US" }, "cash")?.id).toBe("us-us-prize");
  });
});

describe("payout display", () => {
  it("keeps an org-paid fee out of the recipient's net", () => {
    expect(payoutFees({ grossMinor: "129900", withholdingMinor: "38970", feeMinor: "5000", netMinor: "90930" })).toEqual({ recipient: 0n, org: 5000n });
    expect(payoutFees({ grossMinor: "3820", withholdingMinor: "0", feeMinor: "25", netMinor: "3795" })).toEqual({ recipient: 25n, org: 0n });
  });
  it("names rules in words", () => {
    expect(ruleLabel({ payerCountry: "US", payeeCountry: "NONUS", paymentType: "item_prize:treaty", version: 1 })).toBe("US → non-US, item prize (treaty), v1");
  });
});

describe("runs", () => {
  it("groups decisions by run and keeps the latest status", () => {
    const runs = groupRuns(s.decisions);
    expect(runs.find((r) => r.runId === "run-1")?.status).toBe("escalated");
    expect(runCounters(runs, s.now).escalated).toBe(2);
  });
});

describe("helpers", () => {
  it("converts typed amounts without floats", () => {
    expect(toMinor("1,299.5")).toBe("129950");
    expect(toMinor("0.1")).toBe("10");
    expect(toMinor("12.345")).toBeNull();
    expect(toMinor("abc")).toBeNull();
  });

  it("refuses anyone under 18 at the event start", () => {
    expect(isAdultOn("2008-10-25", "2026-10-24T17:00:00Z")).toBe(false);
    expect(isAdultOn("2008-10-24", "2026-10-24T17:00:00Z")).toBe(true);
  });

  it("suggests the PRD's tax form", () => {
    expect(suggestedForm({ country: "CA", citizenship: "CA" })).toBe("W-8BEN");
    expect(suggestedForm({ country: "US", citizenship: "CA" })).toBe("W-9");
    expect(suggestedForm({ country: "CA", citizenship: "CA", entity: true })).toBe("W-8BEN-E");
  });
});

describe("calendar dates", () => {
  it("prints a midnight-UTC purchase date as its own day, not the day before in Pacific time", async () => {
    const { fmtDay, humanize } = await import("@/lib/client/format");
    expect(fmtDay("2026-10-24T00:00:00.000Z")).toBe("Oct 24");
    expect(fmtDay("2026-10-24")).toBe("Oct 24");
    expect(humanize("ground_transport")).toBe("Ground transport");
  });
});
