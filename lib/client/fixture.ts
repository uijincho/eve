// TEMPORARY browser-development fixture. Opt-in only: set
// NEXT_PUBLIC_EVE_FIXTURE=1. It never fakes success: every action answers
// ok:false so nothing looks persisted. Delete once the backend is merged.
import type { ActionResult, AppAction, AppSnapshot, Decision } from "@/lib/contracts";

export function fixtureEnabled(): boolean {
  // Never in a production build, and never as a fallback when the API fails.
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_EVE_FIXTURE === "1";
}

export function fixtureAction(action: AppAction): ActionResult {
  return { ok: false, message: `Fixture mode: ${action} was not sent to a server.` };
}

const PERSONA_KEY = "eve-fixture-persona";

/** Fixture-only persona switch, kept in this tab. */
export function fixtureSetPersona(id: string): ActionResult {
  sessionStorage.setItem(PERSONA_KEY, id);
  return { ok: true, message: "Fixture persona switched in this tab only." };
}

const at = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

export function fixtureSnapshot(): AppSnapshot {
  const now = new Date().toISOString();
  const step = (
    runId: string,
    n: number,
    over: Partial<Decision> & Pick<Decision, "summary" | "tool" | "status">,
  ): Decision => ({
    id: `${runId}-${n}`,
    runId,
    objectId: "C-2241",
    objectType: "claim",
    personName: "Marcus Lee",
    action: "check",
    actor: "agent",
    createdAt: at(-30 + n),
    facts: {},
    ...over,
  });
  const personas: AppSnapshot["personas"] = [
      { id: "u-dana", name: "Dana Whitfield", email: "dana@example.test", role: "organizer" },
      { id: "u-ari", name: "Ari Novak", email: "ari@example.test", role: "controller" },
      { id: "u-priya", name: "Priya Raman", email: "priya@example.test", role: "attendee", personId: "p-priya" },
      { id: "u-june", name: "June Park", email: "june@example.test", role: "auditor" },
  ];
  const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("fixturePersona") : null;
  if (fromUrl) sessionStorage.setItem(PERSONA_KEY, fromUrl);
  const chosen = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(PERSONA_KEY) : null;
  return {
    demo: true,
    now,
    actor: personas.find((p) => p.id === chosen) ?? personas[0],
    personas,
    org: {
      id: "org", name: "Cal Hacks", country: "US", mode: "hybrid", agentLimitMinor: "30000",
      organizerLimitMinor: "150000", currency: "USD", sponsorName: "Bayview Community Foundation",
      sponsorTurnaroundDays: 10, feesPaidBy: "org", notificationChannel: "#finance", policyNotes: "No gift cards.",
    },
    event: {
      id: "ev", name: "Cal Hacks 13.0", startsAt: at(-60 * 26), endsAt: at(60 * 20), venue: "UC Berkeley",
      expectedHeadcount: 300, travelCapMinor: "50000", economyOnly: true, bookingDeadline: at(-60 * 24 * 10),
      checkInAt: at(-60 * 26), closingAt: at(78), locked: false,
    },
    people: [
      { id: "p-priya", name: "Priya Raman", email: "priya@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2001-04-12", address: "Toronto, ON", role: "Hacker", adult: true, taxForm: "W-8BEN", taxStatus: "missing", payoutCurrency: "CAD", payoutLast4: "", paidYtdMinor: "0", outstandingMinor: "129900", chaseCount: 1 },
      { id: "p-jordan", name: "Jordan Okafor", email: "jordan@example.test", country: "CA", citizenship: "CA", dateOfBirth: "1999-02-03", address: "Montreal, QC", role: "Hacker", adult: true, taxForm: "W-8BEN", taxStatus: "valid", taxSignedAt: at(-60 * 24 * 30), taxLast4: "4471", payoutCurrency: "CAD", payoutLast4: "9902", payoutChangedAt: at(-18), paidYtdMinor: "0", outstandingMinor: "150000", chaseCount: 0 },
      { id: "p-marcus", name: "Marcus Lee", email: "marcus@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2000-08-21", address: "Toronto, ON", role: "Hacker", adult: true, taxForm: "W-8BEN", taxStatus: "valid", taxLast4: "1180", payoutCurrency: "CAD", payoutLast4: "3321", paidYtdMinor: "0", outstandingMinor: "49512", chaseCount: 0 },
      { id: "p-lukas", name: "Lukas Becker", email: "lukas@example.test", country: "DE", citizenship: "DE", dateOfBirth: "1988-01-15", address: "Munich", role: "Judge", adult: true, taxForm: "W-8BEN", taxStatus: "expired", taxExpiresAt: at(60 * 24 * 3), payoutCurrency: "EUR", payoutLast4: "0912", paidYtdMinor: "0", outstandingMinor: "25000", chaseCount: 2 },
      { id: "p-sam", name: "Sam Ortiz", email: "sam@example.test", country: "US", citizenship: "US", dateOfBirth: "2002-11-30", address: "Oakland, CA", role: "Hacker", adult: true, taxForm: "W-9", taxStatus: "valid", taxLast4: "5521", payoutCurrency: "USD", payoutLast4: "7710", paidYtdMinor: "3820", outstandingMinor: "3820", chaseCount: 0 },
    ],
    claims: [
      { id: "C-2241", personId: "p-marcus", personName: "Marcus Lee", type: "travel", merchant: "Air Canada", description: "YYZ to SFO round trip", category: "Travel", amountMinor: "67940", currency: "CAD", usdMinor: "49512", fxRate: "0.72876", fxSource: "ECB, Oct 3", purchasedAt: at(-60 * 24 * 21), travelDate: at(-60 * 28), cabin: "economy", origin: "YYZ", receiptName: "aircanada.pdf", status: "escalated", checks: [
        { code: "name", label: "Name matches profile", passed: true, detail: "Marcus Lee" },
        { code: "dates", label: "Dates fit the event", passed: true, detail: "Oct 23 to Oct 27" },
        { code: "cabin", label: "Economy", passed: true, detail: "Fare class L" },
        { code: "cap", label: "Under the $500 cap", passed: true, detail: "$495.12 after FX" },
        { code: "limit", label: "Under the $300 auto-approve limit", passed: false, detail: "$495.12 is above $300.00" },
      ], reason: "Above the $300 auto-approve limit. Within 1% of the cap.", dueAt: at(60 * 24 * 2), createdAt: at(-60 * 5), requestedBy: "p-marcus" },
      { id: "C-2240", personId: "p-sam", personName: "Sam Ortiz", type: "expense", merchant: "Lyft", description: "Ride to venue", category: "Ground transport", amountMinor: "3820", currency: "USD", usdMinor: "3820", fxRate: "1", fxSource: "USD", purchasedAt: at(-60 * 30), status: "needs_info", checks: [{ code: "dup", label: "No duplicate", passed: false, detail: "Matches C-2231" }], reason: "Same receipt as C-2231. Eve asked Sam whether this is a second ride.", dueAt: at(60 * 24 * 7), createdAt: at(-60 * 3), requestedBy: "p-sam" },
      { id: "C-2231", personId: "p-sam", personName: "Sam Ortiz", type: "expense", merchant: "Lyft", description: "Ride to venue", category: "Ground transport", amountMinor: "3820", currency: "USD", usdMinor: "3820", fxRate: "1", fxSource: "USD", purchasedAt: at(-60 * 30), status: "approved", checks: [{ code: "cap", label: "Within policy", passed: true, detail: "Under $300" }], reason: "Auto-approved within policy.", dueAt: at(60 * 24 * 7), createdAt: at(-60 * 6), requestedBy: "p-sam" },
    ],
    awards: [
      { id: "A-1", personId: "p-priya", personName: "Priya Raman", track: "First Overall", title: "MacBook Air", kind: "item", amountMinor: "129900", currency: "USD", fulfillment: "undecided", status: "needs_form", recommendation: "Cash equivalent: shipping plus duty is about $214 and a W-8BEN is still unsigned.", shippingMinor: "21400", localMinor: "133800", splitConfirmed: true, dueAt: at(78), requestedBy: "u-dana" },
    ],
    payouts: [
      { id: "PO-7", personId: "p-jordan", personName: "Jordan Okafor", sourceId: "A-2", sourceType: "award", grossMinor: "150000", withholdingMinor: "45000", feeMinor: "0", netMinor: "105000", currency: "USD", destinationCurrency: "CAD", destinationNetMinor: "144100", fxRate: "1.3724", provider: "Stripe test", truth: "Test mode", status: "frozen", reason: "CAD ••4471 changed to ••9902 18 minutes ago. Eve emailed Jordan's original address to confirm.", ruleId: "US-NRA-PRIZE", ruleVersion: 2, ruleVerified: false, requestedBy: "u-dana", createdAt: at(-120), dueAt: at(18) },
      { id: "PO-8", personId: "p-sam", personName: "Sam Ortiz", sourceId: "C-2231", sourceType: "claim", grossMinor: "3820", withholdingMinor: "0", feeMinor: "25", netMinor: "3795", currency: "USD", destinationCurrency: "USD", destinationNetMinor: "3795", fxRate: "1", provider: "Stripe test", truth: "Test mode", status: "proposed", reason: "Approved claim C-2231", ruleId: "US-REIMB", ruleVersion: 1, ruleVerified: true, requestedBy: "u-dana", createdAt: at(-60), dueAt: at(18) },
    ],
    budgets: [
      { id: "b-travel", name: "Travel", capMinor: "6000000", spentMinor: "3842000", committedMinor: "920000", fundingSource: "University" },
      { id: "b-prizes", name: "Prizes", capMinor: "2500000", spentMinor: "0", committedMinor: "2780000", fundingSource: "Sponsors" },
      { id: "b-food", name: "Food", capMinor: "3000000", spentMinor: "2210000", committedMinor: "300000", fundingSource: "Sponsors" },
    ],
    packets: [
      { id: "SP-0112", payoutId: "PO-3", personName: "Ana Silva", requestedMinor: "100000", paidMinor: "97000", status: "exception", submittedAt: at(-60 * 24 * 9), dueAt: at(60 * 24 * 5), reason: "Remittance shows a $30.00 wire fee deducted." },
    ],
    decisions: [
      step("run-1", 1, { summary: "Read the receipt: Air Canada, CA$679.40, Oct 3.", tool: "extractReceipt", status: "done" }),
      step("run-1", 2, { summary: "Converted at 0.72876 (ECB, Oct 3): $495.12.", tool: "convertFx", status: "done", ruleId: "FX-ECB", ruleVersion: 1 }),
      step("run-1", 3, { summary: "Above the $300 auto-approve limit. Sent to the inbox.", tool: "checkPolicy", status: "escalated", ruleId: "TRAVEL-CAP", ruleVersion: 3 }),
      step("run-2", 1, { objectId: "PO-7", objectType: "payout", personName: "Jordan Okafor", summary: "Bank details changed 18 minutes before release.", tool: "watchBankChange", status: "done" }),
      step("run-2", 2, { objectId: "PO-7", objectType: "payout", personName: "Jordan Okafor", summary: "Froze payout PO-7 and emailed the original address.", tool: "freezePayout", status: "frozen" }),
      step("run-3", 1, { objectId: "A-1", objectType: "award", personName: "Priya Raman", summary: "Sent W-8BEN link to Priya.", tool: "chase", status: "waiting", nextActionAt: at(60) }),
    ],
    filings: [
      { id: "F-1", personId: "p-jordan", personName: "Jordan Okafor", year: 2026, form: "1042-S", grossMinor: "150000", withholdingMinor: "45000", status: "draft" },
    ],
    rules: [
      { id: "US-NRA-PRIZE", version: 2, payerCountry: "US", payeeCountry: "*", paymentType: "prize", rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S", verified: false, sourceUrl: "https://www.irs.gov/individuals/international-taxpayers/nra-withholding", explanation: "30% default on prizes to non-US individuals without a valid treaty claim.", effectiveFrom: "2026-01-01" },
    ],
    notices: [],
    scoreboard: { total: 40, evaluated: 0, caught: 0, missed: 0, falsePositives: 0, wrongfulPayouts: 0, results: [] },
    integrationStatus: [
      { name: "Payouts", mode: "Fixture", detail: "Temporary browser fixture; nothing is sent." },
    ],
  };
}
