"use client";

import { LoaderCircleIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { CopyLink } from "@/components/app/copy-link";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { Field, NativeSelect } from "@/components/app/field";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { ResultText } from "@/components/app/result-text";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Person } from "@/lib/contracts";
import { invitations, type CreatedInvite } from "@/lib/client/account";
import { ApiError } from "@/lib/client/api";
import { big, canOrganize, payoutSource, type Permission, payoutValue } from "@/lib/client/derive";
import { fmtDate, fmtDateTime } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";
import { initialParam } from "@/lib/client/url-param";

type Filter = "all" | "attention" | "missing" | "expired" | "valid";

export function PeopleView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(() => initialParam("person"));

  return (
    <PageFrame
      title="People"
      lede={(s) => `${s.people.length} attendees, judges, and mentors. Tax identifiers and bank numbers stay in the vault; Eve sees only the last four digits.`}
      actions={(s) =>
        canOrganize(s.actor).allowed ? (
          <LinkButton href="/events/new?tab=import" variant="outline">
            <UploadIcon aria-hidden />
            Import people
          </LinkButton>
        ) : null
      }
    >
      {(s) => {
        const q = query.trim().toLowerCase();
        const match = (p: Person, f: Filter) =>
          f === "all" ? true : f === "attention" ? p.taxStatus !== "valid" || !p.adult : p.taxStatus === f;
        const rows = s.people.filter((p) => match(p, filter)).filter((p) => !q || `${p.name} ${p.email} ${p.country}`.toLowerCase().includes(q));
        const selected = s.people.find((p) => p.id === openId);
        const columns: Column<Person>[] = [
          { key: "name", header: "Person", stack: "title", sort: (p) => p.name, cell: (p) => p.name },
          { key: "role", header: "Role", stack: "meta", sort: (p) => p.role, cell: (p) => `${p.role} · ${p.country}${p.citizenship !== p.country ? ` (citizen ${p.citizenship})` : ""}` },
          { key: "form", header: "Tax form", stack: "end", sort: (p) => p.taxStatus, cell: (p) => <span className="inline-flex items-center gap-2">{p.taxForm} <StatusBadge status={p.taxStatus} /></span> },
          { key: "chase", header: "Chases", align: "end", stack: "hide", sort: (p) => p.chaseCount, cell: (p) => <span className="tabular-nums">{p.chaseCount}</span> },
          { key: "ytd", header: "Paid YTD", align: "end", stack: "hide", sort: (p) => big(p.paidYtdMinor), cell: (p) => <Money amountMinor={big(p.paidYtdMinor)} /> },
          { key: "out", header: "Outstanding", align: "end", stack: "end", sort: (p) => big(p.outstandingMinor), cell: (p) => <Money amountMinor={big(p.outstandingMinor)} className="font-semibold" /> },
        ];
        return (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <FilterChips
                label="Tax status"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All", count: s.people.length },
                  { value: "attention", label: "Needs attention", count: s.people.filter((p) => match(p, "attention")).length },
                  { value: "missing", label: "Form missing", count: s.people.filter((p) => match(p, "missing")).length },
                  { value: "expired", label: "Expired", count: s.people.filter((p) => match(p, "expired")).length },
                  { value: "valid", label: "Valid", count: s.people.filter((p) => match(p, "valid")).length },
                ]}
              />
              <label className="relative ml-auto w-full sm:w-64">
                <span className="sr-only">Search people</span>
                <SearchIcon aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, country" className="pl-8" />
              </label>
            </div>
            <DataTable
              label="People"
              rows={rows}
              columns={columns}
              rowKey={(p) => p.id}
              onRowClick={(p) => setOpenId(p.id)}
              selectedKey={openId}
              initialSort={{ key: "name", dir: "asc" }}
              empty={<EmptyState title="No one matches">Change the filter or import attendees from a CSV in event setup.</EmptyState>}
            />
            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected?.name ?? "Person"} description={selected ? `${selected.role} · ${selected.email}` : undefined}>
              {selected ? <PersonDetail person={selected} snapshot={s} /> : null}
            </Sheet>
          </>
        );
      }}
    </PageFrame>
  );
}

function PersonDetail({ person: p, snapshot: s }: { person: Person; snapshot: AppSnapshot }) {
  const payouts = s.payouts.filter((x) => x.personId === p.id);
  const notices = s.notices.filter((n) => n.personId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [last4, setLast4] = useState("");
  const [currency, setCurrency] = useState(p.payoutCurrency || "USD");
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-muted-foreground">Residency</dt>
        <dd>{p.country}</dd>
        <dt className="text-muted-foreground">Citizenship</dt>
        <dd>{p.citizenship}</dd>
        <dt className="text-muted-foreground">Age check</dt>
        <dd>{p.adult ? "18 or older at event start" : <span className="text-critical">Under 18: blocked</span>}</dd>
        <dt className="text-muted-foreground">Tax form</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {p.taxForm} <StatusBadge status={p.taxStatus} />
          {p.taxLast4 ? <span className="text-muted-foreground">TIN ••{p.taxLast4}</span> : null}
        </dd>
        <dt className="text-muted-foreground">Signed</dt>
        <dd>{p.taxSignedAt ? fmtDate(p.taxSignedAt, true) : "Not signed"}{p.taxExpiresAt ? ` · expires ${fmtDate(p.taxExpiresAt, true)}` : ""}</dd>
        <dt className="text-muted-foreground">Payout account</dt>
        <dd>{p.payoutLast4 ? `${p.payoutCurrency} ••${p.payoutLast4}` : "None yet"}{p.payoutChangedAt ? ` · changed ${fmtDateTime(p.payoutChangedAt)}` : ""}</dd>
        <dt className="text-muted-foreground">Paid this year</dt>
        <dd><Money amountMinor={big(p.paidYtdMinor)} /></dd>
        <dt className="text-muted-foreground">Outstanding</dt>
        <dd><Money amountMinor={big(p.outstandingMinor)} /></dd>
        <dt className="text-muted-foreground">Chases</dt>
        <dd className="tabular-nums">{p.chaseCount}</dd>
      </dl>

      <PortalInvite person={p} snapshot={s} />

      {payouts.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Payouts</h3>
          <ul className="flex flex-col divide-y rounded-xl border">
            {payouts.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2 text-small">
                <span>{payoutSource(s, x)}</span>
                <span className="flex items-center gap-2"><Money amountMinor={payoutValue(x)} currency={x.currency} /> <StatusBadge status={x.status} /></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">Messages and chases</h3>
        {notices.length ? (
          <ol className="flex flex-col gap-3">
            {notices.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 text-small">
                <span className="font-medium">{n.title}</span>
                <span className="text-muted-foreground">{n.body}</span>
                <span className="text-caption text-faint">{fmtDateTime(n.createdAt)} · {n.channel} · {n.status}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-small text-muted-foreground">No messages yet. Eve logs every chase and reminder here.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Replay a bank-detail change</h3>
          <TruthLabel kind="simulated" />
        </div>
        <p className="text-small text-muted-foreground">
          Simulates {p.name.split(" ")[0]} sending new bank details. Eve should freeze any pending payout and confirm through the original channel.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <Field label="New account, last 4">
            {(f) => <Input {...f} inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="9902" />}
          </Field>
          <Field label="Currency">
            {(f) => (
              <NativeSelect {...f} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["USD", "CAD", "EUR", "GBP", "INR", "MXN"].map((c) => <option key={c}>{c}</option>)}
              </NativeSelect>
            )}
          </Field>
        </div>
        <ActionButton
          label="Send simulated change"
          pendingLabel="Sending"
          permission={canOrganize(s.actor)}
          call={() => (last4.length === 4 ? payloads.payoutBankChange(p.id, last4, currency) : null)}
        />
      </section>
    </div>
  );
}

/** Organizers send an imported adult their own portal link. Eve does not email it. */
function PortalInvite({ person: p, snapshot: s }: { person: Person; snapshot: AppSnapshot }) {
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const linked = s.personas.some((a) => a.personId === p.id);
  const permission: Permission = s.actor.role !== "organizer"
    ? { allowed: false, reason: "Only organizers invite attendees." }
    : !p.adult
      ? { allowed: false, reason: "Eve only pays adults; this person is under 18 at the event start." }
      : linked
        ? { allowed: false, reason: `${p.name.split(" ")[0]} already has portal access.` }
        : { allowed: true };
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">Portal access</h3>
      {created ? (
        <CopyLink url={created.acceptUrl} label={`Portal link for ${p.name}`} />
      ) : permission.allowed ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            aria-busy={pending || undefined}
            onClick={async () => {
              if (pending) return;
              setPending(true);
              setFailure(null);
              try {
                setCreated(await invitations.inviteAttendee(p.id));
              } catch (e) {
                setFailure(e instanceof ApiError ? e.message : "Eve could not be reached. No invitation was created.");
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {pending ? "Creating link" : "Invite to portal"}
          </Button>
          <span className="text-small text-muted-foreground">Sent to {p.email} only when you share the link.</span>
          <span role="status" aria-live="polite">{failure ? <ResultText result={{ ok: false, message: failure }} /> : null}</span>
        </div>
      ) : (
        <p className="text-small text-muted-foreground">{permission.reason}</p>
      )}
    </section>
  );
}
