"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { Field, NativeSelect, TextArea } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Organization } from "@/lib/contracts";
import { canManage, type Permission } from "@/lib/client/derive";
import { fromLocalInput, minorToInput, toLocalInput } from "@/lib/client/format";
import { payloads, toMinor } from "@/lib/client/payloads";

type Errors = Record<string, string>;

function money(v: string, key: string, errors: Errors, label: string) {
  if (!v) return undefined;
  const m = toMinor(v);
  if (!m) errors[key] = `Enter ${label} like 300.00.`;
  return m ?? undefined;
}

export function OrgIdentityForm({ snapshot: s, submitLabel = "Save organization", onSaved }: { snapshot: AppSnapshot; submitLabel?: string; onSaved?: () => void }) {
  const [name, setName] = useState(s.org.name);
  const [country, setCountry] = useState(s.org.country);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Field label="Legal name" error={error}>
          {(p) => <Input {...p} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />}
        </Field>
        <Field label="Country" help="Sets which payer rules apply.">
          {(p) => (
            <NativeSelect {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
            </NativeSelect>
          )}
        </Field>
      </div>
      <p className="text-small text-muted-foreground">The EIN or business number is collected by the server into the vault; Eve only ever shows its last four digits.</p>
      <ActionButton
        className="self-start"
        label={submitLabel}
        pendingLabel="Saving"
        permission={canManage(s.actor)}
        onDone={(r) => r.ok && onSaved?.()}
        call={() => {
          if (!name.trim()) {
            setError("Enter the organization's legal name.");
            return null;
          }
          return payloads.orgUpdate({ name: name.trim(), country });
        }}
      />
    </div>
  );
}

export function MoneyMovementForm({ snapshot: s, submitLabel = "Save money movement", onSaved }: { snapshot: AppSnapshot; submitLabel?: string; onSaved?: () => void }) {
  const [mode, setMode] = useState<Organization["mode"]>(s.org.mode);
  const [sponsorName, setSponsorName] = useState(s.org.sponsorName);
  const [turnaround, setTurnaround] = useState(String(s.org.sponsorTurnaroundDays));
  const [feesPaidBy, setFeesPaidBy] = useState(s.org.feesPaidBy);
  const [policyNotes, setPolicyNotes] = useState(s.org.policyNotes ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const group = useId();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-medium">How money moves</legend>
        {([
          ["direct", "Direct", "Eve pays through the connected test-mode provider after a controller releases."],
          ["sponsor", "Sponsor packet", "A university or fiscal sponsor holds the account; Eve prepares packets they pay from."],
          ["hybrid", "Hybrid", "Some payouts go direct, the rest through the sponsor."],
        ] as const).map(([v, label, help]) => (
          <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150 hover:bg-surface has-checked:border-input has-checked:bg-surface has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
            <input type="radio" name={group} value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 size-4 shrink-0 accent-foreground focus-visible:outline-none" />
            <span className="flex flex-col">
              <span className="font-medium">{label}</span>
              <span className="text-small text-muted-foreground">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode !== "direct" ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Field label="Fiscal sponsor">
            {(p) => <Input {...p} value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />}
          </Field>
          <Field label="Turnaround (days)" error={errors.turnaround}>
            {(p) => <Input {...p} inputMode="numeric" value={turnaround} onChange={(e) => setTurnaround(e.target.value.replace(/\D/g, ""))} />}
          </Field>
        </div>
      ) : null}
      <Field label="Payout fees paid by">
        {(p) => (
          <NativeSelect {...p} value={feesPaidBy} onChange={(e) => setFeesPaidBy(e.target.value as Organization["feesPaidBy"])}>
            <option value="org">The organization</option>
            <option value="recipient">The recipient</option>
          </NativeSelect>
        )}
      </Field>
      <Field label="Sponsor rules and policy notes" help="For example: no gift cards; receipts required over $75.">
        {(p) => <TextArea {...p} value={policyNotes} onChange={(e) => setPolicyNotes(e.target.value)} />}
      </Field>
      <ActionButton
        className="self-start"
        label={submitLabel}
        pendingLabel="Saving"
        permission={canManage(s.actor)}
        onDone={(r) => r.ok && onSaved?.()}
        call={() => {
          const days = Number(turnaround);
          if (mode !== "direct" && (!turnaround || days > 120)) {
            setErrors({ turnaround: "Enter 0 to 120 days." });
            return null;
          }
          setErrors({});
          return payloads.orgUpdate({ mode, sponsorName: sponsorName.trim(), sponsorTurnaroundDays: days, feesPaidBy, policyNotes });
        }}
      />
    </div>
  );
}

export function LimitsForm({ snapshot: s, submitLabel = "Save limits", onSaved }: { snapshot: AppSnapshot; submitLabel?: string; onSaved?: () => void }) {
  const [agent, setAgent] = useState(minorToInput(s.org.agentLimitMinor));
  const [organizer, setOrganizer] = useState(minorToInput(s.org.organizerLimitMinor));
  const [errors, setErrors] = useState<Errors>({});
  const controller = s.personas.find((p) => p.role === "controller");
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent auto-approve limit (USD)" error={errors.agent} help="Clean, in-policy claims at or under this are approved by Eve. Payouts still need a controller.">
          {(p) => <Input {...p} inputMode="decimal" value={agent} onChange={(e) => setAgent(e.target.value)} />}
        </Field>
        <Field label="Organizer approval limit (USD)" error={errors.organizer} help="Above this, a controller decides.">
          {(p) => <Input {...p} inputMode="decimal" value={organizer} onChange={(e) => setOrganizer(e.target.value)} />}
        </Field>
      </div>
      <p className="text-small text-muted-foreground">
        {controller ? `${controller.name} is the controller.` : "No controller is assigned."} Eve blocks giving one person both the requester and controller seat on the same payout.
      </p>
      <ActionButton
        className="self-start"
        label={submitLabel}
        pendingLabel="Saving"
        permission={canManage(s.actor)}
        onDone={(r) => r.ok && onSaved?.()}
        call={() => {
          const e: Errors = {};
          const a = money(agent, "agent", e, "a limit");
          const o = money(organizer, "organizer", e, "a limit");
          setErrors(e);
          if (Object.keys(e).length) return null;
          return payloads.orgUpdate({ agentLimitMinor: a, organizerLimitMinor: o });
        }}
      />
    </div>
  );
}

export function NotificationsForm({ snapshot: s, submitLabel = "Save notifications", onSaved }: { snapshot: AppSnapshot; submitLabel?: string; onSaved?: () => void }) {
  const [channel, setChannel] = useState(s.org.notificationChannel ?? "");
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Field label="Slack or Discord channel or webhook" help="Organizers get escalations here; attendees get email and portal notices. Delivery is simulated in this demo.">
        {(p) => <Input {...p} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#finance" />}
      </Field>
      <ActionButton className="self-start" label={submitLabel} pendingLabel="Saving" permission={canManage(s.actor)} onDone={(r) => r.ok && onSaved?.()} call={payloads.orgUpdate({ notificationChannel: channel.trim() })} />
    </div>
  );
}

export function EventBasicsForm({ snapshot: s }: { snapshot: AppSnapshot }) {
  const e = s.event;
  const [name, setName] = useState(e.name);
  const [venue, setVenue] = useState(e.venue);
  const [headcount, setHeadcount] = useState(String(e.expectedHeadcount));
  const [startsAt, setStartsAt] = useState(toLocalInput(e.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(e.endsAt));
  const [checkInAt, setCheckInAt] = useState(toLocalInput(e.checkInAt));
  const [closingAt, setClosingAt] = useState(toLocalInput(e.closingAt));
  const [errors, setErrors] = useState<Errors>({});
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event name" error={errors.name}>{(p) => <Input {...p} value={name} onChange={(x) => setName(x.target.value)} />}</Field>
        <Field label="Venue">{(p) => <Input {...p} value={venue} onChange={(x) => setVenue(x.target.value)} />}</Field>
        <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={startsAt} onChange={(x) => setStartsAt(x.target.value)} />}</Field>
        <Field label="Ends" error={errors.ends}>{(p) => <Input {...p} type="datetime-local" value={endsAt} onChange={(x) => setEndsAt(x.target.value)} />}</Field>
        <Field label="Check-in" help="Flight suggestions arrive before this.">{(p) => <Input {...p} type="datetime-local" value={checkInAt} onChange={(x) => setCheckInAt(x.target.value)} />}</Field>
        <Field label="Closing ceremony" help="Prize payouts are planned for this time.">{(p) => <Input {...p} type="datetime-local" value={closingAt} onChange={(x) => setClosingAt(x.target.value)} />}</Field>
        <Field label="Expected headcount">{(p) => <Input {...p} inputMode="numeric" value={headcount} onChange={(x) => setHeadcount(x.target.value.replace(/\D/g, ""))} />}</Field>
      </div>
      <ActionButton
        className="self-start"
        label="Save basics"
        pendingLabel="Saving"
        permission={canManage(s.actor)}
        call={() => {
          const er: Errors = {};
          if (!name.trim()) er.name = "Name the event.";
          if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) er.ends = "The event must end after it starts.";
          setErrors(er);
          if (Object.keys(er).length) return null;
          return payloads.eventUpdate({
            name: name.trim(), venue: venue.trim(), expectedHeadcount: headcount ? Number(headcount) : undefined,
            startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), checkInAt: fromLocalInput(checkInAt), closingAt: fromLocalInput(closingAt),
          });
        }}
      />
    </div>
  );
}

export function TravelPolicyForm({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [cap, setCap] = useState(minorToInput(s.event.travelCapMinor));
  const [economy, setEconomy] = useState(s.event.economyOnly);
  const [deadline, setDeadline] = useState(toLocalInput(s.event.bookingDeadline));
  const [errors, setErrors] = useState<Errors>({});
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Travel cap per person (USD)" error={errors.cap} help="Receipts in other currencies convert on the purchase date before the cap check.">
          {(p) => <Input {...p} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
        </Field>
        <Field label="Booking deadline">{(p) => <Input {...p} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-small">
        <input type="checkbox" checked={economy} onChange={(e) => setEconomy(e.target.checked)} className="size-4 accent-foreground" />
        Economy only
      </label>
      <ActionButton
        className="self-start"
        label="Save travel policy"
        pendingLabel="Saving"
        permission={canManage(s.actor)}
        call={() => {
          const er: Errors = {};
          const m = money(cap, "cap", er, "a cap");
          setErrors(er);
          if (Object.keys(er).length) return null;
          return payloads.eventUpdate({ travelCapMinor: m, economyOnly: economy, bookingDeadline: fromLocalInput(deadline) });
        }}
      />
    </div>
  );
}

export function PeriodLockForm({ snapshot: s, permission }: { snapshot: AppSnapshot; permission: Permission }) {
  const now = new Date(s.now);
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="text-small text-muted-foreground">
        Locking a month is one-way. The ledger then rejects new entries dated in it; corrections post as linked reversals in an open month.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month to lock">
          {(p) => <Input {...p} type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setConfirm(false); }} className="w-44" />}
        </Field>
        {!confirm || !permission.allowed ? (
          <ActionButton label={`Lock ${period}`} permission={permission} call={() => { setConfirm(true); return null; }} />
        ) : (
          <ActionButton variant="destructive" label={`Confirm: lock ${period} for good`} pendingLabel="Locking" onDone={() => setConfirm(false)} call={payloads.periodLock(period)} />
        )}
      </div>
    </div>
  );
}
