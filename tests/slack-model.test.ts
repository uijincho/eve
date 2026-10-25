import { describe, expect, it } from "vitest";

import type * as s from "../lib/db/schema";
import { fingerprint, renderAlertBatch, renderCard, renderDigest, renderResolved } from "../lib/slack/blocks";
import { currentBatch, desiredItems, infoAlerts, recommendedChoice, releaseBlockers, resolutionFor, timeLeft, type Item, type MemberState, type OrgState, type PersonState } from "../lib/slack/model";
import { digestFacts } from "../lib/slack/sync";
import { scrub, unsafeSlackText } from "../lib/slack/text";

type PayoutRow = typeof s.payout.$inferSelect;
type ClaimRow = typeof s.claim.$inferSelect;
type AwardRow = typeof s.award.$inferSelect;
type MethodRow = typeof s.payoutMethod.$inferSelect;
type PacketRow = typeof s.sponsorPacket.$inferSelect;

const now = new Date("2026-10-25T20:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const member = (id: string, role: MemberState["role"], extra: Partial<MemberState> = {}): MemberState =>
  ({ id, name: id.replace("mem_", ""), role, personId: null, slackUserId: `U_${id}`, muted: [], ...extra });

const person = (id: string, name: string, extra: Partial<PersonState> = {}): PersonState =>
  ({ id, name, country: "CA", role: "hacker", adult: true, taxOk: true, form: "W-8BEN", taxAttention: null, chaseCount: 0, ...extra });

const payout = (id: string, extra: Partial<PayoutRow> = {}): PayoutRow => ({
  id, orgId: "org_1", personId: "per_priya", sourceType: "award", claimId: null, awardId: "awd_mac", grossMinor: 100000n, withholdingMinor: 30000n, feeMinor: 0n,
  netMinor: 70000n, currency: "USD", destinationCurrency: "USD", destinationNetMinor: 70000n, fxRate: "1.00000000", provider: "simulated", truth: "Simulated",
  status: "proposed", frozenFrom: null, reason: "", ruleId: "us-nonus-prize", ruleVersion: 1, ruleVerified: true, reportingForm: "1042-S", reportable: true,
  requestedBy: "agent", releasedBy: null, payoutMethodId: "pm_priya", bankVersion: 1, idempotencyKey: `idem_${id}`, providerRef: null, attempts: 0,
  dueAt: now, paidAt: null, createdAt: hoursAgo(2), ...extra,
});

const claim = (id: string, extra: Partial<ClaimRow> = {}): ClaimRow => ({
  id, orgId: "org_1", eventId: "evt_1", personId: "per_jordan", budgetLineId: null, type: "travel", merchant: "Air Canada", description: "", category: "travel",
  amountMinor: 45000n, currency: "USD", usdMinor: 45000n, fxRate: "1.00000000", fxSource: "No conversion", purchasedAt: hoursAgo(72), travelDate: null, cabin: "economy",
  origin: "YYZ", nameOnReceipt: null, receiptName: null, documentId: null, receiptHash: null, extracted: null, status: "escalated",
  checks: [{ code: "name", label: "Name on receipt", passed: false, detail: "Receipt shows a different traveler." }], reason: "Name on the receipt does not match.",
  dueAt: new Date(now.getTime() + 86_400_000), requestedBy: "mem_jordan", reviewedBy: null, idempotencyKey: null, createdAt: hoursAgo(5), ...extra,
});

const award = (id: string, extra: Partial<AwardRow> = {}): AwardRow => ({
  id, orgId: "org_1", eventId: "evt_1", personId: "per_priya", track: "Overall", title: "First Overall", kind: "item", amountMinor: 129900n, currency: "USD",
  fulfillment: "undecided", status: "ready", recommendation: "Buy it locally. Estimated local price is $1,350.00 in USD. Fair market value is reportable either way.",
  shippingMinor: 41000n, localMinor: 135000n, teamId: null, splitBps: 10000, splitConfirmed: true, dueAt: new Date(now.getTime() + 3_600_000),
  requestedBy: "mem_dana", createdAt: hoursAgo(1), ...extra,
});

const method = (id: string, extra: Partial<MethodRow> = {}): MethodRow => ({
  id, orgId: "org_1", personId: "per_priya", provider: "simulated", currency: "USD", last4: "4421", vaultId: null, status: "active", version: 1,
  requestedVia: "portal", requestedBy: "mem_priya", verificationVaultId: null, verificationSentTo: null, verificationExpiresAt: null,
  verificationAttempts: 0, verifiedAt: null, verifiedBy: null, createdAt: hoursAgo(100), ...extra,
});

const packet = (id: string, extra: Partial<PacketRow> = {}): PacketRow => ({
  id, orgId: "org_1", payoutId: "pay_sponsor", requestedMinor: 100000n, paidMinor: 97000n, status: "exception", submittedAt: hoursAgo(48), dueAt: now,
  reason: "", documentId: null, remittanceMinor: 97000n, feesPaidBy: "org", createdAt: hoursAgo(50), ...extra,
});

function state(extra: Partial<OrgState> = {}): OrgState {
  return {
    now,
    org: { id: "org_1", name: "Blue Hour", isDemo: false, mode: "hybrid", sponsorName: "Westbrook", organizerLimitMinor: 200000n },
    event: { id: "evt_1", name: "Blue Hour Hackathon", startsAt: hoursAgo(40), endsAt: new Date(now.getTime() + 6 * 3_600_000), closingAt: new Date(now.getTime() + 2.5 * 3_600_000) },
    onDutyMemberId: null, backupMemberId: null,
    members: [member("mem_dana", "organizer"), member("mem_sam", "organizer"), member("mem_ari", "controller"), member("mem_lee", "controller")],
    people: new Map([["per_priya", person("per_priya", "Priya Raman")], ["per_jordan", person("per_jordan", "Jordan Okafor", { country: "US", form: "W-9" })]]),
    claims: [], awards: [], payouts: [], methods: [method("pm_priya")], packets: [], budgets: [], portalRuns: [], overrides: [],
    latest: new Map(), holds: new Map(), keptFrozen: new Map(),
    ...extra,
  };
}

const audiences = (item: Item | undefined) => item?.audiences.map((a) => (a.kind === "member" ? `${a.memberId}${a.backup ? "*" : ""}` : "channel")) ?? [];
const byKey = (items: Item[], prefix: string) => items.find((i) => i.key.startsWith(prefix));

describe("Slack routing", () => {
  it("sends a payout batch to every linked controller, bound to the exact terms", () => {
    const st = state({ payouts: [payout("pay_1"), payout("pay_2", { personId: "per_jordan", payoutMethodId: null })] });
    const item = byKey(desiredItems(st), "release:")!;
    expect(audiences(item)).toEqual(["mem_ari", "mem_lee"]);
    const before = currentBatch(st)!.hash;
    const requoted = state({ payouts: [payout("pay_1", { withholdingMinor: 0n, netMinor: 100000n }), payout("pay_2", { personId: "per_jordan" })] });
    expect(currentBatch(requoted)!.hash).not.toBe(before);
  });

  it("leaves sponsor-owned payouts and sponsor-mode orgs out of the direct release batch", () => {
    expect(currentBatch(state({ payouts: [payout("pay_sponsor")], packets: [packet("pk_1", { status: "draft" })] }))).toBeNull();
    expect(currentBatch(state({ payouts: [payout("pay_1")], org: { ...state().org, mode: "sponsor" } }))).toBeNull();
  });

  it("routes claims to the organizer on duty, never to the requester or the beneficiary", () => {
    const members = [member("mem_dana", "organizer"), member("mem_jordan", "organizer", { personId: "per_jordan" }), member("mem_sam", "organizer"), member("mem_ari", "controller")];
    expect(audiences(byKey(desiredItems(state({ members, claims: [claim("clm_1")] })), "claim:"))).toEqual(["mem_dana", "mem_sam"]);
    expect(audiences(byKey(desiredItems(state({ members, onDutyMemberId: "mem_sam", claims: [claim("clm_1")] })), "claim:"))).toEqual(["mem_sam"]);
  });

  it("sends claims over the organizer limit to controllers", () => {
    const items = desiredItems(state({ claims: [claim("clm_big", { usdMinor: 250000n, amountMinor: 250000n })] }));
    const item = byKey(items, "claim:")!;
    expect(audiences(item)).toEqual(["mem_ari", "mem_lee"]);
    expect(item.card.kind === "claim" && item.card.toController).toBe(true);
  });

  it("adds the backup approver once an approval waits too long", () => {
    const overdue = claim("clm_late", { dueAt: hoursAgo(1) });
    const items = desiredItems(state({ onDutyMemberId: "mem_dana", backupMemberId: "mem_ari", claims: [overdue] }));
    expect(audiences(byKey(items, "claim:"))).toEqual(["mem_dana", "mem_ari*"]);
    const batch = desiredItems(state({ backupMemberId: "mem_lee", members: [member("mem_ari", "controller"), member("mem_lee", "controller")], payouts: [payout("pay_old", { createdAt: hoursAgo(50) })] }));
    // Both controllers already have it; nobody new to add.
    expect(audiences(byKey(batch, "release:"))).toEqual(["mem_ari", "mem_lee"]);
  });

  it("posts to the team channel when everyone who can act muted the category", () => {
    const members = [member("mem_ari", "controller", { muted: ["release"] }), member("mem_lee", "controller", { muted: ["release"] })];
    const item = byKey(desiredItems(state({ members, payouts: [payout("pay_1")] })), "release:")!;
    expect(item.audiences).toEqual([{ kind: "channel", why: expect.stringContaining("muted") }]);
  });

  it("sends a bank-change freeze to controllers and organizers, not to the recipient", () => {
    const members = [member("mem_dana", "organizer"), member("mem_ari", "controller"), member("mem_priya", "organizer", { personId: "per_priya" })];
    const st = state({
      members,
      methods: [method("pm_old", { last4: "1111" }), method("pm_new", { last4: "9876", status: "pending_verification", version: 2, createdAt: hoursAgo(1) })],
      payouts: [payout("pay_frozen", { status: "frozen" })],
    });
    const item = byKey(desiredItems(st), "freeze:")!;
    expect(item.key).toBe("freeze:pm_new");
    expect(audiences(item)).toEqual(["mem_dana", "mem_ari"]);
    expect(item.card).toMatchObject({ kind: "freeze", fromLast4: "1111", toLast4: "9876", payoutCount: 1 });
  });

  it("asks the organizer about undecided item prizes until a payout locks the choice", () => {
    const items = desiredItems(state({ awards: [award("awd_mac")] }));
    expect(byKey(items, "prize:")?.card).toMatchObject({ kind: "prize", recommended: "local" });
    expect(byKey(desiredItems(state({ awards: [award("awd_mac")], payouts: [payout("pay_1", { awardId: "awd_mac" })] })), "prize:")).toBeUndefined();
    expect(recommendedChoice("Ship the item. Domestic winner.")).toBe("ship");
    expect(recommendedChoice("Offer the cash equivalent. No carrier.")).toBe("cash");
  });
});

describe("Slack event weekend", () => {
  it("counts winners who still need tax forms and counts down while something blocks release", () => {
    const people = new Map([["per_priya", person("per_priya", "Priya Raman", { taxOk: false })], ["per_jordan", person("per_jordan", "Jordan Okafor", { form: "W-9" })]]);
    const st = state({ people, awards: [award("awd_mac"), award("awd_cash", { personId: "per_jordan", kind: "cash", title: "Best Hack" })] });
    const items = desiredItems(st);
    expect(byKey(items, "winners:")?.card).toMatchObject({ kind: "winners", count: 2, needForms: [{ name: "Priya Raman", form: "W-8BEN" }] });
    const countdown = byKey(items, "countdown:")!;
    expect(countdown.card.kind === "countdown" && countdown.card.left).toBe("about 2 hours");
    expect(releaseBlockers(st).join(" ")).toMatch(/tax form.*Priya Raman/);
    const later = state({ ...st, event: { ...st.event!, closingAt: new Date(now.getTime() + 12 * 3_600_000) } });
    expect(byKey(desiredItems(later), "countdown:")).toBeUndefined();
    expect(timeLeft(20 * 60_000)).toBe("under 30 minutes");
  });
});

describe("Slack channel alerts", () => {
  it("queues failures, sponsor exceptions, budget crossings, computer use and unverified rules once each", () => {
    const st = state({
      payouts: [payout("pay_fail", { status: "failed", reason: "Provider rejected the account." }), payout("pay_sponsor", { status: "processing", provider: "sponsor_packet" }), payout("pay_rule", { status: "paid", ruleVerified: false, paidAt: hoursAgo(1) })],
      packets: [packet("pk_970")],
      budgets: [
        { id: "bl_travel", name: "Travel", capMinor: 1000000n, spentMinor: 700000n, committedMinor: 150000n, usedMinor: 850000n },
        { id: "bl_prizes", name: "Prizes", capMinor: 500000n, spentMinor: 400000n, committedMinor: 200000n, usedMinor: 600000n },
        { id: "bl_food", name: "Food", capMinor: 100000n, spentMinor: 10000n, committedMinor: 0n, usedMinor: 10000n },
      ],
      portalRuns: [{ id: "run_1", packetId: "pk_970", status: "escalated", page: "payee", turns: 9, error: null, confirmation: null, createdAt: hoursAgo(1), updatedAt: hoursAgo(0.5), personName: "Priya Raman", screenshots: ["doc_a", "doc_b", "doc_c"] }],
    });
    const alerts = infoAlerts(st);
    expect(alerts.map((a) => a.key).sort()).toEqual([
      "budget:bl_prizes:500000:100", "budget:bl_travel:1000000:80", "packet:pk_970:exception:97000", "payout:pay_fail:failed:0", "portal:run_1:escalated", "taxrule:pay_rule",
    ]);
    expect(alerts.find((a) => a.category === "sponsor")?.text).toContain("$970.00 on a $1,000.00 request");
    expect(alerts.find((a) => a.category === "computer_use")?.documentIds).toEqual(["doc_a", "doc_b"]);
    const batch = renderAlertBatch(alerts, false, "https://eve.test/overview");
    expect(unsafeSlackText(batch as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe("Slack cards", () => {
  const st = state({
    claims: [claim("clm_1")], awards: [award("awd_mac")],
    payouts: [payout("pay_1"), payout("pay_frozen", { personId: "per_jordan", status: "frozen", awardId: "awd_other", payoutMethodId: "pm_j" })],
    methods: [method("pm_priya"), method("pm_j", { personId: "per_jordan", last4: "2222" }), method("pm_j2", { personId: "per_jordan", last4: "3333", status: "pending_verification", version: 2 })],
  });
  const items = desiredItems(st);

  it("render with action buttons and only names, amounts and last 4 digits", () => {
    for (const item of items) {
      for (const audience of item.audiences) {
        const body = renderCard(item, audience);
        expect(unsafeSlackText(body as unknown as Record<string, unknown>)).toBeNull();
        expect(JSON.stringify(body)).not.toMatch(/@example|vault/i);
      }
    }
    const release = renderCard(byKey(items, "release:")!, { kind: "member", memberId: "mem_ari", slackUserId: "U1", backup: false });
    expect(JSON.stringify(release)).toContain(`"value":"${byKey(items, "release:")!.key}|${currentBatch(st)!.hash}"`);
    expect(JSON.stringify(release)).toContain("••4421");
  });

  it("fingerprints change only when the card changes", () => {
    const item = byKey(items, "claim:")!;
    const a = { kind: "member" as const, memberId: "mem_dana", slackUserId: "U1", backup: false };
    expect(fingerprint(renderCard(item, a))).toBe(fingerprint(renderCard(item, a)));
    expect(fingerprint(renderCard(item, a))).not.toBe(fingerprint(renderCard(item, { ...a, backup: true })));
  });

  it("names who resolved an item and whether it was via Slack, with no buttons left", () => {
    const approved = state({
      claims: [claim("clm_1", { status: "approved", reason: "Receipt matches after the attendee's note." })],
      latest: new Map([["clm_1", { action: "claim.review", actor: "Dana Whitfield", via: true, summary: "", facts: { via: "slack" }, at: now }]]),
    });
    const res = resolutionFor("claim:clm_1", approved);
    expect(res.text).toBe("Approved by Dana Whitfield via Slack: Receipt matches after the attendee's note.");
    const body = JSON.stringify(renderResolved(res, false));
    expect(body).not.toContain("eve.claim.approve");
    expect(resolutionFor("claim:gone", approved).text).toContain("no longer open");
  });
});

describe("Slack text safety", () => {
  it("refuses taxpayer IDs and account numbers but allows amounts, dates and mentions", () => {
    expect(unsafeSlackText({ text: "TIN 123-45-6789" })).not.toBeNull();
    expect(unsafeSlackText({ blocks: [{ type: "section", text: { type: "mrkdwn", text: "EIN 12-3456789" } }] })).not.toBeNull();
    expect(unsafeSlackText({ text: "Account 000123456789" })).not.toBeNull();
    expect(unsafeSlackText({ text: "Paid $1,234,567.00 to ••4421 on <!date^1792900000^{date_short}|2026-10-25 20:00 UTC> for <@U012345678>" })).toBeNull();
    expect(unsafeSlackText({ blocks: [{ type: "actions", elements: [{ type: "button", value: "pay_12345678901", text: { type: "plain_text", text: "Release" } }] }] })).toBeNull();
    expect(scrub("Wire to 000123456789, SSN 123 45 6789")).toBe("Wire to •••, SSN •••");
  });

  it("renders a digest that stays a summary", () => {
    const st = state({
      claims: [claim("clm_auto", { status: "approved", reviewedBy: "agent", usdMinor: 12000n }), claim("clm_open", { createdAt: hoursAgo(100) })],
      payouts: [payout("pay_paid", { status: "paid", paidAt: hoursAgo(3) })],
      people: new Map([["per_priya", person("per_priya", "Priya Raman", { taxAttention: "missing", chaseCount: 2 })]]),
      budgets: [{ id: "bl_1", name: "Travel", capMinor: 100000n, spentMinor: 90000n, committedMinor: 20000n, usedMinor: 110000n }],
    });
    const facts = digestFacts(st, "daily", hoursAgo(24), new Set(["clm_auto"]));
    expect(facts).toMatchObject({
      autoApproved: { count: 1, total: "$120.00" }, payoutsSent: { count: 1, net: "$700.00", withheld: "$300.00" },
      missingForms: [{ name: "Priya Raman", reminders: 2 }], inbox: { overThree: 1 },
      budgets: [{ name: "Travel", spent: "$900.00", committed: "$200.00", remaining: "$100.00", over: true }],
    });
    const body = renderDigest(facts);
    expect(unsafeSlackText(body as unknown as Record<string, unknown>)).toBeNull();
    expect(JSON.stringify(body)).toContain("reminder 2 of 4");
  });
});
