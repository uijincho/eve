// Action payload builders. Keys follow the backend conventions ({ id, ... });
// if lib/server/ACTIONS.md settles a different key, change it here only.
import type { AppAction, Award, Person } from "@/lib/contracts";

export type ActionCall = { action: AppAction; payload: Record<string, unknown> };

const call = (action: AppAction, payload: Record<string, unknown>): ActionCall => ({
  action,
  payload,
});

export type ReviewDecision = "approve" | "reject" | "needs_info";

export type PersonInput = {
  name: string;
  email: string;
  country: string;
  citizenship?: string;
  dateOfBirth: string;
  address?: string;
  role?: string;
  payoutCurrency?: string;
};

// Mirrors lib/server/action-schemas.ts (strict objects: unknown keys are rejected).
export const payloads = {
  claimReview: (id: string, decision: ReviewDecision, reason: string) =>
    call("claim.review", { id, decision, reason }),
  claimSubmit: (fields: {
    type: "travel" | "expense";
    documentId?: string;
    merchant?: string;
    description?: string;
    category?: string;
    amountMinor?: string;
    currency?: string;
    purchasedAt?: string;
    travelDate?: string;
    origin?: string;
    cabin?: string;
    personId?: string;
    idempotencyKey?: string;
  }) => call("claim.submit", stripEmpty(fields)),

  awardCreate: (fields: {
    personId?: string;
    teamPersonIds?: string[];
    track: string;
    title: string;
    kind: Award["kind"];
    amountMinor: string;
    currency?: string;
    dueAt?: string;
  }) => call("award.create", stripEmpty(fields)),
  awardChoose: (id: string, fulfillment: Exclude<Award["fulfillment"], "undecided">) =>
    call("award.choose", { id, fulfillment }),
  awardSplit: (teamId: string, splits: { personId: string; bps: number }[]) =>
    call("award.split", { teamId, splits }),
  awardConfirm: (id: string) => call("award.confirm", { id }),
  /** Controller confirms an item prize was shipped or bought locally (simulated delivery). */
  awardFulfill: (id: string) => call("award.fulfill", { id }),

  payoutPropose: (sourceId: string, sourceType: "claim" | "award") =>
    call("payout.propose", { sourceId, sourceType }),
  payoutRelease: (ids: string[]) =>
    ids.length === 1 ? call("payout.release", { id: ids[0] }) : call("payout.release", { ids }),
  /** `id` is the person id (or pending method id); `code` is the 6-digit code sent to the original email. */
  payoutVerify: (id: string, code: string, decision: "confirm" | "reject" = "confirm") =>
    call("payout.verify", { id, confirmation: code, decision }),
  payoutRetry: (id: string) => call("payout.retry", { id }),
  payoutBankChange: (personId: string, last4: string, currency: string, requestedVia: "portal" | "email" | "phone" = "portal") =>
    call("payout.bankChange", { personId, last4, currency, requestedVia }),

  taxSubmit: (fields: {
    personId: string;
    form: Person["taxForm"];
    signature: string;
    tin?: string;
    treatyCountry?: string;
    treatyArticle?: string;
  }) => call("tax.submit", { ...stripEmpty(fields), certify: true }),
  personUpdate: (
    id: string,
    fields: Partial<Pick<Person, "name" | "country" | "citizenship" | "dateOfBirth" | "address" | "role" | "payoutCurrency">>,
  ) => call("person.update", { id, ...stripEmpty(fields) }),
  peopleImport: (people: PersonInput[]) =>
    call("people.import", { people: people.map((p) => stripEmpty(p)) }),

  sponsorCreate: (payoutId: string) => call("sponsor.create", { payoutId }),
  sponsorSubmit: (id: string) => call("sponsor.submit", { id }),
  sponsorReconcile: (id: string, fields: { acceptShortfall?: boolean; paidMinor?: string; note?: string }) =>
    call("sponsor.reconcile", { id, ...stripEmpty(fields) }),

  orgUpdate: (fields: Record<string, unknown>) => call("org.update", stripEmpty(fields)),
  eventUpdate: (fields: Record<string, unknown>) => call("event.update", stripEmpty(fields)),
  budgetUpdate: (line: { id?: string; name: string; capMinor: string; fundingSource: string; category?: string }) =>
    call("budget.update", stripEmpty(line)),
  periodLock: (period: string) => call("period.lock", { period }),
  filingsGenerate: (year: number) => call("filings.generate", { year }),

  agentRun: (kind: "claims" | "chase" | "all" = "all") => call("agent.run", { kind }),
  demoRun: () => call("demo.run", {}),
  demoReset: () => call("demo.reset", {}),

  flightSearch: (fields: { origin: string; date?: string; personId?: string }) =>
    call("flight.search", stripEmpty(fields)),
  /**
   * Requests a server-issued offer. Price, carrier and times come only from the
   * server's offer (the signed offerToken from flight.search), never the client.
   */
  flightRequest: (fields: { offerId: string; origin: string; offerToken?: string; personId?: string }) =>
    call("flight.request", stripEmpty(fields)),
};

function stripEmpty<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}

/** Dollars typed by a person ("1,299.5") to an integer minor-unit string. */
export function toMinor(input: string, digits = 2): string | null {
  const clean = input.replace(/[,\s$]/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > digits) return null;
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
  return minor.toString();
}
