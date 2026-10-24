// Flight suggestions: three options under the cap, timed to the event.
//
// Offers come from Duffel test mode (duffel.ts) when a test token is set, or
// from the fixture table below. Fixture fares are realistic round numbers
// for demo routes, timed to the event and aimed at its venue city, labelled
// "Simulated". Nothing here books a flight.
import type { EventRecord, Truth } from "@/lib/contracts";
import { EngineError, convertMinor, parseMinor, toMinor } from "@/lib/engines/money";
import { CACHED_FX, crossRate, type FxSnapshot } from "@/lib/payouts/fx";

export interface FlightOffer {
  id: string;
  carrier: string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** ISO with offset. */
  departAt: string;
  arriveAt: string;
  returnDepartAt: string;
  returnArriveAt: string;
  cabin: "economy" | "premium_economy" | "business" | "first";
  stops: number;
  totalMinor: string;
  currency: string;
  source: "duffel_test" | "fixture";
  /** When the provider stops honouring this price (Duffel offers expire). */
  expiresAt?: string;
}

export interface RankedOffer extends FlightOffer {
  usdMinor: string;
  /** Minutes between arrival and check-in (positive = early). */
  arrivalBufferMinutes: number;
  /** Minutes between closing and return departure (positive = after). */
  departureBufferMinutes: number;
  score: number;
}

export interface FlightPolicy {
  /** Arrive at least this long before check-in. */
  minArrivalBufferMinutes: number;
  /** Leave at least this long after closing. */
  minDepartureBufferMinutes: number;
  /** Do not arrive more than this many hours before check-in. */
  maxEarlyArrivalHours: number;
}

export const DEFAULT_FLIGHT_POLICY: FlightPolicy = {
  minArrivalBufferMinutes: 90,
  minDepartureBufferMinutes: 120,
  maxEarlyArrivalHours: 36,
};

export interface SuggestFlightsResult {
  options: RankedOffer[];
  rejected: { id: string; reason: string }[];
  truth: Truth;
  reason: string;
}

const MIN = 60_000;

/**
 * Filter offers by cabin, cap (after FX) and event window, then rank by
 * price with a small penalty for tight connections. Returns at most three.
 */
export function suggestFlights(
  offers: readonly FlightOffer[],
  event: Pick<EventRecord, "checkInAt" | "closingAt" | "travelCapMinor" | "economyOnly">,
  policy: FlightPolicy = DEFAULT_FLIGHT_POLICY,
  fx: FxSnapshot = CACHED_FX,
): SuggestFlightsResult {
  const cap = parseMinor(event.travelCapMinor, "travelCapMinor");
  const checkIn = Date.parse(event.checkInAt);
  const closing = Date.parse(event.closingAt);
  if (Number.isNaN(checkIn) || Number.isNaN(closing)) throw new EngineError("invalid_input", "event check-in and closing times are required");

  const rejected: { id: string; reason: string }[] = [];
  const ok: RankedOffer[] = [];
  for (const o of offers) {
    const total = parseMinor(o.totalMinor, "totalMinor");
    const usd = o.currency === "USD" ? total : convertMinor(total, o.currency, "USD", crossRate(o.currency, "USD", fx));
    const arrivalBuffer = Math.round((checkIn - Date.parse(o.arriveAt)) / MIN);
    const departureBuffer = Math.round((Date.parse(o.returnDepartAt) - closing) / MIN);
    let reason: string | undefined;
    if (event.economyOnly && o.cabin !== "economy") reason = `${o.cabin.replace("_", " ")} cabin; policy is economy only`;
    else if (usd > cap) reason = `${toMinor(usd)} USD minor is over the ${toMinor(cap)} cap`;
    else if (arrivalBuffer < policy.minArrivalBufferMinutes) reason = `arrives ${arrivalBuffer < 0 ? "after" : "too close to"} check-in`;
    else if (arrivalBuffer > policy.maxEarlyArrivalHours * 60) reason = "arrives more than a day and a half early";
    else if (departureBuffer < policy.minDepartureBufferMinutes) reason = "return leaves before closing ends";
    if (reason) {
      rejected.push({ id: o.id, reason });
      continue;
    }
    // Price dominates; each stop costs the equivalent of $40 in ranking only.
    const score = Number(usd) + o.stops * 4_000;
    ok.push({ ...o, usdMinor: toMinor(usd), arrivalBufferMinutes: arrivalBuffer, departureBufferMinutes: departureBuffer, score });
  }
  ok.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const options = ok.slice(0, 3);
  const fixture = offers.some((o) => o.source === "fixture");
  return {
    options,
    rejected,
    truth: fixture ? "Simulated" : "Test mode",
    reason: options.length
      ? `${options.length} option${options.length === 1 ? "" : "s"} under the cap that land before check-in and leave after closing.`
      : "No offer meets the cap, cabin and timing policy; escalate for an exception.",
  };
}

interface RouteFixture {
  origin: string;
  /** Hours of flying time to SFO, door to door including connections. */
  hours: number;
  /** Offset from UTC at the origin on event dates. */
  utcOffset: string;
  currency: string;
  fares: { carrier: string; code: string; minor: number; stops: number; cabin?: FlightOffer["cabin"]; departLocal: string; returnLocal: string }[];
}

/** Realistic demo fares into SFO for Cal Hacks weekend (Fri Oct 23 to Sun Oct 25, 2026). */
const ROUTES: RouteFixture[] = [
  {
    origin: "YYZ", hours: 5.5, utcOffset: "-04:00", currency: "CAD",
    fares: [
      { carrier: "Air Canada", code: "AC 739", minor: 48_900, stops: 0, departLocal: "2026-10-23T07:30", returnLocal: "2026-10-25T23:15" },
      { carrier: "United", code: "UA 2041", minor: 41_200, stops: 1, departLocal: "2026-10-23T06:00", returnLocal: "2026-10-26T07:10" },
      { carrier: "Porter", code: "PD 2261", minor: 52_300, stops: 0, departLocal: "2026-10-22T18:40", returnLocal: "2026-10-26T09:00" },
      { carrier: "Air Canada", code: "AC 755", minor: 168_000, stops: 0, cabin: "business", departLocal: "2026-10-23T07:30", returnLocal: "2026-10-25T23:15" },
      { carrier: "WestJet", code: "WS 1580", minor: 38_500, stops: 1, departLocal: "2026-10-23T11:20", returnLocal: "2026-10-26T08:00" },
    ],
  },
  {
    origin: "JFK", hours: 6.5, utcOffset: "-04:00", currency: "USD",
    fares: [
      { carrier: "JetBlue", code: "B6 415", minor: 31_800, stops: 0, departLocal: "2026-10-23T06:15", returnLocal: "2026-10-25T22:30" },
      { carrier: "Alaska", code: "AS 7", minor: 34_900, stops: 0, departLocal: "2026-10-22T17:00", returnLocal: "2026-10-26T08:45" },
      { carrier: "United", code: "UA 1916", minor: 29_400, stops: 1, departLocal: "2026-10-23T05:30", returnLocal: "2026-10-26T06:30" },
      { carrier: "Delta", code: "DL 420", minor: 55_900, stops: 0, departLocal: "2026-10-23T08:00", returnLocal: "2026-10-25T21:40" },
    ],
  },
  {
    origin: "SEA", hours: 2.25, utcOffset: "-07:00", currency: "USD",
    fares: [
      { carrier: "Alaska", code: "AS 1010", minor: 14_900, stops: 0, departLocal: "2026-10-23T08:00", returnLocal: "2026-10-25T20:30" },
      { carrier: "United", code: "UA 1450", minor: 17_200, stops: 0, departLocal: "2026-10-23T06:30", returnLocal: "2026-10-25T21:55" },
      { carrier: "Delta", code: "DL 2690", minor: 19_800, stops: 0, departLocal: "2026-10-22T19:15", returnLocal: "2026-10-26T07:00" },
    ],
  },
  {
    origin: "LHR", hours: 11, utcOffset: "+01:00", currency: "GBP",
    fares: [
      { carrier: "British Airways", code: "BA 285", minor: 61_000, stops: 0, departLocal: "2026-10-22T11:20", returnLocal: "2026-10-25T21:00" },
      { carrier: "Virgin Atlantic", code: "VS 41", minor: 57_500, stops: 0, departLocal: "2026-10-22T13:00", returnLocal: "2026-10-26T19:50" },
      { carrier: "United", code: "UA 901", minor: 49_800, stops: 0, departLocal: "2026-10-23T09:55", returnLocal: "2026-10-26T15:00" },
    ],
  },
];

/** Add hours to a local wall time and render it as an ISO string in UTC. */
function toUtc(local: string, offset: string, plusHours = 0): string {
  return new Date(Date.parse(`${local}:00${offset}`) + plusHours * 3_600_000).toISOString();
}

/**
 * The fare table is written for Cal Hacks weekend: check-in Fri 1:30 PM PT and
 * closing Sun 3 PM PT. Fixture offers for another event keep the same timing
 * relative to that event's own check-in and closing.
 */
export const FIXTURE_ANCHOR = { checkInAt: "2026-10-23T20:30:00.000Z", closingAt: "2026-10-25T22:00:00.000Z", destination: "SFO" } as const;

/** Approximate airport positions, used only to scale simulated durations and fares to other destinations. */
const AIRPORTS: Record<string, { lat: number; lon: number; city: string }> = {
  SFO: { lat: 37.62, lon: -122.38, city: "San Francisco" },
  LAX: { lat: 33.94, lon: -118.41, city: "Los Angeles" },
  SEA: { lat: 47.45, lon: -122.31, city: "Seattle" },
  YVR: { lat: 49.19, lon: -123.18, city: "Vancouver" },
  YYZ: { lat: 43.68, lon: -79.63, city: "Toronto" },
  YUL: { lat: 45.47, lon: -73.74, city: "Montreal" },
  JFK: { lat: 40.64, lon: -73.78, city: "New York" },
  BOS: { lat: 42.36, lon: -71.01, city: "Boston" },
  ORD: { lat: 41.97, lon: -87.91, city: "Chicago" },
  AUS: { lat: 30.19, lon: -97.67, city: "Austin" },
  LHR: { lat: 51.47, lon: -0.45, city: "London" },
};

const VENUE_AIRPORTS: [RegExp, string][] = [
  [/\b(san francisco|sf|berkeley|oakland|palo alto|stanford|mountain view|san jose|bay area)\b/i, "SFO"],
  [/\b(los angeles|ucla|pasadena)\b/i, "LAX"],
  [/\bseattle\b/i, "SEA"],
  [/\bvancouver\b/i, "YVR"],
  [/\b(toronto|waterloo)\b/i, "YYZ"],
  [/\b(montreal|montréal)\b/i, "YUL"],
  [/\b(new york|nyc|brooklyn|manhattan)\b/i, "JFK"],
  [/\b(boston|cambridge,? ma)\b/i, "BOS"],
  [/\bchicago\b/i, "ORD"],
  [/\baustin\b/i, "AUS"],
  [/\blondon\b/i, "LHR"],
];

export interface FixtureDestination {
  airport: string;
  /** False when the venue named no city we have simulated fares for; fares then go to SFO. */
  recognized: boolean;
}

/** Destination airport for an event, read from its venue text. */
export function destinationFor(venue: string | undefined): FixtureDestination {
  for (const [pattern, airport] of VENUE_AIRPORTS) if (venue && pattern.test(venue)) return { airport, recognized: true };
  return { airport: FIXTURE_ANCHOR.destination, recognized: false };
}

function km(a: string, b: string): number {
  const p = AIRPORTS[a], q = AIRPORTS[b];
  const rad = Math.PI / 180;
  const h = Math.sin(((q.lat - p.lat) * rad) / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(((q.lon - p.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export type FixtureEvent = Pick<EventRecord, "checkInAt" | "closingAt"> & Partial<Pick<EventRecord, "venue">>;

export function fixtureOrigins(): string[] {
  return ROUTES.map((r) => r.origin);
}

/**
 * Simulated offers from `origin` to the event. Without an event, the table's
 * own Cal Hacks weekend into SFO. With an event, departures move with its
 * check-in, returns with its closing, and the destination comes from its venue
 * (durations and fares scaled by distance for destinations other than SFO).
 * Deterministic: the same origin and event always yield the same offers, so a
 * request can be re-verified against the event it was searched for.
 */
export function fixtureOffers(origin: string, event?: FixtureEvent): FlightOffer[] {
  const route = ROUTES.find((r) => r.origin === origin.toUpperCase());
  if (!route) return [];
  const dest = event ? destinationFor(event.venue).airport : FIXTURE_ANCHOR.destination;
  if (dest === route.origin) return [];
  const outShift = event ? Date.parse(event.checkInAt) - Date.parse(FIXTURE_ANCHOR.checkInAt) : 0;
  const backShift = event ? Date.parse(event.closingAt) - Date.parse(FIXTURE_ANCHOR.closingAt) : 0;
  if (Number.isNaN(outShift) || Number.isNaN(backShift)) throw new EngineError("invalid_input", "event check-in and closing times are required");
  const scaled = dest !== FIXTURE_ANCHOR.destination;
  const hours = scaled ? Math.round((0.75 + km(route.origin, dest) / 800) * 4) / 4 : route.hours;
  const ratio = scaled ? Math.min(1.6, Math.max(0.5, km(route.origin, dest) / km(route.origin, FIXTURE_ANCHOR.destination))) : 1;
  const at = (iso: string, shift: number, plusHours = 0) => new Date(Date.parse(iso) + shift + plusHours * 3_600_000).toISOString();
  return route.fares.map((f, i) => {
    const departAt = at(toUtc(f.departLocal, route.utcOffset), outShift);
    const returnDepartAt = at(toUtc(f.returnLocal, "-07:00"), backShift);
    return {
      id: `fx_${route.origin}_${i + 1}`,
      carrier: f.carrier,
      flightNumber: f.code,
      origin: route.origin,
      destination: dest,
      departAt,
      arriveAt: at(departAt, 0, hours + f.stops * 1.5),
      returnDepartAt,
      returnArriveAt: at(returnDepartAt, 0, hours),
      cabin: f.cabin ?? "economy",
      stops: f.stops,
      totalMinor: (scaled ? Math.round((f.minor * ratio) / 100) * 100 : f.minor).toString(),
      currency: route.currency,
      source: "fixture",
    };
  });
}

export { searchDuffelOffers, DuffelError, assertDuffelTestToken } from "./duffel";
