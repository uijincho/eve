// Fare anomaly check: is a travel claim unusually expensive for its route?
// Deterministic and flag-only: a failing check sends the claim to a person,
// it never rejects. Phase 1 compares against other attendees' claims on the
// same route for the same event (no market data needed).
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
}

export const DEFAULT_FARE_POLICY: FarePolicy = {
  minPeers: 5,
  peerPercentile: 75,
  peerMarginBps: 2_000,
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
export function fareQuestion(input: { usdMinor: bigint; capMinor: bigint; route: string; evidence?: FareEvidence }): string {
  const paid = formatMoney(input.usdMinor);
  const reasons = "A late acceptance, a nonstop or a checked bag are all fine reasons.";
  const delta = input.evidence?.flagged ? BigInt(input.evidence.deltaMinor) : 0n;
  if (delta > 0n) {
    const about = formatMoney(((delta + 50n) / 100n) * 100n).replace(/\.00$/, "");
    return `Your ${input.route} fare (${paid}) is about ${about} above what most attendees on that route paid (up to ${formatMoney(BigInt(input.evidence!.percentileMinor))}). Anything we should know? ${reasons}`;
  }
  return `Your ${input.route} fare (${paid}) is close to the ${formatMoney(input.capMinor)} travel cap. Anything we should know? ${reasons}`;
}
