// Fare anomaly check: is a travel claim unusually expensive for its route?
// Deterministic and flag-only: a failing check sends the claim to a person,
// it never rejects. Two comparisons: other attendees' fares on the same
// route for the same event (needs no market data), and the market price on
// the booking date from stored snapshots (Google Flights insights or the
// nightly cheapest-fare tracker).
import type { Check, Claim } from "@/lib/contracts";
import { formatMoney } from "@/lib/design/money";

import { parseMinor } from "./money";

export interface FarePolicy {
  /** Fewer comparable peer fares than this and the peer check is skipped, not failed. */
  minPeers: number;
  /** Percentile of peer fares (1-100) the claim is compared with. */
  peerPercentile: number;
  /** How far above that percentile, in basis points, a fare must be to flag. */
  peerMarginBps: number;
  /** How far above the market's typical high, in basis points, a fare must be to flag. */
  marketMarginBps: number;
  /** Without a typical range, how far above the tracked cheapest fare a fare must be to flag. */
  cheapestMarginBps: number;
}

export const DEFAULT_FARE_POLICY: FarePolicy = {
  minPeers: 5,
  peerPercentile: 75,
  peerMarginBps: 2_000,
  marketMarginBps: 2_500,
  cheapestMarginBps: 6_000,
};

export interface FareEvidence {
  origin: string;
  /** Number of other attendees' fares compared. */
  peerCount: number;
  medianMinor: string;
  percentileMinor: string;
  /** Claim fare minus the percentile (USD minor); negative when below it. */
  deltaMinor: string;
  flagged: boolean;
}

/** Checks that say a fare looks high. When they are the only problems, the attendee is asked before a person decides. */
export const FARE_FLAG_CODES: ReadonlySet<string> = new Set(["fare_peer", "fare_market", "cap_hugging"]);

const norm = (code: string | undefined) => code?.trim().toUpperCase() ?? "";

/** Nearest-rank percentile of an ascending list. */
export function percentileMinor(sorted: readonly bigint[], p: number): bigint {
  if (!sorted.length) throw new RangeError("percentile of an empty list");
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/**
 * Fares comparable with `claim`: other people's travel claims from the same
 * origin in an economy cabin that were not rejected. Callers pass claims from
 * the same event, so the destination is shared.
 */
export function farePeers(claim: Claim, candidates: readonly Claim[], isEconomy: (cabin: string) => boolean): bigint[] {
  const origin = norm(claim.origin);
  const fares: bigint[] = [];
  for (const c of candidates) {
    if (c.id === claim.id || c.personId === claim.personId || c.type !== "travel" || c.status === "rejected") continue;
    if (norm(c.origin) !== origin || !c.cabin || !isEconomy(c.cabin)) continue;
    try {
      const usd = parseMinor(c.usdMinor, "usdMinor");
      if (usd > 0n) fares.push(usd);
    } catch {
      // An unreadable peer amount is left out rather than failing this claim.
    }
  }
  return fares.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Peer comparison for one fare in USD. Returns no check when the route has
 * too few peers to say what is typical.
 */
export function checkFarePeers(input: { usdMinor: bigint; origin: string; peers: readonly bigint[]; policy?: Partial<FarePolicy> }): { check?: Check; evidence?: FareEvidence } {
  const policy = { ...DEFAULT_FARE_POLICY, ...input.policy };
  const { peers, usdMinor } = input;
  if (peers.length < policy.minPeers) return {};
  const median = percentileMinor(peers, 50);
  const pct = percentileMinor(peers, policy.peerPercentile);
  const flagged = usdMinor * 10_000n > pct * BigInt(10_000 + policy.peerMarginBps);
  const aboveBps = pct > 0n ? ((usdMinor - pct) * 10_000n) / pct : 0n;
  const summary = `the ${input.origin} peer ${policy.peerPercentile}th percentile (${formatMoney(pct)}; median ${formatMoney(median)}, ${peers.length} other attendees)`;
  const detail = flagged
    ? `${formatMoney(usdMinor)} is ${aboveBps / 100n}% above ${summary}. Flag for review; there may be a good reason.`
    : `${formatMoney(usdMinor)} against ${summary}.`;
  return {
    check: { code: "fare_peer", label: "Fare in line with peers", passed: !flagged, detail },
    evidence: { origin: input.origin, peerCount: peers.length, medianMinor: median.toString(), percentileMinor: pct.toString(), deltaMinor: (usdMinor - pct).toString(), flagged },
  };
}

/** Convenience: select peers for `claim` and run the peer check. */
export function checkFare(input: { claim: Claim; usdMinor: bigint; candidates: readonly Claim[]; isEconomy: (cabin: string) => boolean; policy?: Partial<FarePolicy> }) {
  const origin = norm(input.claim.origin);
  if (!origin) return {};
  return checkFarePeers({ usdMinor: input.usdMinor, origin, peers: farePeers(input.claim, input.candidates, input.isEconomy), policy: input.policy });
}

/** The one question the agent asks an attendee about a flagged fare. */
export function fareQuestion(input: { usdMinor: bigint; capMinor: bigint; route: string; evidence?: FareEvidence; market?: MarketEvidence }): string {
  const paid = formatMoney(input.usdMinor);
  const reasons = "A late acceptance, a nonstop or a checked bag are all fine reasons.";
  const about = (delta: bigint) => formatMoney(((delta + 50n) / 100n) * 100n).replace(/\.00$/, "");
  if (input.evidence?.flagged && BigInt(input.evidence.deltaMinor) > 0n) {
    return `Your ${input.route} fare (${paid}) is about ${about(BigInt(input.evidence.deltaMinor))} above what most attendees on that route paid (up to ${formatMoney(BigInt(input.evidence.percentileMinor))}). Anything we should know? ${reasons}`;
  }
  if (input.market?.flagged && BigInt(input.market.deltaMinor) > 0n) {
    const ref = formatMoney(BigInt(input.market.referenceMinor));
    const basis = input.market.basis === "typical_high" ? `the typical price for that route around your booking date (up to ${ref})` : `the cheapest fare tracked for that route around your booking date (${ref})`;
    return `Your ${input.route} fare (${paid}) is about ${about(BigInt(input.market.deltaMinor))} above ${basis}. Anything we should know? ${reasons}`;
  }
  return `Your ${input.route} fare (${paid}) is close to the ${formatMoney(input.capMinor)} travel cap. Anything we should know? ${reasons}`;
}

/** A stored market snapshot for the claim's route (USD minor). */
export interface MarketSnapshot {
  kind: "insights" | "cheapest";
  capturedOn: string;
  source: string;
  truth: string;
  typicalHighMinor?: string;
  lowestMinor?: string;
  history?: { date: string; minor: string }[];
}

export interface MarketEvidence {
  basis: "typical_high" | "cheapest";
  capturedOn: string;
  source: string;
  truth: string;
  /** The market price compared with: Google's typical high, or the tracked cheapest fare. */
  referenceMinor: string;
  /** Lowest price on the booking date, when the snapshot's history has it. */
  priceOnDateMinor?: string;
  deltaMinor: string;
  flagged: boolean;
}

const SOURCE_NAME: Record<string, string> = { serpapi: "Google Flights via SerpApi", fixture: "fare table", duffel_test: "Duffel test mode" };

/** The snapshot closest to the booking date: the latest taken on or before it, else the earliest after it. */
function nearest<T extends { capturedOn: string }>(rows: readonly T[], day: string): T | undefined {
  const sorted = [...rows].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  return sorted.filter((r) => r.capturedOn <= day).pop() ?? sorted[0];
}

/**
 * Market comparison on the booking date. Uses Google's typical high when an
 * insights snapshot exists, otherwise the nightly tracker's cheapest fare
 * with a wider margin. No snapshot, no check.
 */
export function checkFareMarket(input: { usdMinor: bigint; purchasedAt: string; snapshots: readonly MarketSnapshot[]; policy?: Partial<FarePolicy> }): { check?: Check; evidence?: MarketEvidence } {
  const policy = { ...DEFAULT_FARE_POLICY, ...input.policy };
  const day = input.purchasedAt.slice(0, 10);
  const insights = nearest(input.snapshots.filter((r) => r.kind === "insights" && r.typicalHighMinor), day);
  const cheapest = insights ? undefined : nearest(input.snapshots.filter((r) => r.kind === "cheapest" && r.lowestMinor), day);
  const snap = insights ?? cheapest;
  if (!snap) return {};
  let reference: bigint;
  try {
    reference = parseMinor(insights ? snap.typicalHighMinor! : snap.lowestMinor!, "referenceMinor");
  } catch {
    return {};
  }
  if (reference <= 0n) return {};
  const margin = BigInt(10_000 + (insights ? policy.marketMarginBps : policy.cheapestMarginBps));
  const flagged = input.usdMinor * 10_000n > reference * margin;
  const onDate = snap.history?.find((h) => h.date === day)?.minor;
  const aboveBps = ((input.usdMinor - reference) * 10_000n) / reference;
  const what = insights ? `the typical high of ${formatMoney(reference)}` : `the cheapest tracked fare of ${formatMoney(reference)}`;
  // The fixture table is the demo default; only a test-mode source still says so.
  const where = `${SOURCE_NAME[snap.source] ?? snap.source}, ${snap.capturedOn}${snap.truth === "Test mode" ? "; Test mode" : ""}`;
  const dated = onDate ? `; lowest on the booking date ${formatMoney(BigInt(onDate))}` : "";
  const detail = flagged
    ? `${formatMoney(input.usdMinor)} is ${aboveBps / 100n}% above ${what} (${where}${dated}). Flag for review; there may be a good reason.`
    : `${formatMoney(input.usdMinor)} against ${what} (${where}${dated}).`;
  return {
    check: { code: "fare_market", label: "Fare in line with the market", passed: !flagged, detail },
    evidence: {
      basis: insights ? "typical_high" : "cheapest", capturedOn: snap.capturedOn, source: snap.source, truth: snap.truth,
      referenceMinor: reference.toString(), ...(onDate ? { priceOnDateMinor: onDate } : {}), deltaMinor: (input.usdMinor - reference).toString(), flagged,
    },
  };
}
