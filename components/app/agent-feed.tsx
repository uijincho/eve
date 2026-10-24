"use client";

import { cn } from "cn";
import { ChevronRightIcon, CircleCheckIcon, InboxIcon, LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Decision } from "@/lib/contracts";
import { groupRuns, objectLabel, runCounters, runHeading, runLine, type Run } from "@/lib/client/derive";
import { fmtTime } from "@/lib/client/format";
import { useEve, useLivePolling } from "@/lib/client/use-eve";

type Filter = "all" | "running" | "waiting" | "escalated" | "done";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "escalated", label: "Escalated" },
  { value: "done", label: "Done" },
];

/**
 * Eve's work as it happens: one entry per workflow run on a business object.
 * Running entries stay open and tick forward; the rest collapse to a line.
 */
export function AgentFeed({ variant = "rail", limit }: { variant?: "rail" | "page"; limit?: number }) {
  useLivePolling();
  const { snapshot } = useEve();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<Decision | null>(null);
  const runs = useMemo(() => groupRuns(snapshot?.decisions ?? []), [snapshot?.decisions]);

  if (!snapshot) return null;
  const counters = runCounters(runs, snapshot.now);
  const q = query.trim().toLowerCase();
  const shown = runs
    .filter((r) =>
      filter === "all" ? true : filter === "escalated" ? r.status === "escalated" || r.status === "frozen" : r.status === filter,
    )
    .filter((r) => !q || `${r.personName} ${r.objectId} ${r.objectType}`.toLowerCase().includes(q))
    .slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <dl className={cn("grid grid-cols-4 gap-2", variant === "page" && "max-w-xl")}>
        <Counter label="Running" value={counters.running} />
        <Counter label="Waiting" value={counters.waiting} />
        <Counter label="Done today" value={counters.doneToday} />
        <Counter label="Escalated" value={counters.escalated} />
      </dl>

      {variant === "page" ? (
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter runs" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-small font-medium transition-colors duration-150",
                  filter === f.value ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search runs by person or object</span>
            <SearchIcon aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person or object id" className="pl-8" />
          </label>
        </div>
      ) : null}

      {shown.length ? (
        <ol aria-label="Agent runs" aria-live="polite" className="flex flex-col divide-y rounded-xl border">
          {shown.map((run) => (
            <RunEntry key={run.runId} run={run} onStep={setEvidence} snapshot={snapshot} />
          ))}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-input px-4 py-5 text-small text-muted-foreground">
          {runs.length ? "No runs match this filter." : "No agent runs yet. Runs appear here as Eve reviews receipts, winners, and payouts."}
        </p>
      )}

      <EvidenceSheet
        open={evidence !== null}
        onOpenChange={(o) => !o && setEvidence(null)}
        title={evidence ? objectLabel(evidence) : "Evidence"}
        objectIds={evidence ? [evidence.objectId] : []}
        decisionId={evidence?.id}
      />
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function RunEntry({ run, onStep, snapshot }: { run: Run; onStep: (d: Decision) => void; snapshot: AppSnapshot }) {
  const live = run.status === "running";
  const [open, setOpen] = useState(live);
  const expanded = open || live;
  const last = run.steps[run.steps.length - 1];
  const heading = runHeading(run, snapshot);
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((o) => !o)}
        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("mt-0.5 size-3.5 text-muted-foreground transition-transform duration-150", expanded && "rotate-90")}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2 text-small font-medium">
            <span className="truncate">{heading.name}</span>
            {heading.amount ? <span className="ml-auto shrink-0 tabular-nums">{heading.amount}</span> : null}
          </span>
          {!expanded ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-caption text-muted-foreground" title={last.summary}>{runLine(run, snapshot)}</span>
              <span className="ml-auto shrink-0"><RunStatus run={run} /></span>
            </span>
          ) : (
            <span className="self-end"><RunStatus run={run} /></span>
          )}
        </span>
      </button>
      {expanded ? (
        <ol className="flex flex-col gap-1 px-3 pb-3 pl-8">
          {run.steps.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onStep(s)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-surface"
              >
                <StepIcon status={s.status} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-small">{s.summary}</span>
                  <span className="text-caption text-muted-foreground">
                    {fmtTime(s.createdAt)} · <span className="font-mono">{s.tool}{s.ruleId ? ` · ${s.ruleId} v${s.ruleVersion}` : ""}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function StepIcon({ status }: { status: Decision["status"] }) {
  if (status === "running")
    return <LoaderCircleIcon aria-label="In progress" className="mt-0.5 size-3.5 animate-spin text-muted-foreground" />;
  if (status === "escalated" || status === "frozen")
    return <InboxIcon aria-label="Sent to inbox" className="mt-0.5 size-3.5 text-muted-foreground" />;
  return <CircleCheckIcon aria-label="Done" className="mt-0.5 size-3.5 text-muted-foreground" />;
}

function RunStatus({ run }: { run: Run }) {
  switch (run.status) {
    case "running":
      return <Badge variant="outline">Running · step {run.steps.length}</Badge>;
    case "waiting": {
      const next = run.steps[run.steps.length - 1].nextActionAt;
      // The time alone; the status line already says what it waits for.
      return next ? (
        <Badge variant="outline" aria-label={`Waiting until ${fmtTime(next)}`}>{fmtTime(next)}</Badge>
      ) : (
        <Badge variant="outline">Waiting</Badge>
      );
    }
    case "escalated":
      return <Badge variant="outline">Escalated</Badge>;
    case "frozen":
      return <Badge variant="critical">Frozen</Badge>;
    default:
      return <Badge variant="positive">Done</Badge>;
  }
}
