"use client";

import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LinkButton } from "@/components/app/link-button";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import type { AppSnapshot, Award, Decision, Payout } from "@/lib/contracts";
import { awardName, big, booksCurrency, budgetTotals, buildInbox, controllerName, sumMinor } from "@/lib/client/derive";
import { ROLE_LABEL, fmtDate, fmtDateTime, fmtTime, initials } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

type Phase = "before" | "during" | "after";
type Tone = "positive" | "pending" | "critical" | "neutral";
type Stage = "ready" | "forms" | "split" | "frozen" | "paid" | "draft";

const PHASES: { id: Phase; label: string; focus: string }[] = [
  { id: "before", label: "Before", focus: "Before the event: tax forms, adult checks and flight bookings come first." },
  { id: "during", label: "During", focus: "During the event: get winners payable before the closing ceremony. Nothing releases without the controller." },
  { id: "after", label: "After", focus: "After the event: claims, sponsor remittances, the period lock and filing drafts." },
];

const STAGES: { id: Stage; label: string; tone: Tone }[] = [
  { id: "ready", label: "Ready to release", tone: "positive" },
  { id: "forms", label: "Tax form or hold", tone: "pending" },
  { id: "split", label: "Team split pending", tone: "neutral" },
  { id: "frozen", label: "Bank change frozen", tone: "critical" },
  { id: "paid", label: "Paid", tone: "neutral" },
];

const PILL: Record<Tone, string> = {
  positive: "bg-money/25 text-positive",
  pending: "bg-pending/25 text-dusk-5",
  critical: "bg-critical/10 text-critical",
  neutral: "bg-surface-hover text-muted-foreground",
};

const RING: Record<Tone, string> = {
  positive: "ring-money",
  pending: "ring-pending",
  critical: "ring-critical",
  neutral: "ring-border",
};

/** The organizer's dashboard: where the event's money stands and what blocks the next release. */
export function OverviewView() {
  const { snapshot, error, loading, refresh } = useEve();
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      {snapshot ? (
        <Overview s={snapshot} />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : loading ? (
        <ListSkeleton />
      ) : null}
    </main>
  );
}

function phaseAt(s: AppSnapshot): Phase {
  const now = new Date(s.now).getTime();
  if (now < new Date(s.event.startsAt).getTime()) return "before";
  return now <= new Date(s.event.endsAt).getTime() ? "during" : "after";
}

function stageOf(a: Award, p?: Payout): Stage {
  if (a.status === "paid" || p?.status === "paid") return "paid";
  if (p?.status === "frozen") return "frozen";
  if (a.teamId && !a.splitConfirmed) return "split";
  if (a.status === "needs_form" || p?.status === "held" || p?.status === "failed" || p?.status === "returned") return "forms";
  if (p && ["proposed", "approved", "processing"].includes(p.status)) return "ready";
  return "draft";
}

function Overview({ s }: { s: AppSnapshot }) {
  const currency = booksCurrency(s);
  const [phase, setPhase] = useState<Phase>(() => phaseAt(s));
  const [stage, setStage] = useState<Stage>("ready");
  const [line, setLine] = useState(0);
  const [findingOpen, setFindingOpen] = useState(true);

  const totals = budgetTotals(s);
  const remaining = totals.cap - totals.spent - totals.committed;

  const sumGross = (ps: Payout[]) => sumMinor(ps.map((p) => p.grossMinor));
  const paid = s.payouts.filter((p) => p.status === "paid");
  const releasable = s.payouts.filter((p) => p.status === "proposed" || p.status === "approved");
  const blocked = s.payouts.filter((p) => ["held", "frozen", "failed", "returned"].includes(p.status));
  const frozen = blocked.filter((p) => p.status === "frozen");

  const prizes = useMemo(() => {
    const byAward = new Map(s.payouts.filter((p) => p.sourceType === "award").map((p) => [p.sourceId, p]));
    return s.awards.map((a) => {
      const p = byAward.get(a.id);
      return { award: a, payout: p, stage: stageOf(a, p) };
    });
  }, [s.awards, s.payouts]);
  const inStage = (id: Stage) => prizes.filter((x) => x.stage === id);
  const prizeAmount = (xs: typeof prizes) =>
    sumMinor(xs.map((x) => (x.payout ? x.payout.grossMinor : x.award.currency === currency ? x.award.amountMinor : "0")));
  const payable = inStage("ready").length + inStage("paid").length;
  const readiness = prizes.length ? Math.round((payable / prizes.length) * 100) : 0;
  const waiting = prizes.filter((x) => x.stage === "forms" || x.stage === "frozen" || x.stage === "split");

  const claimsForPerson = s.claims.filter((c) => c.status === "escalated" || c.status === "needs_info");
  const inbox = buildInbox(s);

  const travel = s.budgets.find((b) => /travel/i.test(b.name));
  const sources = groupBy(s.budgets, (b) => b.fundingSource || "Unassigned").map(([name, lines]) => ({
    name,
    cap: sumMinor(lines.map((b) => b.capMinor)),
    used: sumMinor(lines.flatMap((b) => [b.spentMinor, b.committedMinor])),
    lines: lines.map((b) => b.name),
  }));
  const packets = s.packets;
  const recent = [...s.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7);

  const max = s.budgets.reduce((m, b) => (big(b.capMinor) > m ? big(b.capMinor) : m), 1n);
  const pct = (part: bigint, whole: bigint) => (whole > 0n ? Math.min(100, Number((part * 10000n) / whole) / 100) : 0);
  const selected = s.budgets[line];

  return (
    <>
      {/* Title row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title">Overview</h1>
          </div>
          <p className="max-w-[72ch] text-small text-muted-foreground">
            {s.event.name} · {s.event.venue}
          </p>
        </div>
        <div role="group" aria-label="Event phase" className="flex gap-0.5 rounded-xl bg-surface-hover p-1">
          {PHASES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={phase === p.id}
              title={p.focus}
              onClick={() => setPhase(p.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-small transition-colors duration-150",
                phase === p.id ? "bg-surface font-semibold text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* The two columns stretch to one height so neither leaves a hole; the
          cards below run full width. */}
      <div className="flex flex-wrap gap-4">
        {/* Left column */}
        <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            {/* Budget hero */}
            <Card className="flex flex-[2_1_440px] flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Money amountMinor={remaining} currency={currency} className="text-display" />
                  <p className="text-caption text-muted-foreground">Budget left after spent and committed, of <Money amountMinor={totals.cap} currency={currency} /></p>
                </div>
                <Legend
                  items={[
                    { label: "Spent", swatch: "bg-foreground" },
                    { label: "Committed", swatch: "hatch-pending" },
                    { label: "Cap", swatch: "bg-surface-hover" },
                  ]}
                />
              </div>
              {s.budgets.length ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${s.budgets.length}, minmax(0, 1fr))` }}>
                  {s.budgets.map((b, i) => {
                    const cap = big(b.capMinor);
                    const spent = big(b.spentMinor);
                    const committed = big(b.committedMinor);
                    const on = i === line;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLine(i)}
                        className={cn("flex flex-col items-stretch gap-2 rounded-xl p-1.5 text-left transition-colors duration-150", on ? "bg-background" : "hover:bg-background/60")}
                      >
                        <span className="flex h-48 items-end justify-center">
                          <span
                            className="relative flex w-full max-w-14 flex-col justify-end overflow-hidden rounded-lg bg-surface-hover"
                            style={{ height: `${Math.max(pct(cap, max), 4)}%` }}
                          >
                            <span className="hatch-pending" style={{ height: `${pct(committed, cap)}%` }} />
                            <span className="bg-foreground" style={{ height: `${pct(spent, cap)}%` }} />
                          </span>
                        </span>
                        <span className={cn("truncate text-center text-caption", on ? "font-semibold text-foreground" : "text-muted-foreground")}>{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-small text-muted-foreground">No budget lines yet. Add them in Budget.</p>
              )}
              {selected ? (
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t pt-3 text-caption text-muted-foreground">
                  <span className="text-small font-semibold text-foreground">{selected.name}</span>
                  <span>Spent <Money amountMinor={big(selected.spentMinor)} currency={currency} className="font-semibold text-foreground" /></span>
                  <span>Committed <Money amountMinor={big(selected.committedMinor)} currency={currency} className="font-semibold text-foreground" /></span>
                  <span>Cap <Money amountMinor={big(selected.capMinor)} currency={currency} className="font-semibold text-foreground" /></span>
                  <span>{selected.fundingSource}</span>
                </div>
              ) : null}
            </Card>

            {/* KPI stack */}
            <Card className="flex flex-[1_1_220px] flex-col justify-between gap-5">
              <Stat label="Paid out" amount={sumGross(paid)} currency={currency} note={`${paid.length} payouts released and settled`} />
              <Stat label="Awaiting release" amount={sumGross(releasable)} currency={currency} note={`${releasable.length} proposals for ${controllerName(s)}`} />
              <Stat
                label="Blocked from release"
                amount={sumGross(blocked)}
                currency={currency}
                note={`${blocked.length - frozen.length} held · ${frozen.length} frozen`}
                tone={blocked.length ? "critical" : undefined}
              />
            </Card>
          </div>

          {/* Prize pipeline */}
          <Card className="flex flex-1 flex-col gap-4">
            <CardHead
              title="Prize pipeline"
              sub={`${prizes.length} prizes and stipends · `}
              subMoney={prizeAmount(prizes)}
              currency={currency}
              href="/prizes"
              link="Open Prizes"
            />
            <div role="tablist" aria-label="Pipeline stage" className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
              {STAGES.map((st) => {
                const xs = inStage(st.id);
                const on = stage === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setStage(st.id)}
                    className={cn(
                      "flex flex-col gap-1 rounded-xl p-3 text-left transition-colors duration-150",
                      on ? "bg-background ring-[1.5px] ring-foreground" : "ring-1 ring-border hover:bg-background",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-heading tabular-nums">{xs.length}</span>
                      <Pill tone={st.tone}>
                        <Money amountMinor={prizeAmount(xs)} currency={currency} />
                      </Pill>
                    </span>
                    <span className="text-small text-muted-foreground">{st.label}</span>
                  </button>
                );
              })}
            </div>
            <ul role="tabpanel" aria-label={STAGES.find((x) => x.id === stage)?.label} className="flex flex-col">
              {inStage(stage).length ? (
                inStage(stage).slice(0, 8).map(({ award, payout }) => (
                  <li key={award.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t py-2.5">
                    <Avatar name={award.personName} />
                    <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
                      <span className="truncate font-medium">{award.personName}</span>
                      <span className="truncate text-caption text-muted-foreground">{awardName(award, " · ")}</span>
                    </span>
                    <Pill tone={STAGES.find((x) => x.id === stage)?.tone ?? "neutral"} className="max-w-64 truncate">
                      {stageNote(award, payout, stage)}
                    </Pill>
                    <Money
                      amountMinor={big(payout ? payout.grossMinor : award.amountMinor)}
                      currency={payout ? payout.currency : award.currency}
                      className="w-24 text-right font-semibold"
                    />
                  </li>
                ))
              ) : (
                <li className="border-t py-4 text-small text-muted-foreground">Nothing in this stage.</li>
              )}
              {inStage(stage).length > 8 ? (
                <li className="border-t pt-2.5 text-small text-muted-foreground">
                  {inStage(stage).length - 8} more in{" "}
                  <Link href="/prizes" className="font-medium text-foreground underline">
                    Prizes
                  </Link>
                </li>
              ) : null}
            </ul>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 xl:max-w-sm">
          <Card className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-subheading">Release console</h2>
                <p className="text-caption text-muted-foreground">Controller: {controllerName(s)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-money p-4 text-on-money">
              <div className="flex justify-between gap-2 text-caption font-semibold">
                <span>Proposed for release</span>
                <span>{ROLE_LABEL[s.actor.role]} view</span>
              </div>
              <div>
                <Money amountMinor={sumGross(releasable)} currency={currency} className="text-title" />
                <p className="text-small">
                  {releasable.length} {releasable.length === 1 ? "payout" : "payouts"} waiting for a controller release
                </p>
              </div>
              <div className="flex justify-between gap-2 text-caption">
                <span>{releasable.filter((p) => !p.ruleVerified).length} use an unverified rule</span>
                <span>Closing {fmtTime(s.event.closingAt)}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { href: "/payouts", label: "Release", glyph: "✓" },
                { href: "/inbox", label: "Inbox", glyph: String(inbox.length) },
                { href: "/sponsor", label: "Packets", glyph: "↗" },
                { href: "/audit", label: "Ledger", glyph: "≡" },
              ].map((a) => (
                <Link key={a.label} href={a.href} className="group flex flex-col items-center gap-1.5 text-caption">
                  <span className="grid size-12 place-items-center rounded-xl border bg-background text-subheading tabular-nums transition-colors duration-150 group-hover:bg-surface-hover">
                    {a.glyph}
                  </span>
                  {a.label}
                </Link>
              ))}
            </div>
            {waiting.length ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-small font-semibold">Waiting on a winner</span>
                  <span className="text-caption text-muted-foreground">Ring shows the blocker</span>
                </div>
                <ul className="flex flex-wrap gap-2.5">
                  {waiting.slice(0, 5).map(({ award, stage: st }) => (
                    <li key={award.id} className="flex w-14 flex-col items-center gap-1 text-center">
                      <Avatar name={award.personName} ring={STAGES.find((x) => x.id === st)?.tone ?? "neutral"} />
                      <span className="w-full truncate text-caption">{award.personName.split(" ")[0]}</span>
                    </li>
                  ))}
                  {waiting.length > 5 ? (
                    <li className="flex w-14 flex-col items-center gap-1 text-center">
                      <span className="grid size-10 place-items-center rounded-full bg-surface-hover text-caption font-semibold">+{waiting.length - 5}</span>
                      <span className="text-caption text-muted-foreground">more</span>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card className="flex flex-1 flex-col gap-1">
            <CardHead title="Recent activity" href="/audit" link="Audit trail" />
            {recent.length ? (
              <ul className="mt-2 flex flex-col">
                {recent.map((d) => (
                  <li key={d.id} className="flex items-center gap-2.5 border-t py-2">
                    <Avatar name={d.personName || d.actor} square />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-small font-medium">{d.summary}</span>
                      <span className="truncate text-caption text-muted-foreground">
                        {d.personName ? `${d.personName} · ` : ""}
                        {fmtDateTime(d.createdAt)}
                      </span>
                    </span>
                    <Pill tone={DECISION_TONE[d.status]}>{DECISION_LABEL[d.status]}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-small text-muted-foreground">No decisions recorded yet.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {/* Travel */}
        <Card className="flex flex-[1_1_300px] flex-col gap-3">
          <CardHead
            title="Travel budget"
            sub={`${s.event.economyOnly ? "Economy only · " : ""}cap `}
            subMoney={big(s.event.travelCapMinor)}
            currency={s.org.currency}
            subAfter=" per traveler"
          />
          {travel ? (
            <>
              <div className="flex h-6 overflow-hidden rounded-lg bg-surface-hover">
                <span className="bg-money" style={{ width: `${pct(big(travel.spentMinor), big(travel.capMinor))}%` }} />
                <span className="hatch-money" style={{ width: `${pct(big(travel.committedMinor), big(travel.capMinor))}%` }} />
              </div>
              <div className="flex justify-between gap-2 text-small">
                <span>
                  <Money amountMinor={big(travel.spentMinor)} currency={currency} className="font-semibold" />{" "}
                  <span className="text-muted-foreground">
                    spent + <Money amountMinor={big(travel.committedMinor)} currency={currency} /> committed
                  </span>
                </span>
                <Money amountMinor={big(travel.capMinor)} currency={currency} className="text-muted-foreground" />
              </div>
            </>
          ) : (
            <p className="text-small text-muted-foreground">No travel line in this event&apos;s budget.</p>
          )}
          <p className="text-caption text-muted-foreground">Booking deadline {fmtDate(s.event.bookingDeadline)}.</p>
        </Card>

        {/* Needs a person */}
        <Card className="flex flex-[1_1_300px] flex-col gap-2.5 bg-background">
          {findingOpen && claimsForPerson.length ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Pill tone="neutral">Agent finding</Pill>
                <span className="text-caption text-muted-foreground">{inbox.length} items in the inbox</span>
              </div>
              <h2 className="text-subheading">
                {claimsForPerson.length} {claimsForPerson.length === 1 ? "claim needs" : "claims need"} a person before anything is paid
              </h2>
              <p className="text-small text-muted-foreground">
                {claimsForPerson[0].personName}: {claimsForPerson[0].reason || claimsForPerson[0].description}
                {claimsForPerson.length > 1 ? ` And ${claimsForPerson.length - 1} more.` : ""} Eve escalated these; it has not approved or rejected them.
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <LinkButton href="/claims">Review claims</LinkButton>
                <Button variant="outline" onClick={() => setFindingOpen(false)}>
                  Dismiss
                </Button>
              </div>
            </>
          ) : (
            <>
              <Pill tone="positive" className="self-start">Nothing open</Pill>
              <h2 className="text-subheading">No escalated claims waiting here</h2>
              {claimsForPerson.length ? (
                <Button variant="outline" className="self-start" onClick={() => setFindingOpen(true)}>
                  Show the finding again
                </Button>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap gap-4">
        {/* Budget lines */}
        <Card className="flex flex-[1_1_18rem] flex-col gap-4">
          <CardHead title="Budget by line" sub="Spent and committed against each cap" />
          <Money amountMinor={totals.spent + totals.committed} currency={currency} className="text-title" />
          <ul className="flex flex-col gap-3">
            {s.budgets.map((b, i) => {
              const used = big(b.spentMinor) + big(b.committedMinor);
              return (
                <li key={b.id} className="flex flex-col gap-1.5">
                  <span className="flex justify-between gap-2 text-small">
                    <span className="truncate">{b.name}</span>
                    <span className="whitespace-nowrap">
                      <Money amountMinor={used} currency={currency} className="font-semibold" />{" "}
                      <span className="text-muted-foreground">
                        / <Money amountMinor={big(b.capMinor)} currency={currency} />
                      </span>
                    </span>
                  </span>
                  <span className="flex h-2 overflow-hidden rounded-full bg-surface-hover">
                    <span
                      className={cn(used > big(b.capMinor) ? "bg-critical" : ["bg-money", "bg-foreground", "bg-pending", "bg-chart-4"][i % 4])}
                      style={{ width: `${pct(used, big(b.capMinor))}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Readiness */}
        <Card className="flex flex-[1_1_18rem] flex-col gap-2">
          <CardHead title="Payout readiness" sub="Prizes proposed or already paid" />
          <Gauge value={readiness} />
          <p className="text-center text-caption text-muted-foreground">
            {payable} of {prizes.length} prizes can be paid
          </p>
          <ul className="mt-1 flex flex-col gap-1.5 text-small">
            {STAGES.filter((x) => x.id === "forms" || x.id === "split" || x.id === "frozen").map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2">
                <span>{x.label}</span>
                <Pill tone={x.tone}>{inStage(x.id).length}</Pill>
              </li>
            ))}
          </ul>
        </Card>

        {/* Funding */}
        <Card className="flex flex-[1_1_18rem] flex-col gap-4">
          <CardHead title="Funding sources" sub="Used against what each source covers" />
          <ul className="flex flex-col gap-3.5">
            {sources.map((f) => (
              <li key={f.name} className="flex flex-col gap-1.5">
                <span className="flex justify-between gap-2 text-small">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="whitespace-nowrap">
                    <Money amountMinor={f.used} currency={currency} className="font-semibold" />{" "}
                    <span className="text-muted-foreground">
                      / <Money amountMinor={f.cap} currency={currency} />
                    </span>
                  </span>
                </span>
                <span className="flex h-2 overflow-hidden rounded-full bg-surface-hover">
                  <span className="bg-money" style={{ width: `${pct(f.used, f.cap)}%` }} />
                </span>
                <span className="text-caption text-muted-foreground">{f.lines.join(", ")}</span>
              </li>
            ))}
          </ul>
          {packets
            .filter((p) => p.status === "exception" || p.status === "questioned")
            .slice(0, 2)
            .map((p) => (
              <Link key={p.id} href="/sponsor" className="flex flex-col gap-0.5 rounded-xl bg-pending/15 px-3 py-2.5 ring-1 ring-pending/40 hover:bg-pending/25">
                <span className="text-small font-semibold text-dusk-5">
                  Remittance <Money amountMinor={big(p.requestedMinor) - big(p.paidMinor)} currency={currency} /> short
                </span>
                <span className="text-caption text-foreground">
                  {s.org.sponsorName || "The sponsor"} paid <Money amountMinor={big(p.paidMinor)} currency={currency} /> on{" "}
                  <Money amountMinor={big(p.requestedMinor)} currency={currency} /> for {p.personName}.
                </span>
              </Link>
            ))}
        </Card>
      </div>
    </>
  );
}

const DECISION_TONE: Record<Decision["status"], Tone> = {
  done: "positive",
  escalated: "pending",
  frozen: "critical",
  waiting: "neutral",
  running: "neutral",
};
const DECISION_LABEL: Record<Decision["status"], string> = {
  done: "Done",
  escalated: "Escalated",
  frozen: "Frozen",
  waiting: "Waiting",
  running: "Running",
};

function stageNote(a: Award, p: Payout | undefined, stage: Stage): string {
  if (stage === "split") return "Members must confirm the split";
  if (stage === "frozen") return p?.reason || "Verify through the original channel";
  if (stage === "forms") return p?.reason || "Tax form needed";
  if (stage === "paid") return p?.paidAt ? `Paid ${fmtDate(p.paidAt)}` : "Paid";
  if (stage === "ready") return p?.status === "approved" ? "Approved" : "Proposed";
  return a.status === "draft" ? "Draft" : "Not proposed";
}

function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()];
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("min-w-0 rounded-2xl border bg-surface p-5", className)}>{children}</section>;
}

function CardHead({
  title,
  sub,
  subMoney,
  subAfter,
  currency,
  href,
  link,
}: {
  title: string;
  sub?: string;
  subMoney?: bigint;
  subAfter?: string;
  currency?: string;
  href?: string;
  link?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-subheading">{title}</h2>
        {sub || subMoney !== undefined ? (
          <p className="text-caption text-muted-foreground">
            {sub}
            {subMoney !== undefined ? <Money amountMinor={subMoney} currency={currency} /> : null}
            {subAfter}
          </p>
        ) : null}
      </div>
      {href && link ? (
        <Link href={href} className="inline-flex items-center gap-1 text-small font-semibold hover:underline">
          {link}
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function Stat({ label, amount, currency, note, tone }: { label: string; amount: bigint; currency: string; note: string; tone?: "critical" }) {
  return (
    <div>
      <p className="text-caption text-muted-foreground">{label}</p>
      <Money amountMinor={amount} currency={currency} className={cn("text-title", tone === "critical" && amount > 0n && "text-critical")} />
      <p className="text-caption text-muted-foreground">{note}</p>
    </div>
  );
}

function Pill({ tone, className, children }: { tone: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-caption font-semibold whitespace-nowrap", PILL[tone], className)}>
      {children}
    </span>
  );
}

function Avatar({ name, ring, square }: { name: string; ring?: Tone; square?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center bg-background text-caption font-semibold text-muted-foreground ring-1 ring-border",
        square ? "rounded-lg" : "rounded-full",
        ring && cn("size-10 ring-[2.5px] ring-offset-2 ring-offset-surface", RING[ring]),
      )}
    >
      {initials(name)}
    </span>
  );
}

function Legend({ items }: { items: { label: string; swatch: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
      {items.map((x) => (
        <li key={x.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-[3px]", x.swatch)} />
          {x.label}
        </li>
      ))}
    </ul>
  );
}

function Gauge({ value }: { value: number }) {
  // A half ring: the arc is π·r long; the filled part is value% of it.
  const r = 90;
  const len = Math.PI * r;
  return (
    <div className="relative mx-auto mt-2 h-32 w-56">
      <svg viewBox="0 0 220 128" className="size-full" role="img" aria-label={`${value} percent ready`}>
        <path d="M 20 112 A 90 90 0 0 1 200 112" fill="none" stroke="var(--surface-hover)" strokeWidth="22" strokeLinecap="round" />
        {value > 0 ? (
          <path
            d="M 20 112 A 90 90 0 0 1 200 112"
            fill="none"
            stroke="var(--money)"
            strokeWidth="22"
            strokeLinecap="round"
            strokeDasharray={`${(len * value) / 100} ${len}`}
          />
        ) : null}
      </svg>
      <span className="absolute inset-x-0 bottom-1 text-center text-title tabular-nums">{value}%</span>
    </div>
  );
}
