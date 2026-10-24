// Zod payload schemas for POST /api/actions { action, payload }.
// Human-readable reference: lib/server/ACTIONS.md. All objects are strict:
// unknown keys (including any attempt to pass a role) are rejected.

import { z } from "zod";

import type { AppAction } from "@/lib/contracts";

const id = z.string().min(1).max(80);
const minor = z.union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .transform((v) => BigInt(v));
const positiveMinor = minor.refine((v) => v > 0n, "Amount must be positive");
const currency = z.string().regex(/^[A-Z]{3}$/);
const country = z.string().regex(/^[A-Z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");
const text = (max = 200) => z.string().trim().max(max);
const idempotencyKey = z.string().min(8).max(120).optional();

const personInput = z.strictObject({
  name: text(160).min(1), email: z.email().max(200), country, citizenship: country.optional(),
  dateOfBirth: isoDate, address: text(400).optional(), role: text(40).optional(), payoutCurrency: currency.optional(),
});

export const actionSchemas = {
  "org.update": z.strictObject({
    name: text(120).min(1).optional(), country: country.optional(), mode: z.enum(["direct", "sponsor", "hybrid"]).optional(),
    agentLimitMinor: minor.optional(), organizerLimitMinor: minor.optional(), currency: currency.optional(),
    sponsorName: text(160).optional(), sponsorTurnaroundDays: z.number().int().min(0).max(120).optional(),
    feesPaidBy: z.enum(["org", "recipient"]).optional(), notificationChannel: text(200).optional(), policyNotes: text(2000).optional(),
  }),
  "event.update": z.strictObject({
    name: text(160).min(1).optional(), startsAt: isoDateTime.optional(), endsAt: isoDateTime.optional(), venue: text(200).optional(),
    expectedHeadcount: z.number().int().min(0).max(100000).optional(), travelCapMinor: minor.optional(), economyOnly: z.boolean().optional(),
    bookingDeadline: isoDateTime.optional(), checkInAt: isoDateTime.optional(), closingAt: isoDateTime.optional(), locked: z.boolean().optional(),
  }),
  "budget.update": z.strictObject({
    id: id.optional(), name: text(120).min(1), category: text(60).min(1).optional(), capMinor: minor, fundingSource: text(120).min(1),
  }),
  "people.import": z.strictObject({ people: z.array(personInput).min(1).max(1000) }),
  "person.update": z.strictObject({
    id, name: text(160).min(1).optional(), country: country.optional(), citizenship: country.optional(), dateOfBirth: isoDate.optional(),
    address: text(400).optional(), role: text(40).optional(), payoutCurrency: currency.optional(),
  }),
  "tax.submit": z.strictObject({
    personId: id, form: z.enum(["W-9", "W-8BEN", "W-8BEN-E", "Residency declaration"]),
    /** Typed full legal name; must match the profile name. */
    signature: text(160).min(1),
    tin: z.string().regex(/^[0-9A-Za-z-]{4,20}$/).optional(),
    treatyCountry: country.optional(), treatyArticle: text(40).optional(),
    certify: z.literal(true),
  }),
  "claim.submit": z.strictObject({
    personId: id.optional(), type: z.enum(["travel", "expense"]),
    merchant: text(160).optional(), description: text(400).optional(), category: text(60).optional(),
    amountMinor: positiveMinor.optional(), currency: currency.optional(), purchasedAt: isoDateTime.optional(),
    travelDate: isoDateTime.optional(), cabin: text(40).optional(), origin: text(80).optional(), nameOnReceipt: text(160).optional(),
    documentId: id.optional(), idempotencyKey,
  }),
  "claim.review": z.strictObject({ id, decision: z.enum(["approve", "reject", "needs_info"]), reason: text(500).min(1) }),
  "award.create": z.strictObject({
    personId: id.optional(), teamPersonIds: z.array(id).min(2).max(12).optional(), track: text(120).min(1), title: text(160).min(1),
    kind: z.enum(["cash", "item"]), amountMinor: positiveMinor, currency: currency.optional(), dueAt: isoDateTime.optional(),
  }).refine((v) => Boolean(v.personId) !== Boolean(v.teamPersonIds), "Provide personId or teamPersonIds"),
  "award.choose": z.strictObject({ id, fulfillment: z.enum(["ship", "local", "cash"]) }),
  "award.split": z.strictObject({
    teamId: id, splits: z.array(z.strictObject({ personId: id, bps: z.number().int().min(1).max(10000) })).min(2).max(12),
  }).refine((v) => v.splits.reduce((s, x) => s + x.bps, 0) === 10000, "Splits must total 10000 bps (100%)"),
  "award.confirm": z.strictObject({ id }),
  /** Controller confirms an item prize was shipped or bought locally (simulated); records FMV as reportable income. */
  "award.fulfill": z.strictObject({ id }),
  "payout.propose": z.strictObject({ sourceId: id, sourceType: z.enum(["claim", "award"]) }),
  "payout.release": z.union([z.strictObject({ id }), z.strictObject({ ids: z.array(id).min(1).max(200) })]),
  "payout.bankChange": z.strictObject({
    personId: id, last4: z.string().regex(/^\d{4}$/), currency,
    /** Optional full account number; vaulted, never echoed. Must end in last4. */
    accountNumber: z.string().regex(/^[0-9]{6,34}$/).optional(),
    requestedVia: z.enum(["portal", "email", "phone"]).optional(),
  }),
  "payout.verify": z.strictObject({
    /** Person id or pending payout-method id. */
    id, confirmation: z.string().regex(/^\d{6}$/), decision: z.enum(["confirm", "reject"]).optional(),
  }),
  "payout.retry": z.strictObject({ id }),
  "sponsor.create": z.strictObject({ payoutId: id }),
  "sponsor.submit": z.strictObject({ id }),
  "sponsor.reconcile": z.strictObject({ id, paidMinor: minor.optional(), acceptShortfall: z.boolean().optional(), note: text(500).optional() }),
  "period.lock": z.strictObject({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  "filings.generate": z.strictObject({ year: z.number().int().min(2020).max(2100).optional() }),
  "demo.reset": z.strictObject({}),
  "demo.run": z.strictObject({}),
  "agent.run": z.strictObject({ kind: z.enum(["claims", "chase", "all"]).optional() }),
  "flight.search": z.strictObject({ origin: z.string().regex(/^[A-Z]{3}$/), date: isoDate.optional(), personId: id.optional() }),
  /** Price and itinerary come from the server's offer (fixture table or signed offerToken); the optional copies are only compared. */
  "flight.request": z.strictObject({
    personId: id.optional(), offerId: text(80).min(1), origin: z.string().regex(/^[A-Z]{3}$/), offerToken: z.string().min(10).max(4000).optional(),
    carrier: text(80).optional(), departAt: isoDateTime.optional(), amountMinor: positiveMinor.optional(), currency: currency.optional(), cabin: text(40).optional(),
  }),
} satisfies Record<AppAction, z.ZodType>;

export type ActionPayload<A extends AppAction> = z.output<(typeof actionSchemas)[A]>;
