// Flight suggestions: three options under the cap, timed to the event.
//
// Offers come from Duffel test mode (duffel.ts) when a test token is set, or
// from the fixture table below. Fixture fares are realistic round numbers
// for demo routes into SFO, labelled "Simulated". Nothing here books a flight.
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

export function fixtureOrigins(): string[] {
  return ROUTES.map((r) => r.origin);
}

export function fixtureOffers(origin: string): FlightOffer[] {
  const route = ROUTES.find((r) => r.origin === origin.toUpperCase());
  if (!route) return [];
  return route.fares.map((f, i) => ({
    id: `fx_${route.origin}_${i + 1}`,
    carrier: f.carrier,
    flightNumber: f.code,
    origin: route.origin,
    destination: "SFO",
    departAt: toUtc(f.departLocal, route.utcOffset),
    arriveAt: toUtc(f.departLocal, route.utcOffset, route.hours + f.stops * 1.5),
    returnDepartAt: toUtc(f.returnLocal, "-07:00"),
    returnArriveAt: toUtc(f.returnLocal, "-07:00", route.hours),
    cabin: f.cabin ?? "economy",
    stops: f.stops,
    totalMinor: f.minor.toString(),
    currency: route.currency,
    source: "fixture",
  }));
}

export { searchDuffelOffers, DuffelError, assertDuffelTestToken } from "./duffel";
