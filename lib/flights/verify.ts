// Server-side verification for "book this flight for me" requests.
//
// The client sends only an offer id (plus the opaque token the server gave
// it at search time). Price, carrier, times and cabin always come from the
// server's own data: the deterministic fixture table, an HMAC-signed offer
// token, or a server cache. Client-supplied copies of those fields are
// compared and reported, never used.
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import type { EventRecord, Truth } from "@/lib/contracts";
import type { FxSnapshot } from "@/lib/payouts/fx";

import { DEFAULT_FLIGHT_POLICY, destinationFor, fixtureOffers, suggestFlights, type FlightOffer, type FlightPolicy, type RankedOffer } from "./index";

/** Signed offers are honoured for this long after search unless the offer itself expires sooner. */
export const OFFER_TOKEN_TTL_MS = 30 * 60 * 1000;

export type OfferSource = "fixture" | "signed" | "cache";

export interface CachedOffer {
  offer: FlightOffer;
  /** ISO time the server fetched it. */
  fetchedAt: string;
}

/** Server-side store of offers returned by search (e.g. a DB table keyed by offer id). */
export interface OfferCache {
  get(offerId: string): CachedOffer | undefined | Promise<CachedOffer | undefined>;
}

/** Derive the offer-signing key from BETTER_AUTH_SECRET with a purpose-specific label. */
export function offerSigningKeyFromEnv(env: Record<string, string | undefined> = process.env): Buffer {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be set (32+ chars) to sign flight offers.");
  return Buffer.from(hkdfSync("sha256", secret, "eve", "eve-flight-offer-v1", 32));
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function mac(key: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", key).update(`eve-offer.v1.${payload}`).digest();
}

/** The event fields an offer was searched against. */
export type OfferEvent = Pick<EventRecord, "checkInAt" | "closingAt"> & Partial<Pick<EventRecord, "id" | "venue">>;

/**
 * Fingerprint of the event an offer was searched for: id, check-in, closing
 * and destination airport. A token from another event, or from before the
 * event's dates or venue changed, no longer matches.
 */
export function eventBinding(event: OfferEvent): string {
  const parts = [event.id ?? "", new Date(event.checkInAt).toISOString(), new Date(event.closingAt).toISOString(), destinationFor(event.venue).airport];
  return createHash("sha256").update(parts.join("|")).digest("base64url").slice(0, 22);
}

/** Opaque token binding an offer's server-side fields to the event it was searched for and the time it was issued. */
export function signOffer(offer: FlightOffer, key: Uint8Array, issuedAtMs: number, event: OfferEvent): string {
  const payload = b64url(JSON.stringify({ offer, iat: issuedAtMs, evt: eventBinding(event) }));
  return `v1.${payload}.${b64url(mac(key, payload))}`;
}

/** Attach a token to every offer for the search response. */
export function signOffers(offers: readonly FlightOffer[], key: Uint8Array, issuedAtMs: number, event: OfferEvent): (FlightOffer & { offerToken: string })[] {
  return offers.map((o) => ({ ...o, offerToken: signOffer(o, key, issuedAtMs, event) }));
}

type TokenResult = { ok: true; offer: FlightOffer; issuedAt: number; evt?: string } | { ok: false; code: "bad_token" | "bad_signature" };

export function readOfferToken(token: string, key: Uint8Array): TokenResult {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, code: "bad_token" };
  const expected = mac(key, parts[1]);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "bad_signature" };
  try {
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { offer?: FlightOffer; iat?: number; evt?: unknown };
    if (!body.offer || typeof body.iat !== "number") return { ok: false, code: "bad_token" };
    return { ok: true, offer: body.offer, issuedAt: body.iat, evt: typeof body.evt === "string" ? body.evt : undefined };
  } catch {
    return { ok: false, code: "bad_token" };
  }
}

export interface FlightRequestInput {
  offerId: string;
  origin: string;
  offerToken?: string;
  /** Whatever the client also sent. Only compared, never trusted. */
  claimed?: Partial<Pick<FlightOffer, "carrier" | "departAt" | "totalMinor" | "currency" | "cabin">> & { amountMinor?: string };
}

export type VerifyFlightResult =
  | {
    ok: true;
    offer: FlightOffer;
    source: OfferSource;
    truth: Truth;
    /** Policy view of this single offer; null when it fails policy. */
    ranked: RankedOffer | null;
    policyOk: boolean;
    policyReason: string;
    /** Client fields that disagreed with the server offer (ignored). */
    mismatches: string[];
  }
  | { ok: false; code: "unknown_offer" | "origin_mismatch" | "expired" | "bad_token" | "bad_signature" | "id_mismatch" | "event_mismatch"; reason: string };

export async function verifyFlightRequest(
  input: FlightRequestInput,
  ctx: {
    /** The requester's current event. Fixture offers are regenerated for it; signed offers must have been searched for it. */
    event: Pick<EventRecord, "checkInAt" | "closingAt" | "travelCapMinor" | "economyOnly"> & Partial<Pick<EventRecord, "id" | "venue">>;
    now: number;
    signingKey?: Uint8Array;
    cache?: OfferCache;
    policy?: FlightPolicy;
    fx?: FxSnapshot;
    tokenTtlMs?: number;
  },
): Promise<VerifyFlightResult> {
  const origin = input.origin.toUpperCase();
  let offer: FlightOffer | undefined;
  let source: OfferSource | undefined;
  let fetchedAt: number | undefined;

  // A token, when sent, is always checked (signature, offer id, event, expiry), fixture offers included.
  if (input.offerToken) {
    if (!ctx.signingKey) return { ok: false, code: "bad_token", reason: "Offer tokens cannot be verified: no signing key configured." };
    const t = readOfferToken(input.offerToken, ctx.signingKey);
    if (!t.ok) return { ok: false, code: t.code, reason: t.code === "bad_signature" ? "Offer token signature is invalid." : "Offer token is malformed." };
    if (t.offer.id !== input.offerId) return { ok: false, code: "id_mismatch", reason: "Offer token belongs to a different offer." };
    if (t.evt !== eventBinding(ctx.event)) return { ok: false, code: "event_mismatch", reason: "This fare was quoted for different event dates or another event; search again." };
    offer = t.offer;
    source = "signed";
    fetchedAt = t.issuedAt;
  } else if (/^fx_[A-Z]{3}_\d+$/.test(input.offerId)) {
    // Regenerated for the requester's current event: itinerary and price are what this server offers for it now.
    offer = fixtureOffers(input.offerId.slice(3, 6), ctx.event).find((o) => o.id === input.offerId);
    source = "fixture";
  } else if (ctx.cache) {
    const cached = await ctx.cache.get(input.offerId);
    if (cached) {
      offer = cached.offer;
      source = "cache";
      fetchedAt = Date.parse(cached.fetchedAt);
    }
  }

  if (!offer || !source) return { ok: false, code: "unknown_offer", reason: `Offer ${input.offerId} was not issued by this server.` };
  if (offer.origin.toUpperCase() !== origin) {
    return { ok: false, code: "origin_mismatch", reason: `Offer departs ${offer.origin}, request says ${origin}.` };
  }
  if (source !== "fixture") {
    const ttl = ctx.tokenTtlMs ?? OFFER_TOKEN_TTL_MS;
    const expiry = Math.min(fetchedAt! + ttl, offer.expiresAt ? Date.parse(offer.expiresAt) : Infinity);
    if (!Number.isFinite(fetchedAt!) || ctx.now > expiry) {
      return { ok: false, code: "expired", reason: "The fare quote has expired; search again for a current price." };
    }
  }

  const mismatches: string[] = [];
  const c = input.claimed ?? {};
  const claimedAmount = c.amountMinor ?? c.totalMinor;
  if (claimedAmount !== undefined && claimedAmount !== offer.totalMinor) mismatches.push(`amount ${claimedAmount} ≠ ${offer.totalMinor}`);
  if (c.currency !== undefined && c.currency.toUpperCase() !== offer.currency) mismatches.push(`currency ${c.currency} ≠ ${offer.currency}`);
  if (c.carrier !== undefined && c.carrier.trim().toLowerCase() !== offer.carrier.toLowerCase()) mismatches.push(`carrier ${c.carrier} ≠ ${offer.carrier}`);
  if (c.cabin !== undefined && c.cabin.trim().toLowerCase().replace(" ", "_") !== offer.cabin) mismatches.push(`cabin ${c.cabin} ≠ ${offer.cabin}`);
  if (c.departAt !== undefined && Date.parse(c.departAt) !== Date.parse(offer.departAt)) mismatches.push(`departAt ${c.departAt} ≠ ${offer.departAt}`);

  const policy = suggestFlights([offer], ctx.event, ctx.policy ?? DEFAULT_FLIGHT_POLICY, ctx.fx);
  const ranked = policy.options[0] ?? null;
  return {
    ok: true,
    offer,
    source,
    truth: offer.source === "fixture" ? "Simulated" : "Test mode",
    ranked,
    policyOk: ranked !== null,
    policyReason: ranked ? "Within cap, cabin and event timing policy." : policy.rejected[0]?.reason ?? "Outside policy.",
    mismatches,
  };
}
