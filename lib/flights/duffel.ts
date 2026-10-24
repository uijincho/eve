// Duffel test-mode search over fetch. Search only: no orders are created,
// so nothing is booked or paid. API shape from
// https://duffel.com/docs/api/v2/offer-requests/create-offer-request (read 2026-10-24).
import type { FlightOffer } from "./index";

export class DuffelError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DuffelError";
  }
}

/** Duffel test tokens start with duffel_test_; anything else is refused. */
export function assertDuffelTestToken(token: string | undefined): string {
  if (!token) throw new DuffelError("Duffel is not configured; using fare fixtures.", 0);
  if (!token.startsWith("duffel_test_")) throw new DuffelError("Only Duffel test tokens are accepted.", 0);
  return token;
}

interface DuffelPlace { time_zone?: string }
interface DuffelSegment {
  departing_at: string; arriving_at: string;
  origin?: DuffelPlace; destination?: DuffelPlace;
  marketing_carrier?: { name?: string; iata_code?: string }; marketing_carrier_flight_number?: string;
}

function tzOffsetMs(ts: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Duffel times are airport-local wall clock without an offset; convert with the airport's IANA zone. */
export function localToUtcIso(local: string, timeZone: string | undefined): string {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(local)) return new Date(local).toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) throw new DuffelError(`unreadable time ${local}`, 502);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  if (!timeZone) throw new DuffelError(`no time zone for ${local}`, 502);
  let utc = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner?: { name?: string };
  slices: { segments: DuffelSegment[]; fare_brand_name?: string }[];
  passengers?: { cabin_class?: string }[];
}

const CABINS = new Set(["economy", "premium_economy", "business", "first"]);

/** "123.45" in a 2-decimal currency → "12345". Duffel amounts are decimal strings. */
function decimalToMinor(amount: string, digits = 2): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m) throw new DuffelError(`unreadable amount ${amount}`, 502);
  const frac = (m[2] ?? "").padEnd(digits, "0");
  if (frac.length > digits) throw new DuffelError(`amount ${amount} has more precision than the currency`, 502);
  return (BigInt(m[1]) * 10n ** BigInt(digits) + BigInt(frac || "0")).toString();
}

export function normalizeDuffelOffer(o: DuffelOffer, cabinRequested: FlightOffer["cabin"]): FlightOffer | null {
  if (o.slices.length < 2) return null;
  const out = o.slices[0].segments;
  const back = o.slices[1].segments;
  if (!out.length || !back.length) return null;
  const cabin = o.passengers?.[0]?.cabin_class;
  const first = out[0];
  return {
    id: o.id,
    carrier: o.owner?.name ?? first.marketing_carrier?.name ?? "Unknown",
    flightNumber: `${first.marketing_carrier?.iata_code ?? ""} ${first.marketing_carrier_flight_number ?? ""}`.trim(),
    origin: "",
    destination: "",
    departAt: localToUtcIso(first.departing_at, first.origin?.time_zone),
    arriveAt: localToUtcIso(out[out.length - 1].arriving_at, out[out.length - 1].destination?.time_zone),
    returnDepartAt: localToUtcIso(back[0].departing_at, back[0].origin?.time_zone),
    returnArriveAt: localToUtcIso(back[back.length - 1].arriving_at, back[back.length - 1].destination?.time_zone),
    cabin: cabin && CABINS.has(cabin) ? (cabin as FlightOffer["cabin"]) : cabinRequested,
    stops: out.length - 1,
    totalMinor: decimalToMinor(o.total_amount, o.total_currency === "JPY" ? 0 : 2),
    currency: o.total_currency,
    source: "duffel_test",
  };
}

/** Search round trips. Times are normalized to UTC ISO strings. */
export async function searchDuffelOffers(
  input: { origin: string; destination: string; departureDate: string; returnDate: string; cabin?: FlightOffer["cabin"]; maxOffers?: number },
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<FlightOffer[]> {
  const token = assertDuffelTestToken(options.token ?? process.env.DUFFEL_ACCESS_TOKEN);
  const cabin = input.cabin ?? "economy";
  const res = await (options.fetchImpl ?? fetch)("https://api.duffel.com/air/offer_requests?return_offers=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Duffel-Version": "v2",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      data: {
        slices: [
          { origin: input.origin, destination: input.destination, departure_date: input.departureDate },
          { origin: input.destination, destination: input.origin, departure_date: input.returnDate },
        ],
        passengers: [{ type: "adult" }],
        cabin_class: cabin,
        max_connections: 1,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { offers?: DuffelOffer[]; live_mode?: boolean }; errors?: { message?: string }[] };
  if (!res.ok) throw new DuffelError(body.errors?.[0]?.message ?? `Duffel returned HTTP ${res.status}`, res.status);
  if (body.data?.live_mode) throw new DuffelError("Duffel returned live-mode data; refusing.", 502);
  return (body.data?.offers ?? [])
    .slice(0, input.maxOffers ?? 50)
    .map((o) => normalizeDuffelOffer(o, cabin))
    .filter((o): o is FlightOffer => o !== null)
    .map((o) => ({ ...o, origin: input.origin, destination: input.destination }));
}
