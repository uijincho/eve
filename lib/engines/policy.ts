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

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Parse a real calendar date "YYYY-MM-DD" (rejects 2026-02-30, 2026-13-01). */
export function parseCalendarDate(value: unknown): { year: number; month: number; day: number } | undefined {
  if (typeof value !== "string") return undefined;
  const m = DATE_ONLY.exec(value) ?? DATE_TIME.exec(value);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  if (m.length > 4 && m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return undefined;
  return { year, month, day };
}

/**
 * Epoch ms for a date-only (taken as 00:00 UTC) or a date-time WITH an
 * offset. Offset-less date-times are rejected: Date.parse would read them in
 * the server's local zone, so results would depend on where the code runs.
 */
export function parseInstant(value: unknown): number | undefined {
  if (!parseCalendarDate(value)) return undefined;
  const ms = Date.parse(value as string);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Whole years between a date of birth and a moment, by the calendar date
 * written in `on` (its local date, no zone shifting). Throws on invalid or
 * future dates of birth.
 */
export function ageOn(dateOfBirth: string, on: string): number {
  const dob = parseCalendarDate(dateOfBirth);
  const at = parseCalendarDate(on);
  if (!dob || !at) throw new EngineError("invalid_input", "dates must be real ISO dates (YYYY-MM-DD)");
  let age = at.year - dob.year;
  if (at.month * 100 + at.day < dob.month * 100 + dob.day) age -= 1;
  if (age < 0) throw new EngineError("invalid_input", "date of birth is after the event date");
  if (age > 130) throw new EngineError("invalid_input", "date of birth is implausibly early");
  return age;
}

/** Adult at the event start date, computed from DOB rather than trusting a stored flag. */
export function isAdultAtEvent(person: Pick<Person, "dateOfBirth">, event: Pick<EventRecord, "startsAt">): boolean {
  return ageOn(person.dateOfBirth, event.startsAt) >= 18;
}

/** Latin letters that do not decompose under NFKD, mapped as airlines transliterate them (ICAO 9303 style). */
const LATIN_FOLD: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", ł: "l", þ: "th", ı: "i", ħ: "h", ŋ: "n",
};
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mstr", "dr", "prof", "mx"]);

/**
 * Lowercase, strip accents, punctuation and honorifics, collapse whitespace.
 * Letters from every script are kept (\p{L}), so a Cyrillic or CJK name is
 * not silently erased.
 */
export function normalizeName(name: string): string[] {
  const tokens = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđðłþıħŋ]/g, (c) => LATIN_FOLD[c])
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && TITLES.has(tokens[tokens.length - 1])) tokens.pop();
  while (tokens.length > 1 && TITLES.has(tokens[0])) tokens.shift();
  return tokens;
}

function isLatin(tokens: string[]): boolean {
  return tokens.every((t) => /^[a-z0-9]+$/.test(t));
}

export type NameComparison = "match" | "mismatch" | "uncomparable";

/**
 * Names match when first and last tokens agree after normalization, so a
 * missing middle name, accent or title passes but a different surname does
 * not. Airline "LAST/FIRST" order is accepted. Names in different scripts
 * (e.g. 李小龙 vs LI XIAOLONG) are "uncomparable": we do not transliterate,
 * so a person must compare them.
 */
export function compareNames(profileName: string, ticketName: string): NameComparison {
  const ticket = ticketName.includes("/") ? ticketName.split("/").reverse().join(" ") : ticketName;
  const a = normalizeName(profileName);
  const b = normalizeName(ticket);
  if (!a.length || !b.length) return "uncomparable";
  if (a.join(" ") === b.join(" ") || a.join("") === b.join("")) return "match";
  if (isLatin(a) !== isLatin(b)) return "uncomparable";
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1] ? "match" : "mismatch";
}

export function namesMatch(profileName: string, ticketName: string): boolean {
  return compareNames(profileName, ticketName) === "match";
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
  const names = compareNames(person.name, ticketName);
  add(
    "name_match", "Name matches profile", names === "match",
    names === "match"
      ? `"${ticketName}" matches ${person.name}.`
      : names === "uncomparable"
        ? `Ticket says "${ticketName}", profile says "${person.name}"; different scripts or no name, so a person must compare them.`
        : `Ticket says "${ticketName}", profile says "${person.name}".`,
  );

  let adult = false;
  try {
    adult = isAdultAtEvent(person, event);
    add("adult", "18 or older at event start", adult, `Age ${ageOn(person.dateOfBirth, event.startsAt)} on ${event.startsAt.slice(0, 10)}.`);
  } catch {
    add("adult", "18 or older at event start", false, "Date of birth missing or unreadable.");
  }

  const now = parseInstant(asOf) ?? Date.now();
  const purchased = parseInstant(claim.purchasedAt);
  if (purchased === undefined) {
    add("purchase_date", "Purchase date valid", false, `Purchase date ${JSON.stringify(claim.purchasedAt)} is not a real ISO date with a time zone.`);
  } else if (purchased > now + DAY) {
    add("purchase_date", "Purchase date valid", false, `Purchased ${claim.purchasedAt.slice(0, 10)}, which is in the future.`);
  }

  if (claim.type === "travel") {
    const start = parseInstant(event.startsAt);
    const end = parseInstant(event.endsAt);
    const travel = parseInstant(claim.travelDate);
    if (start === undefined || end === undefined || end < start) {
      add("travel_dates", "Travel fits the event", false, "Event start and end dates are missing or invalid; fix the event before checking travel.");
    } else {
      const earliest = start - policy.arriveDaysBefore * DAY;
      const latest = end + policy.departDaysAfter * DAY;
      const datesOk = travel !== undefined && travel >= earliest && travel <= latest;
      add(
        "travel_dates",
        "Travel fits the event",
        datesOk,
        travel === undefined
          ? claim.travelDate ? `Travel date ${JSON.stringify(claim.travelDate)} is not a real ISO date with a time zone.` : "No travel date on the ticket."
          : `Travel ${claim.travelDate!.slice(0, 10)}; allowed ${new Date(earliest).toISOString().slice(0, 10)} to ${new Date(latest).toISOString().slice(0, 10)}.`,
      );
    }

    if (event.economyOnly) {
      const cabinOk = Boolean(claim.cabin) && isEconomyCabin(claim.cabin!);
      add("cabin", "Economy cabin", cabinOk, claim.cabin ? `Cabin: ${claim.cabin}.` : "Cabin not stated on the ticket.");
    }

    if (event.bookingDeadline) {
      const deadline = parseInstant(event.bookingDeadline);
      if (deadline === undefined) {
        add("booking_deadline", "Booked before the deadline", false, "The event booking deadline is not a valid date.");
      } else if (purchased !== undefined && purchased > deadline + DAY - 1) {
        add("booking_deadline", "Booked before the deadline", false, `Booked ${claim.purchasedAt.slice(0, 10)} after the ${event.bookingDeadline.slice(0, 10)} deadline.`);
      }
    }

    let cap: bigint | undefined;
    try {
      cap = parseMinor(event.travelCapMinor, "travelCapMinor");
    } catch {
      add("cap", "Under the travel cap", false, "The event travel cap is not a valid amount.");
    }
    if (usd !== undefined && cap !== undefined) {
      const underCap = usd <= cap;
      add("cap", "Under the travel cap", underCap, `${usd} USD minor against a ${cap} cap${claim.currency !== "USD" ? " after conversion" : ""}.`);
      if (underCap && usd * 10_000n >= cap * BigInt(policy.capHuggingBps)) {
        add("cap_hugging", "Not hugging the cap", false, `Within ${(10_000 - policy.capHuggingBps) / 100}% of the cap; check against typical fares.`);
      }
    }
  }

  if (usd !== undefined) {
    let limit: bigint | undefined;
    try {
      limit = parseMinor(org.agentLimitMinor, "agentLimitMinor");
    } catch {
      add("agent_limit", "Within the agent's auto-approve limit", false, "The org's auto-approve limit is not a valid amount.");
    }
    if (limit !== undefined) add("agent_limit", "Within the agent's auto-approve limit", usd <= limit, `${usd} against a ${limit} limit.`);
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
