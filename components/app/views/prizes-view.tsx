"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton, ResultText } from "@/components/app/action-button";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { Field, NativeSelect } from "@/components/app/field";
import { PageFrame } from "@/components/app/page-frame";
import { PrizeComparison } from "@/components/app/prize-comparison";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, AppSnapshot, Award } from "@/lib/contracts";
import { big, canManage, FULFILLMENT_LABEL, prizeOptions } from "@/lib/client/derive";
import { payloads, toMinor } from "@/lib/client/payloads";
import { initialParam } from "@/lib/client/url-param";
import { useEve } from "@/lib/client/use-eve";

type Filter = "open" | "needs_form" | "ready" | "proposed" | "paid" | "all";

export function PrizesView() {
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(() => initialParam("award"));
  const [entryOpen, setEntryOpen] = useState(false);
  const [evidence, setEvidence] = useState<Award | null>(null);

  return (
    <PageFrame
      title="Prizes and winners"
      lede={(s) => {
        const held = s.awards.filter((a) => a.status === "needs_form").length;
        return `${s.awards.length} prizes entered. ${held} held for a tax form. Item prizes compare shipping, buying locally, and cash.`;
      }}
      actions={(s) =>
        canManage(s.actor).allowed ? (
          <Button onClick={() => setEntryOpen(true)}>
            <PlusIcon aria-hidden />
            Enter a winner
          </Button>
        ) : null
      }
    >
      {(s) => {
        const rows = s.awards.filter((a) =>
          filter === "all" ? true : filter === "open" ? a.status !== "paid" : a.status === filter,
        );
        const count = (f: Filter) => s.awards.filter((a) => (f === "all" ? true : f === "open" ? a.status !== "paid" : a.status === f)).length;
        const selected = s.awards.find((a) => a.id === openId);
        const people = new Map(s.people.map((p) => [p.id, p]));
        const columns: Column<Award>[] = [
          { key: "winner", header: "Winner", stack: "title", sort: (a) => a.personName, cell: (a) => a.personName },
          { key: "prize", header: "Prize", stack: "meta", sort: (a) => a.track, cell: (a) => `${a.track} · ${a.title}${a.teamId ? " · team" : ""}` },
          {
            key: "form",
            header: "Tax form",
            stack: "meta",
            cell: (a) => {
              const p = people.get(a.personId);
              return p ? `${p.country} · ${p.taxForm} ${p.taxStatus === "valid" ? "valid" : p.taxStatus === "missing" ? "not signed" : p.taxStatus}` : "—";
            },
          },
          { key: "fulfil", header: "Fulfilment", stack: "meta", cell: (a) => (a.kind === "cash" ? "Cash" : FULFILLMENT_LABEL[a.fulfillment]) },
          { key: "status", header: "Status", stack: "end", sort: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
          {
            key: "net",
            header: "Value / est. net",
            align: "end",
            stack: "end",
            sort: (a) => big(a.amountMinor),
            cell: (a) => {
              const payout = s.payouts.find((p) => p.sourceType === "award" && p.sourceId === a.id);
              const o = prizeOptions(s, a, people.get(a.personId), payout);
              return (
                <span className="flex flex-col items-end">
                  <Money amountMinor={o.gross} currency={a.currency} className="font-semibold" />
                  <Money amountMinor={o.cashNet} currency={a.currency} estimate={!o.fromPayout} className="text-caption text-muted-foreground" />
                </span>
              );
            },
          },
          { key: "due", header: "Due", align: "end", stack: "hide", sort: (a) => a.dueAt, cell: (a) => <DueChip due={a.dueAt} now={s.now} align="end" /> },
        ];
        return (
          <>
            <FilterChips
              label="Status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: "Open", count: count("open") },
                { value: "needs_form", label: "Needs form", count: count("needs_form") },
                { value: "ready", label: "Ready", count: count("ready") },
                { value: "proposed", label: "Proposed", count: count("proposed") },
                { value: "paid", label: "Paid", count: count("paid") },
                { value: "all", label: "All", count: count("all") },
              ]}
            />
            <DataTable
              label="Prizes"
              rows={rows}
              columns={columns}
              rowKey={(a) => a.id}
              onRowClick={(a) => setOpenId(a.id)}
              selectedKey={openId}
              initialSort={{ key: "due", dir: "asc" }}
              empty={<EmptyState title="No winners here yet">Enter a winner and Eve links them to their tax profile, checks the form, and prepares the payout.</EmptyState>}
            />
            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected ? `${selected.track}: ${selected.title}` : "Prize"} description={selected?.personName}>
              {selected ? <AwardDetail award={selected} snapshot={s} onEvidence={() => setEvidence(selected)} /> : null}
            </Sheet>
            <Sheet open={entryOpen} onOpenChange={setEntryOpen} title="Enter a winner" description="Eve flags tax, shipping, and withholding before anyone is promised money">
              <WinnerForm snapshot={s} onCreated={(id) => { setEntryOpen(false); if (id) setOpenId(id); }} />
            </Sheet>
            <EvidenceSheet open={evidence !== null} onOpenChange={(o) => !o && setEvidence(null)} title={evidence ? `${evidence.title} · ${evidence.personName}` : "Evidence"} objectIds={evidence ? [evidence.id, ...s.payouts.filter((p) => p.sourceId === evidence.id).map((p) => p.id)] : []} />
          </>
        );
      }}
    </PageFrame>
  );
}

export function AwardDetail({ award: a, snapshot: s, onEvidence }: { award: Award; snapshot: AppSnapshot; onEvidence: () => void }) {
  const person = s.people.find((p) => p.id === a.personId);
  const payout = s.payouts.find((p) => p.sourceType === "award" && p.sourceId === a.id);
  const manage = canManage(s.actor);
  const o = prizeOptions(s, a, person, payout);
  const team = a.teamId ? s.awards.filter((x) => x.teamId === a.teamId) : [];
  const canPropose = !payout && a.status === "ready" && !(a.teamId && !a.splitConfirmed) && (a.kind === "cash" || a.fulfillment !== "undecided");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={a.status} />
        <DueChip due={a.dueAt} now={s.now} context="ceremony" />
      </div>
      {a.recommendation ? <p className="text-small">{a.recommendation}</p> : null}
      <PrizeComparison snapshot={s} award={a} person={person} payout={payout} />

      {a.kind === "item" && !payout ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Choose fulfilment</h3>
          <div className="flex flex-wrap gap-2">
            {(["cash", "local", "ship"] as const).map((f) => (
              <ActionButton
                key={f}
                label={f === o.recommended && a.fulfillment === "undecided" ? `${FULFILLMENT_LABEL[f]} (recommended)` : FULFILLMENT_LABEL[f]}
                variant={a.fulfillment === f ? "secondary" : "ghost"}
                pendingLabel="Saving"
                permission={manage}
                quietSuccess
                call={payloads.awardChoose(a.id, f)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {team.length > 1 ? <TeamSplit award={a} team={team} snapshot={s} /> : null}

      <div className="flex flex-col gap-2 border-t pt-4">
        {payout ? (
          <p className="text-small text-muted-foreground">
            Payout {payout.id} is {payout.status}. {payout.status === "proposed" ? "A controller releases it from Payouts." : payout.reason}
          </p>
        ) : a.status === "needs_form" ? (
          <ActionButton wide size="default" label="Propose payout" permission={{ allowed: false, reason: `Held until ${a.personName.split(" ")[0]} signs the ${person?.taxForm ?? "tax form"}. Eve is chasing on schedule.` }} call={() => null} />
        ) : canPropose ? (
          <ActionButton wide size="default" variant="default" label="Propose payout" pendingLabel="Proposing" permission={manage} call={payloads.payoutPropose(a.id, "award")} />
        ) : null}
        <Button size="sm" variant="ghost" className="self-start" onClick={onEvidence}>
          View evidence
        </Button>
      </div>
    </div>
  );
}

function TeamSplit({ award, team, snapshot }: { award: Award; team: Award[]; snapshot: AppSnapshot }) {
  const even = Math.floor(10000 / team.length);
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(team.map((t, i) => [t.personId, ((i === 0 ? 10000 - even * (team.length - 1) : even) / 100).toString()])),
  );
  const total = Object.values(shares).reduce((sum, v) => sum + Math.round(Number(v || 0) * 100), 0);
  const manage = canManage(snapshot.actor);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Team split</h3>
        <span className="text-caption text-muted-foreground">
          {team.every((t) => t.splitConfirmed) ? "Confirmed by every member" : `${team.filter((t) => t.splitConfirmed).length} of ${team.length} confirmed`}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {team.map((t) => (
          <li key={t.personId} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2">
            <label htmlFor={`share-${t.personId}`} className="truncate text-small">
              {t.personName}
            </label>
            <Input
              id={`share-${t.personId}`}
              inputMode="decimal"
              value={shares[t.personId] ?? ""}
              onChange={(e) => setShares((x) => ({ ...x, [t.personId]: e.target.value }))}
              className="text-right"
              aria-describedby={`share-total-${award.id}`}
            />
            <StatusBadge status={t.splitConfirmed ? "done" : "waiting"} label={t.splitConfirmed ? "Confirmed" : "Waiting"} />
          </li>
        ))}
      </ul>
      <p id={`share-total-${award.id}`} className={total === 10000 ? "text-small text-muted-foreground" : "text-small text-critical"}>
        {total === 10000 ? "Shares total 100%. Changing the split asks every member to confirm again." : `Shares total ${(total / 100).toFixed(2)}%. They must total 100%.`}
      </p>
      <ActionButton
        label="Save split"
        pendingLabel="Saving"
        permission={manage}
        call={() =>
          total === 10000
            ? payloads.awardSplit(award.id, team.map((t) => ({ personId: t.personId, bps: Math.round(Number(shares[t.personId] || 0) * 100) })))
            : null
        }
      />
    </section>
  );
}

function WinnerForm({ snapshot: s, onCreated }: { snapshot: AppSnapshot; onCreated: (id: string | null) => void }) {
  const { act } = useEve();
  const [personId, setPersonId] = useState("");
  const [track, setTrack] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Award["kind"]>("item");
  const [amount, setAmount] = useState("");
  const [teamId, setTeamId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const person = s.people.find((p) => p.id === personId);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const minor = toMinor(amount);
        const next: Record<string, string> = {};
        if (!personId) next.person = "Choose the winner.";
        if (!track.trim()) next.track = "Name the track, like First Overall.";
        if (!title.trim()) next.title = kind === "item" ? "Name the item, like MacBook Air." : "Name the prize.";
        if (!minor || minor === "0") next.amount = kind === "item" ? "Enter the item's fair market value in USD." : "Enter the cash amount in USD.";
        setErrors(next);
        if (Object.keys(next).length) return;
        setPending(true);
        const r = await act(payloads.awardCreate({ personId, track: track.trim(), title: title.trim(), kind, amountMinor: minor!, currency: "USD", teamId: teamId.trim() || undefined }));
        setPending(false);
        setResult(r);
        if (r.ok) onCreated(typeof r.data?.id === "string" ? r.data.id : null);
      }}
    >
      <Field label="Winner" error={errors.person} help={person ? `${person.country} resident · ${person.taxForm} ${person.taxStatus}` : "Winners are linked to their tax profile."}>
        {(p) => (
          <NativeSelect {...p} value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Choose a person</option>
            {s.people.filter((x) => x.adult).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.country}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Track" error={errors.track}>
          {(p) => <Input {...p} value={track} onChange={(e) => setTrack(e.target.value)} placeholder="First Overall" />}
        </Field>
        <Field label="Prize" error={errors.title}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="MacBook Air" />}
        </Field>
        <Field label="Kind">
          {(p) => (
            <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value as Award["kind"])}>
              <option value="item">Physical item</option>
              <option value="cash">Cash</option>
            </NativeSelect>
          )}
        </Field>
        <Field label={kind === "item" ? "Fair market value (USD)" : "Amount (USD)"} error={errors.amount}>
          {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,299.00" />}
        </Field>
      </div>
      <Field label="Team (optional)" help="Winners sharing a team split evenly unless the team agrees otherwise.">
        {(p) => <Input {...p} value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="team-aurora" />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" aria-busy={pending || undefined} disabled={pending}>
          {pending ? "Saving winner" : "Save winner"}
        </Button>
        <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
      </div>
    </form>
  );
}
