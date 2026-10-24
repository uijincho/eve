"use client";

import { CircleCheckIcon, CircleXIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton, ResultText } from "@/components/app/action-button";
import { AgentFeed } from "@/components/app/agent-feed";
import { ClaimForm, ClaimOutcome } from "@/components/app/claim-form";
import { Field, NativeSelect } from "@/components/app/field";
import { PageFrame } from "@/components/app/page-frame";
import { Section } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { PrizeComparison } from "@/components/app/prize-comparison";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult, AppSnapshot } from "@/lib/contracts";
import { canManage } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";
import { payloads, toMinor } from "@/lib/client/payloads";
import { useEve } from "@/lib/client/use-eve";

export function AgentView() {
  return (
    <PageFrame
      title="Agent"
      lede={(s) => `Every workflow run Eve is doing or has done, one entry per receipt, winner, or payout. Eve works inside ${s.org.name}'s policy limits and cannot release money.`}
      actions={(s) =>
        s.demo ? (
          <ActionButton
            size="default"
            variant="default"
            label="Run the answer key"
            pendingLabel="Starting"
            permission={canManage(s.actor)}
            call={payloads.demoRun()}
          />
        ) : (
          <ActionButton
            size="default"
            variant="default"
            label="Run Eve"
            pendingLabel="Starting"
            permission={canManage(s.actor)}
            call={payloads.agentRun("all")}
          />
        )
      }
    >
      {(s) => (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-10">
            {s.demo ? <Scoreboard snapshot={s} /> : null}
            <Section title="Activity" aside="Refreshes every 2 seconds">
              <AgentFeed variant="page" />
            </Section>
          </div>
          <div className="flex flex-col gap-10">
            <TryReceipt snapshot={s} />
            {s.demo ? <TryWinner snapshot={s} /> : null}
          </div>
        </div>
      )}
    </PageFrame>
  );
}

function Scoreboard({ snapshot: s }: { snapshot: AppSnapshot }) {
  const b = s.scoreboard;
  return (
    <Section title="Scoreboard" aside={b.lastRunAt ? `Last evaluated run ${fmtDateTime(b.lastRunAt)}` : "No evaluated run yet"}>
      <p className="max-w-[64ch] text-small text-muted-foreground">
        Compares Eve&rsquo;s saved decisions on the sample event with its answer key of planted errors. The numbers are measured from those decisions, not a target; running the answer key re-evaluates them.
      </p>
      <dl className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Caught" value={b.evaluated ? `${b.caught} of ${b.total}` : `— of ${b.total}`} />
        <Stat label="Missed" value={b.evaluated ? String(b.missed) : "—"} />
        <Stat label="False positives" value={b.evaluated ? String(b.falsePositives) : "—"} />
        <Stat label="Wrongful payouts" value={b.evaluated ? String(b.wrongfulPayouts) : "—"} critical={b.wrongfulPayouts > 0} />
      </dl>
      {b.results.length ? (
        <details className="group rounded-xl border">
          <summary className="cursor-pointer list-none px-4 py-3 text-small font-medium hover:bg-surface">
            {b.results.length} scenarios · {b.results.filter((r) => !r.passed).length} not passed
          </summary>
          <ul className="flex flex-col divide-y border-t">
            {b.results.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 px-4 py-2.5 text-small">
                {r.passed ? <CircleCheckIcon aria-label="Passed" className="mt-px size-4 text-positive" /> : <CircleXIcon aria-label="Not passed" className="mt-px size-4 text-critical" />}
                <span className="flex flex-col">
                  <span className="font-medium">{r.scenario}</span>
                  <span className="text-muted-foreground">Expected {r.expected}. Eve: {r.actual}.</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <EmptyState title="No evaluated run yet">Run the answer key and Eve processes the sample event, then this compares its decisions to the planted errors.</EmptyState>
      )}
    </Section>
  );
}

function Stat({ label, value, critical }: { label: string; value: string; critical?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-2">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={critical ? "text-heading text-critical tabular-nums" : "text-heading tabular-nums"}>{value}</dd>
    </div>
  );
}

function TryReceipt({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [claimId, setClaimId] = useState<string | null>(null);
  const forOthers = s.actor.role !== "attendee";
  return (
    <Section title={s.demo ? "Try your own receipt" : "Run Eve on a receipt"}>
      <p className="text-small text-muted-foreground">
        Upload a receipt photo or PDF. Eve reads it, runs the policy checks, and records the result as a claim{s.demo ? " in the sample event" : ""}.
      </p>
      {canManage(s.actor).allowed || s.actor.role === "attendee" ? (
        <>
          <ClaimForm people={forOthers ? s.people : undefined} defaultType="expense" submitLabel="Run Eve on this receipt" submitVariant="secondary" onSubmitted={setClaimId} />
          {claimId ? <ClaimOutcome claimId={claimId} /> : null}
        </>
      ) : (
        <p className="text-small text-muted-foreground">Auditors have read-only access, so this is disabled for your persona.</p>
      )}
    </Section>
  );
}

const COUNTRIES = [
  ["CA", "Canada"], ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"], ["IN", "India"],
  ["MX", "Mexico"], ["BR", "Brazil"], ["JP", "Japan"], ["NG", "Nigeria"], ["AU", "Australia"],
] as const;

function TryWinner({ snapshot: s }: { snapshot: AppSnapshot }) {
  const { act } = useEve();
  const [country, setCountry] = useState("CA");
  const [kind, setKind] = useState<"item" | "cash">("item");
  const [title, setTitle] = useState("MacBook Air");
  const [amount, setAmount] = useState("1299");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const manage = canManage(s.actor);
  const person = email ? s.people.find((p) => p.email === email) : undefined;
  const award = person ? s.awards.find((a) => a.personId === person.id) : undefined;

  return (
    <Section title="Try your own winner">
      <p className="text-small text-muted-foreground">
        Describe a winner and prize. Eve adds a synthetic winner to the sample event, picks the tax form, applies the versioned rule, and compares shipping, buying locally, and cash.
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const minor = toMinor(amount);
          if (!minor || minor === "0") return setError("Enter a value in USD, like 1299.");
          setError(null);
          setResult(null);
          const tag = Date.now().toString(36);
          const newEmail = `try-${tag}@winners.example`;
          const name = `Sample Winner ${tag.slice(-4).toUpperCase()}`;
          setPending("Adding winner");
          const added = await act(
            payloads.peopleImport([{ name, email: newEmail, country, citizenship: country, dateOfBirth: "1998-05-01", role: "Hacker" }]),
          );
          if (!added.ok) {
            setPending(null);
            return setResult(added);
          }
          setEmail(newEmail);
          const snap = (added.data?.snapshot as AppSnapshot | undefined) ?? s;
          const created = snap.people.find((p) => p.email === newEmail);
          const personId = created?.id ?? (typeof added.data?.personId === "string" ? added.data.personId : undefined);
          if (!personId) {
            setPending(null);
            return setResult({ ok: false, message: "The winner was added, but Eve could not find them yet. Refresh and enter the prize on Prizes." });
          }
          setPending("Eve is deciding");
          const r = await act(payloads.awardCreate({ personId, track: "Try your own", title: title.trim() || "Prize", kind, amountMinor: minor, currency: "USD" }));
          setPending(null);
          setResult(r);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Winner's residency">
            {(p) => (
              <NativeSelect {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Prize kind">
            {(p) => (
              <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value as "item" | "cash")}>
                <option value="item">Physical item</option>
                <option value="cash">Cash</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="Prize">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Value (USD)" error={error}>
            {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} />}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {manage.allowed ? (
            <Button type="submit" variant="secondary" aria-busy={pending ? true : undefined} disabled={pending !== null}>
              <PlayIcon aria-hidden />
              {pending ?? "Ask Eve"}
            </Button>
          ) : (
            <ActionButton label="Ask Eve" permission={manage} call={() => null} />
          )}
          <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
        </div>
      </form>
      {award && person ? (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-small">
            <span className="font-semibold">{person.name}</span>
            <span className="text-muted-foreground"> · {person.country} · Eve asks for a {person.taxForm}</span>
          </p>
          {award.recommendation ? <p className="text-small">{award.recommendation}</p> : null}
          <PrizeComparison snapshot={s} award={award} person={person} />
        </div>
      ) : null}
    </Section>
  );
}

