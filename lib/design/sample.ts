// Sample data for the /design page. Synthetic people and amounts, labelled
// "Sample data" wherever they render.

export const SAMPLE_NOW = "2026-10-25T13:42:00-07:00";
export const SAMPLE_TIME_ZONE = "America/Los_Angeles";

export type InboxCategory = "approvals" | "holds" | "exceptions";

export type SampleInboxItem = {
  id: string;
  category: InboxCategory;
  title: string;
  /** Short name for the horizon. */
  mark: string;
  meta: string;
  detail: string;
  amountMinor: number;
  currency: string;
  amountNote: string;
  dueAt: string;
  dueContext: string;
  state?: { tone: "critical"; label: string };
  actions: string[];
  blocked?: { action: string; reason: string };
  breakdown?: {
    grossMinor: number;
    deductions: { label: string; amountMinor: number; kind: "withholding" | "fee" }[];
    netLabel: string;
    estimate: boolean;
  };
  rule?: { text: string; verified: boolean };
};

export const SAMPLE_CLOSING = "2026-10-25T15:00:00-07:00";

export const SAMPLE_INBOX: SampleInboxItem[] = [
  {
    id: "jordan",
    category: "exceptions",
    title: "Payout frozen: bank details changed",
    mark: "Jordan · frozen payout",
    meta: "Jordan Okafor · 2nd place, Best Hardware Hack",
    detail:
      "CAD account ••4471 changed to ••9902 at 1:24 PM. Eve emailed Jordan's original address to confirm.",
    amountMinor: 150_000,
    currency: "USD",
    amountNote: "payout",
    dueAt: "2026-10-25T14:00:00-07:00",
    dueContext: "before 2:00 PM release",
    state: { tone: "critical", label: "Frozen" },
    actions: ["Keep frozen", "Mark verified", "View evidence"],
  },
  {
    id: "batch-4",
    category: "approvals",
    title: "Payout batch #4 is ready for release",
    mark: "Batch #4",
    meta: "18 payouts · requested by you",
    detail: "$1,124.70 withheld · est. fees $38.20 · release scheduled 2:00 PM",
    amountMinor: 1_245_000,
    currency: "USD",
    amountNote: "gross",
    dueAt: "2026-10-25T14:00:00-07:00",
    dueContext: "2:00 PM release",
    actions: ["Remind Ari"],
    breakdown: {
      grossMinor: 1_245_000,
      deductions: [
        { label: "Withheld", amountMinor: 112_470, kind: "withholding" },
        { label: "Est. fees", amountMinor: 3_820, kind: "fee" },
      ],
      netLabel: "Est. net paid out",
      estimate: true,
    },
    blocked: {
      action: "Release batch",
      reason:
        "You requested this batch, so a controller must release it. Ari Novak is the controller.",
    },
  },
  {
    id: "priya",
    category: "approvals",
    title: "Prize to a winner in Canada: MacBook Air",
    mark: "Priya · prize",
    meta: "Priya Raman, Toronto · First Overall",
    detail:
      "W-8BEN sent 1:31 PM, not signed. Eve recommends the cash equivalent, est. net $909.30.",
    amountMinor: 129_900,
    currency: "USD",
    amountNote: "item value",
    dueAt: "2026-10-25T15:00:00-07:00",
    dueContext: "closing ceremony",
    actions: ["Accept recommendation", "Compare options", "Ask Priya"],
    breakdown: {
      grossMinor: 129_900,
      deductions: [
        { label: "Withholding 30%", amountMinor: 38_970, kind: "withholding" },
        { label: "Payout fee", amountMinor: 0, kind: "fee" },
      ],
      netLabel: "Est. net received",
      estimate: true,
    },
    rule: {
      text: "US payer, non-US individual, cash prize: 30% default withholding. Rule v2; Canada treaty rate not yet verified.",
      verified: false,
    },
  },
  {
    id: "marcus",
    category: "approvals",
    title: "Travel claim above the $300 auto-approve limit",
    mark: "Marcus · flight",
    meta: "Marcus Lee · YYZ → SFO, Air Canada, economy",
    detail:
      "CA$679.40 at 0.72876 (ECB, Oct 3). All five checks passed; within 1% of the $500 cap.",
    amountMinor: 49_512,
    currency: "USD",
    amountNote: "from CA$679.40",
    dueAt: "2026-10-27T09:00:00-07:00",
    dueContext: "claims review",
    actions: ["Approve", "Reject", "Ask for info"],
    breakdown: {
      grossMinor: 49_512,
      deductions: [],
      netLabel: "Reimbursement",
      estimate: false,
    },
    rule: {
      text: "Travel policy v2: economy only, $500 cap from Canada, auto-approve up to $300.",
      verified: true,
    },
  },
  {
    id: "lukas",
    category: "holds",
    title: "W-8BEN expired; stipend on hold",
    mark: "Lukas · W-8BEN",
    meta: "Lukas Becker, Munich · Judge stipend",
    detail:
      "Signed 2022, lapsed Dec 31, 2025. Eve chased Oct 20 and Oct 22; next chase Oct 28.",
    amountMinor: 25_000,
    currency: "USD",
    amountNote: "stipend",
    dueAt: "2026-10-28T12:00:00-07:00",
    dueContext: "next chase",
    actions: ["Send now", "View chase log"],
  },
  {
    id: "sponsor",
    category: "exceptions",
    title: "Sponsor paid $970.00 on a $1,000.00 request",
    mark: "Sponsor · SP-0112",
    meta: "Packet SP-0112 · Bayview Community Foundation",
    detail: "The remittance shows a $30.00 wire fee deducted. Reconciliation exception, not closed.",
    amountMinor: 97_000,
    currency: "USD",
    amountNote: "of $1,000.00",
    dueAt: "2026-10-30T17:00:00-07:00",
    dueContext: "month-end close",
    actions: ["Accept with fee", "Query sponsor"],
  },
  {
    id: "sam",
    category: "holds",
    title: "Duplicate receipt held",
    mark: "Sam · duplicate",
    meta: "Sam Ortiz · Lyft, submitted twice",
    detail: "Eve approved C-2231 and held C-2240 as the duplicate.",
    amountMinor: 3_820,
    currency: "USD",
    amountNote: "duplicate",
    dueAt: "2026-11-02T17:00:00-08:00",
    dueContext: "claims review",
    actions: ["Reject duplicate", "View both"],
  },
];

export const SAMPLE_CLAIMS = [
  { id: "C-2251", person: "Marcus Lee", what: "YYZ → SFO flight", amountMinor: 49_512, status: "Needs you", due: "2026-10-27T09:00:00-07:00" },
  { id: "C-2248", person: "Ana Souza", what: "GRU → SFO flight", amountMinor: 61_840, status: "Over cap", due: "2026-10-26T17:00:00-07:00" },
  { id: "C-2240", person: "Sam Ortiz", what: "Lyft, duplicate", amountMinor: 3_820, status: "Held", due: "2026-11-02T17:00:00-08:00" },
  { id: "C-2236", person: "Wei Zhang", what: "Checked bag", amountMinor: 3_500, status: "Approved", due: "2026-11-06T17:00:00-08:00" },
  { id: "C-2231", person: "Sam Ortiz", what: "Lyft to venue", amountMinor: 3_820, status: "Approved", due: "2026-11-06T17:00:00-08:00" },
] as const;
