"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { EveMark } from "@/components/eve/logo";
import { Field, NativeSelect } from "@/components/app/field";
import { LinkButton } from "@/components/app/link-button";
import { ResultText } from "@/components/app/result-text";
import { ListSkeleton } from "@/components/app/states";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/client/api";
import { homeFor, onboarding, type NewOrganization, type Onboarding } from "@/lib/client/account";
import { fromLocalInput, toLocalInput } from "@/lib/client/format";
import { toMinor } from "@/lib/client/payloads";

const day = 86_400_000;
/** A starting schedule two weeks out; every field stays editable. */
function defaults() {
  const start = new Date(Date.now() + 14 * day);
  start.setHours(9, 0, 0, 0);
  const at = (offsetMs: number) => toLocalInput(new Date(start.getTime() + offsetMs).toISOString());
  return {
    startsAt: at(0),
    endsAt: at(day + 8 * 3_600_000),
    checkInAt: at(2 * 3_600_000),
    closingAt: at(day + 6 * 3_600_000),
    bookingDeadline: at(-4 * day),
  };
}

/** First run for a new account: create the organization and its first event. */
export function OnboardingView() {
  const router = useRouter();
  const [me, setMe] = useState<Onboarding | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  useEffect(() => {
    onboarding
      .get()
      .then((m) => {
        if (!m.needsSetup && m.memberships.length) router.replace(homeFor(m.memberships[0].role));
        else setMe(m);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) router.replace("/login?next=/onboarding");
        else setLoadError(e instanceof ApiError ? e : new ApiError("Could not reach Eve.", 0));
      });
  }, [router]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12 sm:py-16">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-heading"><EveMark />Eve</span>
        <h1 className="text-title">Set up your organization</h1>
        <p className="max-w-[60ch] text-small text-muted-foreground">
          Eve needs who pays, how money moves, and your first event. You can change all of it later in Settings and Event setup.
        </p>
      </div>
      {loadError ? <ResultText result={{ ok: false, message: loadError.message }} /> : null}
      {!me && !loadError ? <ListSkeleton rows={3} label="Loading your account" /> : null}
      {me ? (
        <>
          {me.pendingInvitations.length ? (
            <div className="flex flex-col gap-1 rounded-xl border px-4 py-3">
              <p className="font-semibold">You have {me.pendingInvitations.length === 1 ? "an invitation" : `${me.pendingInvitations.length} invitations`}</p>
              <p className="text-small text-muted-foreground">
                {me.pendingInvitations.map((i) => `${i.orgName} (${i.role}, from ${i.invitedByName})`).join("; ")}. Open the link from the person who invited you to join instead of creating a new organization.
              </p>
            </div>
          ) : null}
          <SetupForm userName={me.user.name} onCreated={() => router.replace("/overview")} />
        </>
      ) : null}
    </main>
  );
}

function SetupForm({ userName, onCreated }: { userName: string; onCreated: () => void }) {
  const d = defaults();
  const modeName = useId();
  const [orgName, setOrgName] = useState("");
  const [country, setCountry] = useState<"US" | "CA">("US");
  const [mode, setMode] = useState<"direct" | "sponsor" | "hybrid">("sponsor");
  const [sponsorName, setSponsorName] = useState("");
  const [eventName, setEventName] = useState("");
  const [venue, setVenue] = useState("");
  const [headcount, setHeadcount] = useState("150");
  const [travelCap, setTravelCap] = useState("500.00");
  const [startsAt, setStartsAt] = useState(d.startsAt);
  const [endsAt, setEndsAt] = useState(d.endsAt);
  const [checkInAt, setCheckInAt] = useState(d.checkInAt);
  const [closingAt, setClosingAt] = useState(d.closingAt);
  const [bookingDeadline, setBookingDeadline] = useState(d.bookingDeadline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const er: Record<string, string> = {};
    const t = (v: string) => new Date(v).getTime();
    if (!orgName.trim()) er.orgName = "Enter the organization's legal name.";
    if (!eventName.trim()) er.eventName = "Name the event.";
    if (!venue.trim()) er.venue = "Enter where it happens.";
    if (!/^\d+$/.test(headcount)) er.headcount = "Enter a whole number of people.";
    const cap = toMinor(travelCap);
    if (!cap) er.travelCap = "Enter a cap like 500.00.";
    if (!(t(endsAt) > t(startsAt))) er.endsAt = "The event must end after it starts.";
    if (!(t(checkInAt) >= t(startsAt) && t(checkInAt) <= t(endsAt))) er.checkInAt = "Check-in must fall within the event.";
    if (!(t(closingAt) >= t(startsAt) && t(closingAt) <= t(endsAt))) er.closingAt = "The closing ceremony must fall within the event.";
    if (!(t(bookingDeadline) < t(startsAt))) er.bookingDeadline = "Travel booking must close before the event starts.";
    setErrors(er);
    setFailure(null);
    if (Object.keys(er).length) return;
    const body: NewOrganization = {
      org: { name: orgName.trim(), country, currency: country === "CA" ? "CAD" : "USD", mode, sponsorName: mode === "direct" ? undefined : sponsorName.trim() || undefined },
      event: {
        name: eventName.trim(), venue: venue.trim(), expectedHeadcount: Number(headcount), travelCapMinor: cap!, economyOnly: true,
        startsAt: fromLocalInput(startsAt)!, endsAt: fromLocalInput(endsAt)!, checkInAt: fromLocalInput(checkInAt)!,
        closingAt: fromLocalInput(closingAt)!, bookingDeadline: fromLocalInput(bookingDeadline)!,
      },
    };
    if (body.org.sponsorName === undefined) delete body.org.sponsorName;
    setPending(true);
    try {
      await onboarding.createOrganization(body);
      onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : "Eve could not be reached. Your organization was not created; try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-10">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-subheading">Organization</legend>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Legal name" error={errors.orgName} help={`You (${userName}) become its first organizer.`}>
            {(p) => <Input {...p} autoComplete="organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} />}
          </Field>
          <Field label="Country" help="Sets which payer rules apply.">
            {(p) => (
              <NativeSelect {...p} value={country} onChange={(e) => setCountry(e.target.value as "US" | "CA")}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
              </NativeSelect>
            )}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium">How money moves</legend>
          {([
            ["sponsor", "Sponsor packet", "A university or fiscal sponsor holds the account; Eve prepares packets they pay from."],
            ["direct", "Direct", "Eve pays through a payout provider after a controller releases."],
            ["hybrid", "Hybrid", "Some payouts go direct, the rest through the sponsor."],
          ] as const).map(([v, label, help]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150 hover:bg-surface has-checked:border-input has-checked:bg-surface has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              <input type="radio" name={modeName} value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 focus-visible:outline-none" />
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-small text-muted-foreground">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode !== "direct" ? (
          <Field label="Fiscal sponsor" help="Optional now. The sponsor stays a simulated counterparty until connected.">
            {(p) => <Input {...p} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />}
          </Field>
        ) : null}
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <TruthLabel kind="test" /> New organizations move only test-mode or simulated money.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-subheading">First event</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event name" error={errors.eventName}>{(p) => <Input {...p} value={eventName} onChange={(e) => setEventName(e.target.value)} />}</Field>
          <Field label="Venue" error={errors.venue}>{(p) => <Input {...p} value={venue} onChange={(e) => setVenue(e.target.value)} />}</Field>
          <Field label="Starts" error={errors.startsAt}>{(p) => <Input {...p} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
          <Field label="Ends" error={errors.endsAt}>{(p) => <Input {...p} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}</Field>
          <Field label="Check-in" error={errors.checkInAt}>{(p) => <Input {...p} type="datetime-local" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} />}</Field>
          <Field label="Closing ceremony" error={errors.closingAt} help="Prize payouts are planned for this time.">{(p) => <Input {...p} type="datetime-local" value={closingAt} onChange={(e) => setClosingAt(e.target.value)} />}</Field>
          <Field label="Travel booking closes" error={errors.bookingDeadline}>{(p) => <Input {...p} type="datetime-local" value={bookingDeadline} onChange={(e) => setBookingDeadline(e.target.value)} />}</Field>
          <Field label="Expected headcount" error={errors.headcount}>{(p) => <Input {...p} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, ""))} />}</Field>
          <Field label="Travel cap per person" error={errors.travelCap} help="In the organization's currency. Economy only to start.">{(p) => <Input {...p} inputMode="decimal" value={travelCap} onChange={(e) => setTravelCap(e.target.value)} />}</Field>
        </div>
        <p className="text-small text-muted-foreground">Eve starts four budget lines (travel, ground transport, team supplies, prizes) for you to confirm in Budget.</p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" aria-busy={pending || undefined}>
          {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {pending ? "Creating organization" : "Create organization"}
        </Button>
        <LinkButton href="/login" variant="ghost">Use a different account</LinkButton>
      </div>
      <span role="status" aria-live="polite">{failure ? <ResultText result={{ ok: false, message: failure }} /> : null}</span>
    </form>
  );
}
