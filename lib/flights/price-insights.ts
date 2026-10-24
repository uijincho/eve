// Market fare data for the fare anomaly check.
//
// Google Flights price insights (typical price range, price level, about 60
// days of price history) come from SerpApi when SERPAPI_API_KEY is set; the
// free tier is about 250 searches a month, so callers take one snapshot per
// event, route and day. Without a key, a deterministic fixture is built from
// the simulated fare table and labelled "Simulated". The nightly tracker's
// cheapest fare comes from Duffel test mode or the same fixture table.
// Prices are stored in USD minor units. History only exists for upcoming
// travel dates, which is why snapshots are taken before the event.
import type { EventRecord, Truth } from "@/lib/contracts";
import { convertMinor, parseMinor } from "@/lib/engines/money";
import { CACHED_FX, crossRate } from "@/lib/payouts/fx";

import { searchDuffelOffers } from "./duffel";
import { destinationFor, fixtureOffers, type FlightOffer } from "./index";

export type FareEvent = Pick<EventRecord, "checkInAt" | "closingAt" | "venue">;

export interface PriceInsights {
  origin: string;
  destination: string;
  /** Day the snapshot was taken, YYYY-MM-DD (UTC). */
  capturedOn: string;
  source: "serpapi" | "fixture";
  truth: Truth;
  typicalLowMinor: string;
  typicalHighMinor: string;
  lowestMinor?: string;
  priceLevel?: string;
  /** Lowest round-trip price by day, oldest first. */
  history: { date: string; minor: string }[];
}

export interface CheapestFare {
  origin: string;
  destination: string;
  capturedOn: string;
  source: "duffel_test" | "fixture";
  truth: Truth;
  lowestMinor: string;
}

const DAY = 86_400_000;

/** Round-trip dates searched for an event: arrive on check-in day, leave on closing day. */
export function searchDates(event: FareEvent): { outbound: string; inbound: string } {
  return { outbound: new Date(event.checkInAt).toISOString().slice(0, 10), inbound: new Date(event.closingAt).toISOString().slice(0, 10) };
}

function usdMinor(o: Pick<FlightOffer, "totalMinor" | "currency">): bigint {
  const total = parseMinor(o.totalMinor, "totalMinor");
  return o.currency === "USD" ? total : convertMinor(total, o.currency, "USD", crossRate(o.currency, "USD", CACHED_FX));
}

function economyUsd(offers: readonly FlightOffer[]): bigint[] {
  return offers.filter((o) => o.cabin === "economy").map(usdMinor).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Simulated insights from the fixture fare table: the typical range spans the
 * route's economy fares, and history wobbles a few percent around the lowest.
 */
export function fixtureInsights(origin: string, event: FareEvent, capturedOn: string): PriceInsights | null {
  const fares = economyUsd(fixtureOffers(origin, event));
  if (!fares.length) return null;
  const lowest = fares[0];
  const end = Date.parse(`${capturedOn}T00:00:00Z`);
  const history = Array.from({ length: 60 }, (_, i) => {
    const wobble = BigInt(Math.round(Math.sin((i + origin.charCodeAt(0)) / 5) * 400)); // ±4% in basis points
    return { date: new Date(end - (59 - i) * DAY).toISOString().slice(0, 10), minor: ((lowest * (10_000n + wobble)) / 10_000n).toString() };
  });
  return {
    origin: origin.toUpperCase(), destination: destinationFor(event.venue).airport, capturedOn, source: "fixture", truth: "Simulated",
    typicalLowMinor: lowest.toString(), typicalHighMinor: fares[fares.length - 1].toString(), lowestMinor: lowest.toString(), priceLevel: "typical", history,
  };
}

interface SerpApiResponse {
  error?: string;
  price_insights?: {
    lowest_price?: number;
    price_level?: string;
    typical_price_range?: [number, number];
    price_history?: [number, number][];
  };
}

const dollars = (n: number) => BigInt(Math.round(n * 100)).toString();

/** Reads SerpApi's Google Flights price_insights (USD whole dollars) into minor units. Null when Google gave no typical range. */
export function parseSerpApiInsights(body: SerpApiResponse, route: { origin: string; destination: string; capturedOn: string }): PriceInsights | null {
  const pi = body.price_insights;
  const range = pi?.typical_price_range;
  if (!pi || !range || range.length !== 2 || !range.every((n) => Number.isFinite(n) && n > 0)) return null;
  const byDay = new Map<string, string>();
  for (const [ts, price] of pi.price_history ?? []) {
    if (Number.isFinite(ts) && Number.isFinite(price) && price > 0) byDay.set(new Date(ts * 1000).toISOString().slice(0, 10), dollars(price));
  }
  return {
    origin: route.origin, destination: route.destination, capturedOn: route.capturedOn, source: "serpapi", truth: "Estimate",
    typicalLowMinor: dollars(Math.min(...range)), typicalHighMinor: dollars(Math.max(...range)),
    ...(Number.isFinite(pi.lowest_price) ? { lowestMinor: dollars(pi.lowest_price!) } : {}),
    ...(pi.price_level ? { priceLevel: pi.price_level } : {}),
    history: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, minor]) => ({ date, minor })),
  };
}

export async function fetchSerpApiInsights(origin: string, event: FareEvent, capturedOn: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<PriceInsights | null> {
  const destination = destinationFor(event.venue).airport;
  const { outbound, inbound } = searchDates(event);
  const params = new URLSearchParams({
    engine: "google_flights", departure_id: origin.toUpperCase(), arrival_id: destination, outbound_date: outbound, return_date: inbound,
    type: "1", travel_class: "1", currency: "USD", hl: "en", api_key: apiKey,
  });
  const res = await fetchImpl(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as SerpApiResponse;
  if (!res.ok || body.error) throw new Error(`SerpApi price insights failed: ${body.error ?? `HTTP ${res.status}`}`);
  return parseSerpApiInsights(body, { origin: origin.toUpperCase(), destination, capturedOn });
}

/** SerpApi when a key is configured, otherwise the simulated fixture. */
export async function getPriceInsights(origin: string, event: FareEvent, capturedOn: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<PriceInsights | null> {
  if (destinationFor(event.venue).airport === origin.toUpperCase()) return null;
  const key = env.SERPAPI_API_KEY?.trim();
  return key ? fetchSerpApiInsights(origin, event, capturedOn, key, fetchImpl) : fixtureInsights(origin, event, capturedOn);
}

/** Cheapest economy round trip today: Duffel test mode when a test token is set, otherwise the fixture table. */
export async function getCheapestFare(origin: string, event: FareEvent, capturedOn: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<CheapestFare | null> {
  const destination = destinationFor(event.venue).airport;
  if (destination === origin.toUpperCase()) return null;
  const token = env.DUFFEL_ACCESS_TOKEN?.trim();
  const { outbound, inbound } = searchDates(event);
  const offers = token
    ? await searchDuffelOffers({ origin: origin.toUpperCase(), destination, departureDate: outbound, returnDate: inbound, maxOffers: 20 }, { token, fetchImpl })
    : fixtureOffers(origin, event);
  const fares = economyUsd(offers);
  if (!fares.length) return null;
  return { origin: origin.toUpperCase(), destination, capturedOn, source: token ? "duffel_test" : "fixture", truth: token ? "Test mode" : "Simulated", lowestMinor: fares[0].toString() };
}
