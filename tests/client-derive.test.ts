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
    expect(frozen?.tags[0]).toEqual({ label: "Frozen", tone: "critical" });
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

  it("holds a hacker's travel payout with no project, and not an expense or a submitted project", () => {
    const travel = { ...s.claims[0], id: "C-none", personId: s.people[0].id, type: "travel" as const };
    const payout = { ...proposed, id: "PO-none", personId: s.people[0].id, sourceId: travel.id, status: "proposed" as const, requestedBy: "u-dana" };
    const none = { ...s, claims: [...s.claims, travel] };
    const held = canRelease(controller, payout, none);
    expect(held.allowed).toBe(false);
    if (!held.allowed) expect(held.reason).toContain("No project submission on record for Priya Raman");
    const submitted = { ...none, people: none.people.map((p) => p.id === travel.personId ? { ...p, projectStatus: "submitted" as const } : p) };
    expect(canRelease(controller, payout, submitted)).toEqual({ allowed: true });
    const expense = { ...s.claims[1], id: "C-exp", personId: s.people[0].id, type: "expense" as const };
    expect(canRelease(controller, { ...payout, sourceId: expense.id }, { ...s, claims: [...s.claims, expense] })).toEqual({ allowed: true });
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
    expect(toMinor("36,44")).toBeNull();
    expect(toMinor("1,00.00")).toBeNull();
    expect(toMinor("1.000,00")).toBeNull();
    expect(toMinor("1,000")).toBe("100000");
    expect(toMinor(" $ 1,000.00 ")).toBe("100000");
    expect(toMinor("36.44")).toBe("3644");
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

describe("readable names", () => {
  it("does not repeat a track that is also the title, and names providers", async () => {
    const { awardName, providerLabel, objectLabel } = await import("@/lib/client/derive");
    expect(awardName({ track: "Judge stipend", title: "Judge stipend" })).toBe("Judge stipend");
    expect(awardName({ track: "First Overall", title: "MacBook Air" })).toBe("First Overall: MacBook Air");
    expect(providerLabel("mock_wire")).toBe("Wire");
    expect(objectLabel({ objectType: "payout", personName: "Priya Raman", objectId: "pay_x" })).toBe("Priya Raman · Payout");
  });
});

describe("releaseInFlight", () => {
  const base = { id: "", runId: "", objectId: "pay_1", objectType: "payout", personName: "Priya Raman", summary: "", actor: "system", facts: {} };
  let n = 0;
  const d = (over: Partial<AppSnapshot["decisions"][number]>): AppSnapshot["decisions"][number] =>
    ({ ...base, id: `d${n++}`, action: "", tool: "", status: "done", createdAt: `2026-10-24T10:0${n}:00Z`, ...over }) as AppSnapshot["decisions"][number];
  const payout = { id: "pay_1", status: "proposed" as const };
  const wait = d({ runId: "wf_1", action: "Controller release requested", tool: "waitForController", status: "waiting" });
  const queue = d({ runId: "wf_1", action: "Controller approval submitted", tool: "queueControllerRelease", status: "running", facts: { quoteFingerprint: "q1" } });

  it("keeps a payout releasable while it only awaits approval", async () => {
    const { releaseInFlight } = await import("@/lib/client/derive");
    expect(releaseInFlight({ decisions: [wait] }, payout)).toBe(false);
  });
  it("is pending once a release is queued and unsettled", async () => {
    const { releaseInFlight } = await import("@/lib/client/derive");
    expect(releaseInFlight({ decisions: [wait, queue] }, payout)).toBe(true);
  });
  it("unblocks when the run settles or the payout is re-quoted", async () => {
    const { releaseInFlight } = await import("@/lib/client/derive");
    const done = d({ runId: "wf_1", action: "Released", tool: "executePayout", status: "done" });
    const escalated = d({ runId: "wf_1", action: "Controller approval rejected", tool: "waitForController", status: "escalated" });
    const requote = d({ runId: "run_9", action: "payout.verify", tool: "verifyBankChange", status: "done", facts: { quoteFingerprint: "q2" } });
    expect(releaseInFlight({ decisions: [wait, queue, done] }, payout)).toBe(false);
    expect(releaseInFlight({ decisions: [wait, queue, escalated] }, payout)).toBe(false);
    expect(releaseInFlight({ decisions: [wait, queue, requote] }, payout)).toBe(false);
    expect(releaseInFlight({ decisions: [queue] }, { id: "pay_1", status: "paid" })).toBe(false);
    expect(releaseInFlight({ decisions: [] }, { id: "pay_1", status: "processing" })).toBe(true);
  });
});

describe("release outcomes", () => {
  it("blocks direct release in sponsor mode and reports why a queued release stopped", async () => {
    const { canRelease, releaseStopped } = await import("@/lib/client/derive");
    const ari = { id: "u-ari", name: "Ari Novak", email: "a@x", role: "controller" as const };
    const p = { ...s.payouts[1], id: "pay_9", status: "proposed" as const, requestedBy: "u-dana" };
    expect(canRelease(ari, p, { ...s, org: { ...s.org, mode: "sponsor" } }).allowed).toBe(false);
    expect(canRelease(ari, p, { ...s, org: { ...s.org, mode: "direct" }, decisions: [] }).allowed).toBe(true);
    const dec = (over: Partial<AppSnapshot["decisions"][number]>) =>
      ({ id: over.tool ?? "x", runId: "r", objectId: "pay_9", objectType: "payout", personName: "", action: "", summary: "", actor: "", facts: {}, status: "done", tool: "", createdAt: "2026-10-24T10:00:00Z", ...over }) as AppSnapshot["decisions"][number];
    const quote = dec({ action: "payout.propose", tool: "quotePayouts", createdAt: "2026-10-24T10:00:00Z" });
    const stopped = dec({ tool: "waitForController", status: "escalated", summary: "Pays through its fiscal sponsor.", createdAt: "2026-10-24T10:05:00Z" });
    expect(releaseStopped({ decisions: [quote, stopped] }, p)?.summary).toBe("Pays through its fiscal sponsor.");
    const requote = dec({ action: "payout.requote", tool: "quotePayouts", createdAt: "2026-10-24T10:06:00Z" });
    expect(releaseStopped({ decisions: [quote, stopped, requote] }, p)).toBeUndefined();
  });
});

describe("self-beneficiary", () => {
  it("disables release, fulfillment and review for the recipient matched by email when no personId is linked", async () => {
    const { canRelease, canFulfill, canReview } = await import("@/lib/client/derive");
    const me = { ...s.people[0], id: "per_me", email: "Casey@Example.test ", adult: true, taxStatus: "valid" as const };
    const ctrl = { id: "mem_casey", name: "Casey Controller", email: "casey@example.test", role: "controller" as const };
    const snap = { ...s, org: { ...s.org, mode: "direct" as const }, people: [...s.people, me], decisions: [], payouts: [] };
    const payout = { ...s.payouts[1], id: "pay_me", personId: "per_me", status: "proposed" as const, requestedBy: "u-dana" };
    expect(canRelease(ctrl, payout, snap)).toEqual({ allowed: false, reason: "This payout is to you. A different controller must release it." });
    const award = { ...s.awards[0], id: "awd_me", personId: "per_me", kind: "item" as const, fulfillment: "local" as const, status: "ready" as const, requestedBy: "u-dana", teamId: undefined };
    expect(canFulfill(ctrl, award, { ...snap, awards: [award] }).allowed).toBe(false);
    expect(canReview(ctrl, { requestedBy: "u-dana", personId: "per_me" }, snap).allowed).toBe(false);
    expect(canRelease(ctrl, { ...payout, personId: s.people[1].id }, snap).allowed).toBe(true);
  });
});

describe("failed checks", () => {
  it("states each failure as a failure, never the passing label", async () => {
    const { failedCheckText } = await import("@/lib/client/derive");
    expect(failedCheckText({ code: "agent_limit", label: "Within the agent's auto-approve limit", detail: "$423.81 against a $300.00 limit." })).toBe("Over the $300.00 auto-approve limit: $423.81");
    expect(failedCheckText({ code: "adult", label: "18 or older at event start", detail: "Age 17 on 2026-10-24." })).toBe("Under 18 at event start: age 17");
    expect(failedCheckText({ code: "cabin", label: "Economy cabin", detail: "Cabin: business." })).toBe("Business cabin, economy only");
    expect(failedCheckText({ code: "cap", label: "Under the travel cap", detail: "$565.25 against a $500.00 cap after conversion to USD." })).toBe("Over the $500.00 travel cap: $565.25 after conversion");
    expect(failedCheckText({ code: "booking_deadline", label: "Booked before the deadline", detail: "Booked 2026-10-14 after the 2026-10-10 deadline." })).toBe("Booked 2026-10-14 after the 2026-10-10 deadline");
  });
  it("leads inbox claims with their decisive failure as a chip", async () => {
    const { buildInbox } = await import("@/lib/client/derive");
    const claim = { ...s.claims[0], status: "escalated" as const, checks: [
      { code: "agent_limit", label: "Within the agent's auto-approve limit", passed: false, detail: "$423.81 against a $300.00 limit." },
      { code: "adult", label: "18 or older at event start", passed: false, detail: "Age 17 on 2026-10-24." },
    ] };
    const item = buildInbox({ ...s, claims: [claim] }).find((i) => i.id === `claim:${claim.id}`)!;
    expect(item.title).toBe(claim.personName);
    expect(item.tags).toEqual([
      { label: "Under 18", tone: "critical", title: "Under 18 at event start: age 17" },
      { label: "Over limit", tone: "neutral", title: "Over the $300.00 auto-approve limit: $423.81" },
    ]);
  });
});

describe("agent rail lines", () => {
  it("names each run's subject and says what happened in a line that survives truncation", async () => {
    const { groupRuns, runSubject, runLine } = await import("@/lib/client/derive");
    const d = (over: Partial<AppSnapshot["decisions"][number]>) =>
      ({ id: Math.random().toString(36), runId: "r1", objectId: "pay_q", objectType: "payout", personName: "", action: "", summary: "", actor: "", facts: {}, status: "done", tool: "", createdAt: "2026-10-24T10:00:00Z", ...over }) as AppSnapshot["decisions"][number];
    const payout = { ...s.payouts[1], id: "pay_q", personName: "Quinn Davis", grossMinor: "60000", withholdingMinor: "0", netMinor: "60000", currency: "USD" };
    const [run] = groupRuns([
      d({ personName: "Quinn Davis", tool: "waitForController", status: "waiting", summary: "This exact payout quote is waiting for a controller.", createdAt: "2026-10-24T10:00:00Z" }),
      d({ tool: "waitForController", status: "waiting", summary: "Still waiting.", createdAt: "2026-10-24T10:01:00Z" }),
    ]);
    expect(runSubject(run, { payouts: [payout], packets: [] })).toBe("Quinn Davis · $600.00");
    expect(runLine(run, { payouts: [payout] })).toBe("Awaiting controller");
    const [paid] = groupRuns([d({ runId: "r2", personName: "Quinn Davis", tool: "executePayout", status: "done", summary: "Released $600.00 to ••9625 by wire (sim_x)." })]);
    expect(runLine(paid, { payouts: [payout] })).toBe("Paid $600.00 · ••9625");
    const [filings] = groupRuns([d({ runId: "f", objectType: "filings", objectId: "2026", tool: "draftFilings", summary: "Drafted 0 filing(s) for 2026.", facts: { year: 2026, count: 0 } })]);
    expect(runSubject(filings, { payouts: [], packets: [] })).toBe("Filing drafts 2026");
    expect(runLine(filings, { payouts: [] })).toBe("No new filings to draft");
    const [packet] = groupRuns([d({ runId: "k", objectType: "packet", objectId: "sp_1", tool: "reconcile", status: "escalated", summary: "Sponsor paid $970.00 on a $1,000.00 request (short $30.00). Nothing posted." })]);
    expect(runLine(packet, { payouts: [] })).toBe("Short $30.00");
  });
});
