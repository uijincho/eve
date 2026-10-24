"use client";

import { LoaderCircleIcon, PlaneIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { ResultText } from "@/components/app/result-text";
import { Field } from "@/components/app/field";
import { Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, AppSnapshot, Person } from "@/lib/contracts";
import { big } from "@/lib/client/derive";
import { fmtDate, fmtDateTime, humanize } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";
import { useEve } from "@/lib/client/use-eve";

import { PortalFrame } from "./portal-frame";

/**
 * A fare as flight.search returns it (lib/flights RankedOffer). The price and
 * itinerary are for display; the request sends only the offer id and the
 * server's signed token, so the server decides what is booked and for how much.
 */
type Offer = {
  id: string;
  offerToken?: string;
  carrier: string;
  flightNumber?: string;
  origin: string;
  destination?: string;
  departAt: string;
  arriveAt?: string;
  returnDepartAt?: string;
  totalMinor: string;
  currency: string;
  usdMinor?: string;
  cabin?: string;
  stops?: number;
  source?: string;
  expiresAt?: string;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function readOffers(data: Record<string, unknown> | undefined, origin: string): Offer[] {
  const raw = Array.isArray(data?.offers) ? (data!.offers as Record<string, unknown>[]) : [];
  return raw
    .map((o) => ({
      id: String(o.id ?? ""),
      offerToken: str(o.offerToken),
      carrier: str(o.carrier) ?? "Airline",
      flightNumber: str(o.flightNumber),
      origin: str(o.origin) ?? origin,
      destination: str(o.destination),
      departAt: str(o.departAt) ?? "",
      arriveAt: str(o.arriveAt),
      returnDepartAt: str(o.returnDepartAt),
      totalMinor: String(o.totalMinor ?? "0"),
      currency: str(o.currency) ?? "USD",
      usdMinor: str(o.usdMinor),
      cabin: str(o.cabin),
      stops: typeof o.stops === "number" ? o.stops : undefined,
      source: str(o.source),
      expiresAt: str(o.expiresAt),
    }))
    .filter((o) => o.id && o.departAt);
}

export function PortalTravel() {
  return (
    <PortalFrame title="Travel" lede="Tell Eve where you are flying from. It suggests three fares under the cap that land before check-in; the organizers book the one you pick, so there is nothing to reimburse.">
      {(s, me) => <Travel snapshot={s} me={me} />}
    </PortalFrame>
  );
}

function Travel({ snapshot: s, me }: { snapshot: AppSnapshot; me: Person }) {
  const { act } = useEve();
  const [origin, setOrigin] = useState("");
  const [date, setDate] = useState(s.event.startsAt.slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [rejected, setRejected] = useState<{ id: string; reason: string }[]>([]);
  const requests = s.claims.filter((c) => c.personId === me.id && c.type === "travel");

  return (
    <div className="flex flex-col gap-10">
      <Section title="Find a flight" aside={<span>Cap <Money amountMinor={big(s.event.travelCapMinor)} />{s.event.economyOnly ? " · economy only" : ""} · book by {fmtDate(s.event.bookingDeadline)}</span>}>
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const code = origin.trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(code)) return setError("Use a three-letter airport code, like YYZ.");
            setError(null);
            setPending(true);
            const r = await act(payloads.flightSearch({ origin: code, date: date || undefined, personId: me.id }));
            setPending(false);
            const found = r.ok ? readOffers(r.data, code) : [];
            setOffers(found);
            setRejected(r.ok && Array.isArray(r.data?.rejected) ? (r.data.rejected as { id: string; reason: string }[]) : []);
            // The server says why nothing qualified (cap, cabin, or timing); show that, not a guess.
            setResult(r.ok && found.length ? null : r.ok ? { ok: false, message: r.message || "No fare meets the travel policy for that route." } : r);
          }}
        >
          <Field label="From airport" error={error} className="w-36">
            {(p) => <Input {...p} value={origin} maxLength={3} onChange={(e) => setOrigin(e.target.value)} placeholder="YYZ" className="uppercase" />}
          </Field>
          <Field label="Departure date" className="w-44">
            {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Button type="submit" variant="secondary" aria-busy={pending || undefined} disabled={pending}>
            {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <PlaneIcon aria-hidden />}
            {pending ? "Searching" : "Suggest flights"}
          </Button>
          <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
        </form>
        {!offers.length && rejected.length ? (
          <details className="rounded-xl border px-4 py-3 text-small">
            <summary className="cursor-pointer font-medium">Why {rejected.length} {rejected.length === 1 ? "fare was" : "fares were"} left out</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              {rejected.map((x) => (
                <li key={x.id}>{x.reason.charAt(0).toUpperCase() + x.reason.slice(1)}.</li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">Ask an organizer for an exception, or book it yourself and upload the e-ticket on Claims.</p>
          </details>
        ) : null}
        {offers.length ? (
          <ul className="flex flex-col divide-y rounded-xl border" aria-label="Suggested fares">
            {offers.slice(0, 3).map((o, i) => (
              <li key={o.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {o.carrier}{o.flightNumber ? ` ${o.flightNumber}` : ""} · {o.origin}{o.destination ? ` → ${o.destination}` : ""}
                    {i === 0 ? <span className="text-caption font-medium text-muted-foreground">Best fit</span> : null}
                  </span>
                  <span className="text-small text-muted-foreground">
                    Departs {fmtDateTime(o.departAt)}{o.arriveAt ? ` · arrives ${fmtDateTime(o.arriveAt)}` : ""}{o.cabin ? ` · ${humanize(o.cabin).toLowerCase()}` : ""}{o.stops !== undefined ? ` · ${o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}` : ""}
                  </span>
                  {o.returnDepartAt ? <span className="text-small text-muted-foreground">Returns {fmtDateTime(o.returnDepartAt)}</span> : null}
                </span>
                <span className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                  <TruthLabel kind={o.source === "duffel_test" ? "test" : "simulated"} />
                  <span className="flex flex-col items-end">
                    <Money amountMinor={big(o.totalMinor)} currency={o.currency} className="font-semibold" />
                    {o.usdMinor && o.currency !== "USD" ? <Money amountMinor={big(o.usdMinor)} currency="USD" estimate className="text-caption text-muted-foreground" /> : null}
                  </span>
                  <ActionButton
                    label="Request this flight"
                    pendingLabel="Requesting"
                    variant={i === 0 ? "secondary" : "ghost"}
                    call={payloads.flightRequest({ personId: me.id, offerId: o.id, origin: o.origin, offerToken: o.offerToken })}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Your travel">
        {requests.length ? (
          <ul className="flex flex-col divide-y rounded-xl border">
            {requests.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <span className="font-medium">{c.merchant}{c.origin ? ` · from ${c.origin}` : ""}</span>
                  <span className="text-small text-muted-foreground">{c.reason || c.description}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Money amountMinor={big(c.usdMinor)} className="font-semibold" />
                  <StatusBadge status={c.status} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted-foreground">No flight requests or travel claims yet. Already booked? Upload the e-ticket on Claims.</p>
        )}
        {requests.some((c) => c.category === "org_booked_flight") ? (
          <p className="text-small text-muted-foreground">
            Flights you request are booked by the organizers once approved, so you pay nothing and there is nothing to reimburse. Bookings in this demo are simulated.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
