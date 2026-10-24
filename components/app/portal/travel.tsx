"use client";

import { LoaderCircleIcon, PlaneIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton, ResultText } from "@/components/app/action-button";
import { Field } from "@/components/app/field";
import { Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, AppSnapshot, Person } from "@/lib/contracts";
import { big } from "@/lib/client/derive";
import { fmtDate, fmtDateTime } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";
import { useEve } from "@/lib/client/use-eve";

import { PortalFrame } from "./portal-frame";

/** A fare offer as the server returns it. Read defensively: fixtures may vary. */
type Offer = {
  id: string;
  carrier: string;
  origin: string;
  departAt: string;
  arriveAt?: string;
  amountMinor: string;
  currency: string;
  cabin?: string;
  stops?: number;
  note?: string;
  truth?: string;
};

function readOffers(data: Record<string, unknown> | undefined, origin: string): Offer[] {
  const raw = Array.isArray(data?.offers) ? (data!.offers as Record<string, unknown>[]) : [];
  return raw
    .map((o) => ({
      id: String(o.id ?? o.offerId ?? ""),
      carrier: String(o.carrier ?? o.airline ?? "Airline"),
      origin: String(o.origin ?? origin),
      departAt: String(o.departAt ?? o.departureAt ?? ""),
      arriveAt: o.arriveAt ? String(o.arriveAt) : o.arrivalAt ? String(o.arrivalAt) : undefined,
      amountMinor: String(o.amountMinor ?? o.priceMinor ?? "0"),
      currency: String(o.currency ?? "USD"),
      cabin: o.cabin ? String(o.cabin) : undefined,
      stops: typeof o.stops === "number" ? o.stops : undefined,
      note: o.note ? String(o.note) : o.reason ? String(o.reason) : undefined,
      truth: o.truth ? String(o.truth) : o.label ? String(o.label) : undefined,
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
            setResult(r.ok ? null : r);
            setOffers(r.ok ? readOffers(r.data, code) : []);
            if (r.ok && !readOffers(r.data, code).length) setResult({ ok: false, message: "No fares under the cap for that route and date." });
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
        {offers.length ? (
          <ul className="flex flex-col divide-y rounded-xl border" aria-label="Suggested fares">
            {offers.slice(0, 3).map((o, i) => (
              <li key={o.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {o.carrier} · {o.origin} → SFO
                    {i === 0 ? <span className="text-caption font-medium text-muted-foreground">Best fit</span> : null}
                  </span>
                  <span className="text-small text-muted-foreground">
                    Departs {fmtDateTime(o.departAt)}{o.arriveAt ? ` · arrives ${fmtDateTime(o.arriveAt)}` : ""}{o.cabin ? ` · ${o.cabin}` : ""}{o.stops !== undefined ? ` · ${o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}` : ""}
                  </span>
                  {o.note ? <span className="text-small text-muted-foreground">{o.note}</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  {o.truth ? <TruthLabel kind={o.truth.toLowerCase().includes("test") ? "test" : "simulated"} /> : <TruthLabel kind="simulated" />}
                  <Money amountMinor={big(o.amountMinor)} currency={o.currency} className="font-semibold" />
                  <ActionButton
                    label="Request this flight"
                    pendingLabel="Requesting"
                    variant={i === 0 ? "secondary" : "ghost"}
                    call={payloads.flightRequest({ personId: me.id, offerId: o.id, origin: o.origin, carrier: o.carrier, departAt: o.departAt, amountMinor: o.amountMinor, currency: o.currency, cabin: o.cabin })}
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
                  <span className="font-medium">{c.merchant} · {c.origin ?? ""} → SFO</span>
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
      </Section>
    </div>
  );
}
