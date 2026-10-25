"use client";

import { cn } from "cn";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ActionButton, ResultText } from "@/components/app/action-button";
import { Field } from "@/components/app/field";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { EventBasicsForm, TravelPolicyForm } from "@/components/app/settings-forms";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { CapacityBar } from "@/components/eve/capacity-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, AppSnapshot } from "@/lib/contracts";
import { big, canOrganize } from "@/lib/client/derive";
import { parsePeopleCsv, parseSubmissionList } from "@/lib/client/csv";
import { payloads, toMinor } from "@/lib/client/payloads";
import { rovingKeyDown } from "@/lib/client/roving";
import { useEve } from "@/lib/client/use-eve";

const TABS = [
  { id: "basics", label: "Basics" },
  { id: "travel", label: "Travel policy" },
  { id: "budget", label: "Budget" },
  { id: "prizes", label: "Prizes" },
  { id: "roles", label: "Roles" },
  { id: "import", label: "Attendee import" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The open tab lives in ?tab= so deep links (People → Import) and reloads land on it. */
function useTab(): [Tab, (t: Tab) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "basics";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", t);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return [tab, setTab];
}

export function EventSetupView() {
  const [tab, setTab] = useTab();
  const tabs = useRef<HTMLDivElement>(null);
  const { snapshot } = useEve();
  const loaded = Boolean(snapshot);
  useEffect(() => {
    tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [tab, loaded]);
  return (
    <PageFrame
      title="Event setup"
      lede={(s) => `${s.event.name}. Each tab saves on its own.`}
      toolbar={() => (
        <div ref={tabs} role="tablist" aria-label="Event setup" className="-mb-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => rovingKeyDown(e, TABS.map((x) => x.id), tab, setTab)}
              data-roving
              className={cn(
                "flex h-10 shrink-0 items-center border-b-2 px-2 font-medium transition-colors duration-150",
                tab === t.id ? "border-foreground text-foreground" : "border-transparent text-foreground/60 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    >
      {(s) => (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-6">
          {tab === "basics" ? <EventBasicsForm snapshot={s} /> : null}
          {tab === "travel" ? <TravelPolicyForm snapshot={s} /> : null}
          {tab === "budget" ? <BudgetTab snapshot={s} /> : null}
          {tab === "prizes" ? <PrizesTab snapshot={s} /> : null}
          {tab === "roles" ? <RolesTab snapshot={s} /> : null}
          {tab === "import" ? <ImportTab snapshot={s} /> : null}
        </div>
      )}
    </PageFrame>
  );
}

function BudgetTab({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const [source, setSource] = useState("Sponsors");
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {s.budgets.length ? (
        <ul className="flex flex-col gap-6">
          {s.budgets.map((b) => (
            <li key={b.id}>
              <CapacityBar label={`${b.name} · ${b.fundingSource}`} capMinor={Number(big(b.capMinor))} spentMinor={Number(big(b.spentMinor))} committedMinor={Number(big(b.committedMinor))} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No budget lines yet">Add travel, prizes, food, and swag lines with their funding source.</EmptyState>
      )}
      <form className="flex flex-col gap-3 border-t pt-6" noValidate onSubmit={(e) => e.preventDefault()}>
        <h2 className="text-subheading">Add a line</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={errors.name}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Swag" />}</Field>
          <Field label={`Cap (${s.org.currency})`} error={errors.cap}>{(p) => <Input {...p} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="8000" />}</Field>
          <Field label="Funding source">{(p) => <Input {...p} value={source} onChange={(e) => setSource(e.target.value)} />}</Field>
        </div>
        <ActionButton
          className="self-start"
          label="Add line"
          pendingLabel="Adding"
          permission={canOrganize(s.actor)}
          onDone={(r) => { if (r.ok) { setName(""); setCap(""); } }}
          call={() => {
            const er: Record<string, string> = {};
            const m = toMinor(cap);
            if (!name.trim()) er.name = "Name the line.";
            if (!m) er.cap = "Enter a cap like 8000.";
            setErrors(er);
            if (Object.keys(er).length || !source.trim()) return null;
            return payloads.budgetUpdate({ name: name.trim(), capMinor: m!, fundingSource: source.trim() });
          }}
        />
      </form>
    </div>
  );
}

function PrizesTab({ snapshot: s }: { snapshot: AppSnapshot }) {
  const people = new Map(s.people.map((p) => [p.id, p]));
  const warnings = s.awards.flatMap((a) => {
    const w: string[] = [];
    const p = people.get(a.personId);
    if (a.kind === "item" && big(a.amountMinor) >= 200000n) w.push(`${a.title} is worth $2,000 or more: it is reportable and needs a tax form before it ships.`);
    if (p && p.country !== s.org.country) w.push(`${a.personName} is outside ${s.org.country}: expect a ${p.taxForm} and default withholding unless a treaty claim applies.`);
    if (a.kind === "item" && p && p.country !== s.org.country) w.push(`${a.title} ships across a border: compare duty and shipping against buying locally or cash.`);
    return w.map((text) => ({ id: `${a.id}-${text.slice(0, 12)}`, text }));
  });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-small text-muted-foreground">Eve flags tax and fulfilment issues when prizes are set, not after someone wins. Judges enter winners on the Prizes page.</p>
      {warnings.length ? (
        <ul className="flex flex-col gap-2">
          {warnings.map((w) => (
            <li key={w.id} className="rounded-lg border px-3 py-2 text-small">{w.text}</li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No prize warnings">Prizes over $2,000, items that ship abroad, and non-US winners appear here with what they will need.</EmptyState>
      )}
      <LinkButton href="/prizes" variant="secondary" className="self-start">Open prizes and winners</LinkButton>
    </div>
  );
}

function RolesTab({ snapshot: s }: { snapshot: AppSnapshot }) {
  const byRole = new Map<string, typeof s.people>();
  for (const p of s.people) byRole.set(p.role, [...(byRole.get(p.role) ?? []), p]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {[...byRole.entries()].map(([role, list]) => {
        const missing = list.filter((p) => p.taxStatus !== "valid").length;
        return (
          <section key={role} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-subheading">{role}</h2>
              <span className="text-small text-muted-foreground">{list.length} people · {missing} without a valid form</span>
            </div>
            <ul className="flex flex-col divide-y rounded-xl border">
              {list.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-small">
                  <span>{p.name} · {p.country}</span>
                  <span className="flex items-center gap-2">{p.taxForm} <StatusBadge status={p.taxStatus} /></span>
                </li>
              ))}
              {list.length > 8 ? <li className="px-4 py-2 text-small text-muted-foreground">and {list.length - 8} more on the People page</li> : null}
            </ul>
          </section>
        );
      })}
      {!byRole.size ? <EmptyState title="No people yet">Import attendees, judges, and mentors; Eve works out which tax form each paid role needs.</EmptyState> : null}
    </div>
  );
}

function ImportTab({ snapshot: s }: { snapshot: AppSnapshot }) {
  const { act } = useEve();
  const [csv, setCsv] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const parsed = csv.trim() ? parsePeopleCsv(csv, s.event.startsAt) : null;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-small text-muted-foreground">
        Columns: name, email, country (two letters), dateOfBirth (YYYY-MM-DD), and optionally citizenship, address, role, payoutCurrency, project, projectUrl, submitted (yes, no, or unknown). People are matched by email. Anyone under 18 at the event start is stored but blocked from money. A project column does not clear a status already on file when the cell is empty.
      </p>
      <Field label="CSV file">
        {(p) => (
          <Input
            {...p}
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
            }}
          />
        )}
      </Field>
      <Field label="Or paste rows">
        {(p) => (
          <textarea
            {...p}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            placeholder={"name,email,country,dateOfBirth,role\nPriya Raman,priya@example.test,CA,2001-04-12,Hacker"}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-caption outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        )}
      </Field>
      {parsed ? (
        <div className="flex flex-col gap-1 text-small" aria-live="polite">
          <span>{parsed.people.length} {parsed.people.length === 1 ? "person" : "people"} ready{parsed.minors ? `, ${parsed.minors} under 18 (will be blocked from money)` : ""}.</span>
          {parsed.errors.slice(0, 5).map((e) => <span key={e} className="text-critical">{e}</span>)}
          {parsed.errors.length > 5 ? <span className="text-critical">and {parsed.errors.length - 5} more problems</span> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {canOrganize(s.actor).allowed ? (
          <Button
            disabled={!parsed || !parsed.people.length || parsed.errors.length > 0 || pending}
            aria-busy={pending || undefined}
            onClick={async () => {
              if (!parsed) return;
              setPending(true);
              const r = await act(payloads.peopleImport(parsed.people));
              setPending(false);
              setResult(r);
              if (r.ok) setCsv("");
            }}
          >
            {pending ? "Importing" : `Import ${parsed?.people.length ?? 0} people`}
          </Button>
        ) : (
          <ActionButton label="Import people" permission={canOrganize(s.actor)} call={() => null} />
        )}
        <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
      </div>
      <p className="text-small text-muted-foreground">
        {s.people.length} people in the event now.
      </p>
      <MarkSubmitted />
    </div>
  );
}

/** Paste a Devpost or judging export (emails or names) and mark those people submitted. */
function MarkSubmitted() {
  const { act, snapshot } = useEve();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  if (!snapshot) return null;
  const parsed = text.trim() ? parseSubmissionList(text) : null;
  const permission = canOrganize(snapshot.actor);
  return (
    <div className="mt-8 flex flex-col gap-4 border-t pt-6">
      <h2 className="text-subheading">Mark projects submitted</h2>
      <p className="text-small text-muted-foreground">
        Paste a Devpost or judging export. A header with email or name works, or one email or name per line. Matches are marked submitted. Ambiguous names are skipped.
      </p>
      <Field label="Export">
        {(p) => (
          <textarea
            {...p}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={"email,name,projectUrl\npriya@example.com,Priya Raman,https://devpost.com/example"}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-caption outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        )}
      </Field>
      {parsed ? (
        <div className="flex flex-col gap-1 text-small" aria-live="polite">
          <span>{parsed.entries.length} {parsed.entries.length === 1 ? "row" : "rows"} ready.</span>
          {parsed.errors.slice(0, 5).map((e) => <span key={e} className="text-critical">{e}</span>)}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {permission.allowed ? (
          <Button
            disabled={!parsed || !parsed.entries.length || parsed.errors.length > 0 || pending}
            aria-busy={pending || undefined}
            onClick={async () => {
              if (!parsed) return;
              setPending(true);
              const r = await act(payloads.peopleMarkSubmitted(parsed.entries));
              setPending(false);
              setResult(r);
              if (r.ok) setText("");
            }}
          >
            {pending ? "Marking" : `Mark ${parsed?.entries.length ?? 0} submitted`}
          </Button>
        ) : (
          <ActionButton label="Mark submitted" permission={permission} call={() => null} />
        )}
        <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
      </div>
    </div>
  );
}
