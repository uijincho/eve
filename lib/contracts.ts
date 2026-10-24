/** JSON contracts shared by the server, workflows and UI. Money is a minor-unit string. */
export type Minor = string;
export type Role = "attendee" | "organizer" | "controller" | "auditor" | "agent";
export type Truth = "Test mode" | "Simulated" | "Estimate" | "Unverified rule";
export interface Actor { id: string; name: string; email: string; role: Role; personId?: string }
export interface Organization {
  id: string; name: string; country: string; mode: "direct" | "sponsor" | "hybrid";
  agentLimitMinor: Minor; organizerLimitMinor: Minor; currency: string;
  sponsorName: string; sponsorTurnaroundDays: number; feesPaidBy: "org" | "recipient";
  notificationChannel?: string; policyNotes?: string;
}
export interface EventRecord {
  id: string; name: string; startsAt: string; endsAt: string; venue: string;
  expectedHeadcount: number; travelCapMinor: Minor; economyOnly: boolean;
  bookingDeadline: string; checkInAt: string; closingAt: string; locked: boolean;
}
export interface Person {
  id: string; name: string; email: string; country: string; citizenship: string;
  dateOfBirth: string; address: string; role: string; adult: boolean;
  taxForm: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration";
  taxStatus: "missing" | "valid" | "expired" | "review";
  taxSignedAt?: string; taxExpiresAt?: string; taxLast4?: string;
  payoutCurrency: string; payoutLast4: string; payoutChangedAt?: string;
  paidYtdMinor: Minor; outstandingMinor: Minor; chaseCount: number;
}
export interface Check { code: string; label: string; passed: boolean; detail: string }
export interface Claim {
  id: string; personId: string; personName: string; type: "travel" | "expense";
  merchant: string; description: string; category: string; amountMinor: Minor;
  currency: string; usdMinor: Minor; fxRate: string; fxSource: string;
  purchasedAt: string; travelDate?: string; cabin?: string; origin?: string;
  receiptName?: string; documentId?: string; receiptHash?: string;
  status: "submitted" | "processing" | "approved" | "escalated" | "rejected" | "needs_info" | "paid";
  checks: Check[]; reason: string; dueAt: string; createdAt: string; requestedBy: string;
}
export interface Award {
  id: string; personId: string; personName: string; track: string; title: string;
  kind: "cash" | "item"; amountMinor: Minor; currency: string;
  fulfillment: "undecided" | "ship" | "local" | "cash";
  status: "draft" | "needs_form" | "ready" | "proposed" | "paid";
  recommendation: string; shippingMinor: Minor; localMinor: Minor;
  teamId?: string; splitConfirmed: boolean; dueAt: string; requestedBy: string;
}
export interface Payout {
  id: string; personId: string; personName: string; sourceId: string; sourceType: "claim" | "award";
  grossMinor: Minor; withholdingMinor: Minor; feeMinor: Minor; netMinor: Minor;
  currency: string; destinationCurrency: string; destinationNetMinor: Minor; fxRate: string;
  provider: string; truth: Truth; status: "held" | "proposed" | "approved" | "processing" | "paid" | "failed" | "returned" | "frozen";
  reason: string; ruleId: string; ruleVersion: number; ruleVerified: boolean;
  requestedBy: string; releasedBy?: string; createdAt: string; dueAt: string;
  paidAt?: string; providerRef?: string; bankVersion?: string;
}
export interface BudgetLine { id: string; name: string; capMinor: Minor; spentMinor: Minor; committedMinor: Minor; fundingSource: string }
export interface SponsorPacket {
  id: string; payoutId: string; personName: string; requestedMinor: Minor; paidMinor: Minor;
  status: "draft" | "submitted" | "questioned" | "paid" | "exception";
  submittedAt?: string; dueAt: string; reason: string; documentId?: string;
}
export interface Decision {
  id: string; runId: string; objectId: string; objectType: string; personName: string;
  action: string; summary: string; actor: string; createdAt: string;
  status: "running" | "waiting" | "done" | "escalated" | "frozen";
  tool: string; ruleId?: string; ruleVersion?: number;
  facts: Record<string, unknown>; checks?: Check[]; documentId?: string; nextActionAt?: string;
}
export interface Filing { id: string; personId: string; personName: string; year: number; form: string; grossMinor: Minor; withholdingMinor: Minor; status: "draft" | "reviewed"; documentId?: string }
export interface TaxRule { id: string; version: number; payerCountry: string; payeeCountry: string; paymentType: string; rateBps: number; thresholdMinor: Minor; form: string; reportingForm: string; verified: boolean; sourceUrl: string; explanation: string; effectiveFrom: string; effectiveTo?: string }
export interface Notice { id: string; personId?: string; channel: string; title: string; body: string; createdAt: string; status: "queued" | "sent" | "simulated" }
export interface Scoreboard { total: number; evaluated: number; caught: number; missed: number; falsePositives: number; wrongfulPayouts: number; lastRunAt?: string; results: { id: string; scenario: string; expected: string; actual: string; passed: boolean }[] }
export interface AppSnapshot {
  actor: Actor; personas: Actor[]; org: Organization; event: EventRecord;
  people: Person[]; claims: Claim[]; awards: Award[]; payouts: Payout[];
  budgets: BudgetLine[]; packets: SponsorPacket[]; decisions: Decision[];
  filings: Filing[]; rules: TaxRule[]; notices: Notice[]; scoreboard: Scoreboard;
  demo: boolean; now: string; integrationStatus: { name: string; mode: string; detail: string }[];
}
export type AppAction =
  | "org.update" | "event.update" | "budget.update" | "people.import" | "person.update"
  | "tax.submit" | "claim.submit" | "claim.review" | "award.create" | "award.choose"
  | "award.split" | "award.confirm" | "payout.propose" | "payout.release"
  | "payout.bankChange" | "payout.verify" | "payout.retry" | "sponsor.create"
  | "sponsor.submit" | "sponsor.reconcile" | "period.lock" | "filings.generate"
  | "demo.reset" | "demo.run" | "agent.run" | "flight.search" | "flight.request";
export interface ActionRequest { action: AppAction; payload: Record<string, unknown> }
export interface ActionResult { ok: boolean; message: string; data?: Record<string, unknown> }

/** Public API: GET /api/app -> AppSnapshot; POST /api/actions -> ActionResult.
 * POST /api/demo/session { personaId } establishes a demo-only signed session.
 * POST /api/documents accepts multipart `file`; returns { id, name, url }.
 * GET /api/documents/:id authorizes and serves a stored document.
 * GET /api/export?type=ledger|claims|payouts|filings|packet&id=... returns CSV/PDF.
 * All mutations validate inputs and authority on the server; role never comes from a mutation payload.
 */
