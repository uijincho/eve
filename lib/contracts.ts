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
  /**
   * Functional currency of the books (always "USD" today; absent means USD). Ledger, payout gross/withholding/fee/net,
   * Claim.usdMinor, BudgetLine amounts and Person.paidYtdMinor/outstandingMinor are in it.
   * Filing amounts use Filing.currency (CAD for CRA worksheets, USD for US drafts).
   * `currency` is what the org enters policy limits, the travel cap and budget caps in; Award.amountMinor
   * is in Award.currency; Payout.destination* is in the recipient's currency.
   */
  booksCurrency?: string;
}
export interface EventRecord {
  id: string; name: string; startsAt: string; endsAt: string; venue: string;
  expectedHeadcount: number; travelCapMinor: Minor; economyOnly: boolean;
  bookingDeadline: string; checkInAt: string; closingAt: string; locked: boolean;
}
export interface Person {
  id: string; name: string; email: string; country: string; citizenship: string;
  dateOfBirth: string; address: string; role: string; adult: boolean;
  /** Hackathon project. Unknown until an organizer or a CSV says otherwise. */
  projectStatus: "unknown" | "submitted" | "none";
  projectUrl?: string; projectSource?: "csv" | "organizer"; projectUpdatedAt?: string;
  taxForm: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration";
  taxStatus: "missing" | "valid" | "expired" | "review";
  taxSignedAt?: string; taxExpiresAt?: string; taxLast4?: string;
  /** Country of the treaty claimed on the current W-8BEN. Set only when it names an article, which is what the server treats as a claim. */
  taxTreatyCountry?: string;
  /**
   * PDF of the current signed form (GET /api/documents/:id). For a W-8BEN, the
   * filled IRS form plus Eve's signature record; for other forms, Eve's receipt.
   * Only in the person's own snapshot and staff snapshots.
   */
  taxDocumentId?: string;
  /** The form that document records; can differ from taxForm when the signed form is not the expected one. */
  taxDocumentForm?: "W-9" | "W-8BEN" | "W-8BEN-E" | "Residency declaration";
  payoutCurrency: string; payoutLast4: string; payoutChangedAt?: string;
  paidYtdMinor: Minor; outstandingMinor: Minor; chaseCount: number;
}
export interface Check { code: string; label: string; passed: boolean; detail: string }
/** A flagged fare: the question the agent asked the attendee, the peer evidence, and their answer. */
export interface FareReview {
  question: string; askedAt: string; route: string;
  peerCount?: number; medianMinor?: Minor; percentileMinor?: Minor;
  /** Market price compared with: Google's typical high, or the tracked cheapest fare. */
  market?: { basis: "typical_high" | "cheapest"; referenceMinor: Minor; capturedOn: string; source: string; truth: string; priceOnDateMinor?: Minor };
  explanation?: string; explainedAt?: string;
}
export interface Claim {
  id: string; personId: string; personName: string; type: "travel" | "expense";
  merchant: string; description: string; category: string; amountMinor: Minor;
  currency: string; usdMinor: Minor; fxRate: string; fxSource: string;
  purchasedAt: string; travelDate?: string; cabin?: string; origin?: string;
  receiptName?: string; documentId?: string; receiptHash?: string;
  status: "submitted" | "processing" | "approved" | "escalated" | "rejected" | "needs_info" | "paid";
  checks: Check[]; reason: string; dueAt: string; createdAt: string; requestedBy: string;
  fareReview?: FareReview;
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
export interface BudgetLine { id: string; name: string; capMinor: Minor; spentMinor: Minor; committedMinor: Minor; fundingSource: string; currency?: string; enteredCapMinor?: Minor; enteredCurrency?: string; fxSource?: string }
export interface SponsorPacket {
  id: string; payoutId: string; personName: string; requestedMinor: Minor; paidMinor: Minor;
  status: "draft" | "submitted" | "questioned" | "paid" | "exception";
  submittedAt?: string; dueAt: string; reason: string; documentId?: string;
}
/** Eve entering a sponsor packet on the sponsor's web portal (computer use). Staff only. */
export interface PortalRun {
  id: string; packetId: string; workflowRunId?: string;
  status: "starting" | "filling" | "awaiting_approval" | "submitting" | "submitted" | "escalated" | "rejected" | "failed" | "stopped";
  page: string; pageLabel: string; pagesVisited: string[]; turns: number;
  /** View-only live desktop, present only while the run is active. */
  streamUrl?: string;
  reviewCheck?: { label: string; packet: string; portal: string; ok: boolean }[];
  escalation?: { field: string; reason: string };
  confirmation?: string; approvedByName?: string; approvedAt?: string; error?: string;
  requestedBy: string; createdAt: string; updatedAt: string;
}
export interface DisbursementBatch {
  id: string; status: "preparing" | "filling" | "submitting" | "submitted" | "failed" | "cancelled";
  payoutIds: string[]; packetIds: string[]; count: number; grossMinor: Minor; withholdingMinor: Minor; netMinor: Minor;
  documentId?: string; approvedBy: string; approvedByName: string; streamUrl?: string; confirmation?: string; error?: string;
  canRetry: boolean; canCancel: boolean; turns: number; createdAt: string;
}
export interface Decision {
  id: string; runId: string; objectId: string; objectType: string; personName: string;
  action: string; summary: string; actor: string; createdAt: string;
  status: "running" | "waiting" | "done" | "escalated" | "frozen";
  tool: string; ruleId?: string; ruleVersion?: number;
  facts: Record<string, unknown>; checks?: Check[]; documentId?: string; nextActionAt?: string;
}
export interface Filing { id: string; personId: string; personName: string; year: number; form: string; grossMinor: Minor; withholdingMinor: Minor; currency?: string; status: "draft" | "reviewed"; documentId?: string }
export interface TaxRule { id: string; version: number; payerCountry: string; payeeCountry: string; paymentType: string; rateBps: number; thresholdMinor: Minor; form: string; reportingForm: string; verified: boolean; sourceUrl: string; explanation: string; effectiveFrom: string; effectiveTo?: string }
export interface Notice { id: string; personId?: string; channel: string; title: string; body: string; createdAt: string; status: "queued" | "sent" | "simulated" }
export interface Scoreboard { total: number; evaluated: number; caught: number; missed: number; falsePositives: number; wrongfulPayouts: number; lastRunAt?: string; results: { id: string; scenario: string; expected: string; actual: string; passed: boolean }[] }
export interface AppSnapshot {
  actor: Actor; personas: Actor[]; org: Organization; event: EventRecord;
  people: Person[]; claims: Claim[]; awards: Award[]; payouts: Payout[];
  budgets: BudgetLine[]; batches?: DisbursementBatch[]; packets: SponsorPacket[]; portalRuns: PortalRun[]; decisions: Decision[];
  filings: Filing[]; rules: TaxRule[]; notices: Notice[]; scoreboard: Scoreboard;
  demo: boolean; now: string; integrationStatus: { name: string; mode: string; detail: string }[];
  /** Staff only. Absent for attendees. */
  slack?: SlackStatus;
}
/** The org's Slack app connection as Settings shows it. Never a token or a Slack user id. */
export interface SlackStatus {
  /** The server has Slack app credentials. */
  configured: boolean;
  installed: boolean; teamName?: string; channelName?: string;
  onDutyMemberId?: string; backupMemberId?: string;
  me: { linked: boolean; muted: string[] };
  members: { id: string; name: string; role: Role; linked: boolean }[];
}
export type AppAction =
  | "org.update" | "event.update" | "budget.update" | "people.import" | "person.update" | "person.setProject" | "people.markSubmitted"
  | "tax.submit" | "claim.submit" | "claim.review" | "claim.explain" | "award.create" | "award.choose"
  | "award.split" | "award.confirm" | "award.fulfill" | "payout.resolveRule" | "payout.propose" | "payout.release"
  | "payout.bankChange" | "payout.verify" | "payout.retry" | "sponsor.create"
  | "sponsor.batchRelease" | "sponsor.batchRetry" | "sponsor.batchCancel"
  | "sponsor.submit" | "sponsor.reconcile" | "sponsor.portalStart" | "sponsor.portalDecide" | "sponsor.portalStop"
  | "period.lock" | "filings.generate"
  | "demo.reset" | "demo.run" | "agent.run" | "flight.search" | "flight.request"
  | "slack.settings" | "slack.linkCode" | "slack.unlink" | "slack.disconnect";
export interface ActionRequest { action: AppAction; payload: Record<string, unknown> }
export interface ActionResult { ok: boolean; message: string; data?: Record<string, unknown> }

/** Public API: GET /api/app -> AppSnapshot; POST /api/actions -> ActionResult.
 * POST /api/demo/session { personaId } establishes a demo-only signed session.
 * POST /api/documents accepts multipart `file`; returns { id, name, url }.
 * GET /api/documents/:id authorizes and serves a stored document.
 * GET /api/export?type=ledger|claims|payouts|filings|packet&id=... returns CSV/PDF.
 * All mutations validate inputs and authority on the server; role never comes from a mutation payload.
 */
