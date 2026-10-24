// Action payload builders. Keys follow the backend conventions ({ id, ... });
// if lib/server/ACTIONS.md settles a different key, change it here only.
import type { AppAction, Award, Person } from "@/lib/contracts";

export type ActionCall = { action: AppAction; payload: Record<string, unknown> };

const call = (action: AppAction, payload: Record<string, unknown>): ActionCall => ({
  action,
  payload,
});

export type ReviewDecision = "approve" | "reject" | "needs_info";

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
  }) => call("claim.submit", stripEmpty(fields)),

  awardCreate: (fields: {
    personId: string;
    track: string;
    title: string;
    kind: Award["kind"];
    amountMinor: string;
    currency: string;
    teamId?: string;
  }) => call("award.create", stripEmpty(fields)),
  awardChoose: (id: string, fulfillment: Award["fulfillment"]) =>
    call("award.choose", { id, fulfillment }),
  awardSplit: (id: string, shares: { personId: string; bps: number }[]) =>
    call("award.split", { id, shares }),
  awardConfirm: (id: string) => call("award.confirm", { id }),

  payoutPropose: (sourceId: string, sourceType: "claim" | "award") =>
    call("payout.propose", { sourceId, sourceType }),
  payoutRelease: (ids: string[]) =>
    ids.length === 1 ? call("payout.release", { id: ids[0] }) : call("payout.release", { ids }),
  payoutVerify: (id: string, confirmation: string, channel = "original email") =>
    call("payout.verify", { id, confirmation, channel }),
  payoutRetry: (id: string) => call("payout.retry", { id }),
  payoutBankChange: (personId: string, last4: string, currency: string) =>
    call("payout.bankChange", { personId, last4, currency }),

  taxSubmit: (fields: {
    personId: string;
    form: Person["taxForm"];
    signature: string;
    tin?: string;
    legalName?: string;
    citizenship?: string;
    country?: string;
    address?: string;
    dateOfBirth?: string;
    treatyCountry?: string;
  }) => call("tax.submit", stripEmpty(fields)),
  personUpdate: (id: string, fields: Partial<Pick<Person, "name" | "country" | "citizenship" | "dateOfBirth" | "address" | "payoutCurrency">>) =>
    call("person.update", { id, ...stripEmpty(fields) }),
  peopleImport: (csv: string, documentId?: string) =>
    call("people.import", stripEmpty({ csv, documentId })),

  sponsorCreate: (payoutId: string) => call("sponsor.create", { payoutId }),
  sponsorSubmit: (id: string) => call("sponsor.submit", { id }),
  sponsorReconcile: (id: string, resolution: "accept_fee" | "query" | "match", note: string) =>
    call("sponsor.reconcile", { id, resolution, note }),

  orgUpdate: (fields: Record<string, unknown>) => call("org.update", stripEmpty(fields)),
  eventUpdate: (fields: Record<string, unknown>) => call("event.update", stripEmpty(fields)),
  budgetUpdate: (id: string, capMinor: string) => call("budget.update", { id, capMinor }),
  periodLock: (reason: string) => call("period.lock", { reason }),
  filingsGenerate: (year: number) => call("filings.generate", { year }),

  agentRun: (scope = "all") => call("agent.run", { scope }),
  demoRun: () => call("demo.run", {}),
  demoReset: () => call("demo.reset", {}),

  flightSearch: (fields: { personId?: string; origin: string; departDate: string; returnDate: string }) =>
    call("flight.search", stripEmpty(fields)),
  flightRequest: (fields: { personId?: string; offerId: string; amountMinor: string; currency: string; summary: string }) =>
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
