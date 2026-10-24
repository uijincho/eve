// Claim policy checks. Deterministic: the same claim, person, event and
// history always produce the same checks and status. The agent explains the
// result; it does not decide it.
import type { Check, Claim, EventRecord, Organization, Person } from "@/lib/contracts";

import { EngineError, convertMinor, currencyExponent, parseMinor, parseRate } from "./money";

export interface ClaimPolicy {
  /** Days before event start a travel date may fall. */
  arriveDaysBefore: number;
  /** Days after event end a travel date may fall. */
  departDaysAfter: number;
  /** Fraction of the cap (in basis points) above which a claim is "cap-hugging". */
  capHuggingBps: number;
  /** Tolerance in USD minor units between the stated usdMinor and our recomputation. */
  fxToleranceMinor: bigint;
}

export const DEFAULT_CLAIM_POLICY: ClaimPolicy = {
  arriveDaysBefore: 3,
  departDaysAfter: 2,
  capHuggingBps: 9_500,
  fxToleranceMinor: 1n,
};

export interface CheckClaimInput {
  claim: Claim;
  person: Person;
  event: EventRecord;
  org: Organization;
  existingClaims: Claim[];
  /** Name printed on the ticket or receipt, if extraction found one. Defaults to claim.personName. */
  ticketName?: string;
  policy?: Partial<ClaimPolicy>;
  /** Evaluation time, ISO. Defaults to now. */
  asOf?: string;
}

export interface CheckClaimResult {
  checks: Check[];
  status: Claim["status"];
  reason: string;
  /** USD amount the engine recomputed from amount × fxRate (USD per one unit of claim.currency), used for cap and limit checks. */
  usdMinor: string;
}

const DAY = 86_400_000;

/** Whole years between a date of birth and a moment, by calendar date (no time zones). */
export function ageOn(dateOfBirth: string, on: string): number {
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth);
  const at = /^(\d{4})-(\d{2})-(\d{2})/.exec(on);
  if (!dob || !at) throw new EngineError("invalid_input", "dates must be ISO YYYY-MM-DD");
  let age = Number(at[1]) - Number(dob[1]);
  if (`${at[2]}${at[3]}` < `${dob[2]}${dob[3]}`) age -= 1;
  return age;
}

/** Adult at the event start date, computed from DOB rather than trusting a stored flag. */
export function isAdultAtEvent(person: Pick<Person, "dateOfBirth">, event: Pick<EventRecord, "startsAt">): boolean {
  return ageOn(person.dateOfBirth, event.startsAt) >= 18;
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeName(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Names match when first and last tokens agree after normalization, so a
 * missing middle name or accent passes but a different surname does not.
 * Airline "LAST/FIRST" order is accepted.
 */
export function namesMatch(profileName: string, ticketName: string): boolean {
  const ticket = ticketName.includes("/")
    ? ticketName.split("/").reverse().join(" ")
    : ticketName;
  const a = normalizeName(profileName);
  const b = normalizeName(ticket);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

function sameDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** A prior claim is a duplicate if it has the same receipt hash, or the same person, amount, currency, merchant and purchase day. */
export function findDuplicate(claim: Claim, existing: readonly Claim[]): Claim | undefined {
  return existing.find((other) => {
    if (other.id === claim.id || other.status === "rejected") return false;
    if (claim.receiptHash && other.receiptHash && claim.receiptHash === other.receiptHash) return true;
    return (
      other.personId === claim.personId &&
      other.amountMinor === claim.amountMinor &&
      other.currency === claim.currency &&
      other.merchant.trim().toLowerCase() === claim.merchant.trim().toLowerCase() &&
      sameDay(other.purchasedAt, claim.purchasedAt)
    );
  });
}

const ECONOMY = new Set(["economy", "basic economy", "main cabin", "coach", "y"]);

export function isEconomyCabin(cabin: string): boolean {
  return ECONOMY.has(cabin.trim().toLowerCase());
}

export function checkClaim(input: CheckClaimInput): CheckClaimResult {
  const { claim, person, event, org } = input;
  const policy = { ...DEFAULT_CLAIM_POLICY, ...input.policy };
  const asOf = input.asOf ?? new Date().toISOString();
  const checks: Check[] = [];
  const add = (code: string, label: string, passed: boolean, detail: string) =>
    checks.push({ code, label, passed, detail });

  // Amount and FX. Malformed money fails the check rather than throwing, so a
  // bad extraction lands in front of a person instead of crashing the run.
  let amount: bigint | undefined;
  let usd: bigint | undefined;
  try {
    const parsed = parseMinor(claim.amountMinor, "amountMinor");
    currencyExponent(claim.currency);
    amount = parsed;
  } catch (e) {
    add("amount_valid", "Amount readable", false, (e as Error).message);
  }
  if (amount !== undefined) {
    if (amount <= 0n) {
      add("amount_valid", "Amount readable", false, "Claimed amount must be greater than zero.");
    } else {
      add("amount_valid", "Amount readable", true, `${claim.amountMinor} ${claim.currency} minor units.`);
      if (claim.currency === "USD") {
        usd = amount;
      } else {
        try {
          parseRate(claim.fxRate, "fxRate");
          usd = convertMinor(amount, claim.currency, "USD", claim.fxRate);
          const stated = parseMinor(claim.usdMinor, "usdMinor");
          const diff = stated > usd ? stated - usd : usd - stated;
          const sourced = Boolean(claim.fxSource?.trim());
          add(
            "fx_converted",
            "Converted at a sourced rate",
            sourced && diff <= policy.fxToleranceMinor,
            sourced
              ? `${claim.currency}→USD at ${claim.fxRate} (${claim.fxSource}) = ${usd} USD minor${diff > policy.fxToleranceMinor ? `; stated ${stated} differs` : ""}.`
              : "FX rate has no recorded source.",
          );
        } catch (e) {
          add("fx_converted", "Converted at a sourced rate", false, (e as Error).message);
        }
      }
    }
  }

  const hasReceipt = Boolean(claim.receiptName || claim.documentId);
  add("receipt", "Receipt attached", hasReceipt, hasReceipt ? `Receipt ${claim.receiptName ?? claim.documentId}.` : "No receipt or e-ticket attached.");

  const dup = findDuplicate(claim, input.existingClaims);
  add("duplicate", "Not a duplicate", !dup, dup ? `Matches claim ${dup.id} (${dup.status}).` : "No earlier claim matches this receipt.");

  const ticketName = input.ticketName ?? claim.personName;
  const nameOk = namesMatch(person.name, ticketName);
  add("name_match", "Name matches profile", nameOk, nameOk ? `"${ticketName}" matches ${person.name}.` : `Ticket says "${ticketName}", profile says "${person.name}".`);

  let adult = false;
  try {
    adult = isAdultAtEvent(person, event);
    add("adult", "18 or older at event start", adult, `Age ${ageOn(person.dateOfBirth, event.startsAt)} on ${event.startsAt.slice(0, 10)}.`);
  } catch {
    add("adult", "18 or older at event start", false, "Date of birth missing or unreadable.");
  }

  const purchased = Date.parse(claim.purchasedAt);
  if (Number.isNaN(purchased)) {
    add("purchase_date", "Purchase date valid", false, "Purchase date unreadable.");
  } else if (purchased > Date.parse(asOf) + DAY) {
    add("purchase_date", "Purchase date valid", false, `Purchased ${claim.purchasedAt.slice(0, 10)}, which is in the future.`);
  }

  if (claim.type === "travel") {
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt);
    const travel = claim.travelDate ? Date.parse(claim.travelDate) : NaN;
    const earliest = start - policy.arriveDaysBefore * DAY;
    const latest = end + policy.departDaysAfter * DAY;
    const datesOk = !Number.isNaN(travel) && travel >= earliest && travel <= latest;
    add(
      "travel_dates",
      "Travel fits the event",
      datesOk,
      Number.isNaN(travel)
        ? "No travel date on the ticket."
        : `Travel ${claim.travelDate!.slice(0, 10)}; allowed ${new Date(earliest).toISOString().slice(0, 10)} to ${new Date(latest).toISOString().slice(0, 10)}.`,
    );

    if (event.economyOnly) {
      const cabinOk = Boolean(claim.cabin) && isEconomyCabin(claim.cabin!);
      add("cabin", "Economy cabin", cabinOk, claim.cabin ? `Cabin: ${claim.cabin}.` : "Cabin not stated on the ticket.");
    }

    if (!Number.isNaN(purchased) && event.bookingDeadline && purchased > Date.parse(event.bookingDeadline) + DAY - 1) {
      add("booking_deadline", "Booked before the deadline", false, `Booked ${claim.purchasedAt.slice(0, 10)} after the ${event.bookingDeadline.slice(0, 10)} deadline.`);
    }

    if (usd !== undefined) {
      const cap = parseMinor(event.travelCapMinor, "travelCapMinor");
      const underCap = usd <= cap;
      add("cap", "Under the travel cap", underCap, `${usd} USD minor against a ${cap} cap${claim.currency !== "USD" ? " after conversion" : ""}.`);
      if (underCap && usd * 10_000n >= cap * BigInt(policy.capHuggingBps)) {
        add("cap_hugging", "Not hugging the cap", false, `Within ${(10_000 - policy.capHuggingBps) / 100}% of the cap; check against typical fares.`);
      }
    }
  }

  if (usd !== undefined) {
    const limit = parseMinor(org.agentLimitMinor, "agentLimitMinor");
    add("agent_limit", "Within the agent's auto-approve limit", usd <= limit, `${usd} against a ${limit} limit.`);
  }

  const failed = checks.filter((c) => !c.passed);
  let status: Claim["status"];
  if (failed.length === 0) status = "approved";
  else if (failed.every((c) => c.code === "receipt")) status = "needs_info";
  else status = "escalated";

  const reason = failed.length === 0
    ? "Every policy check passed and the amount is within the agent's limit."
    : failed.map((c) => `${c.label}: ${c.detail}`).join(" ");

  return { checks, status, reason, usdMinor: usd === undefined ? "0" : usd.toString() };
}
