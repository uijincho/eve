"use client";

import { cn } from "cn";
import { ActivityIcon, PanelRightCloseIcon, PanelRightOpenIcon, SearchIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { AgentFeed } from "@/components/app/agent-feed";
import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { Sheet } from "@/components/app/sheet";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/app/states";
import { DueChip } from "@/components/eve/due-chip";
import { Horizon } from "@/components/eve/horizon";
import { Money } from "@/components/eve/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot } from "@/lib/contracts";
import { buildInbox, groupRuns, runCounters, type InboxCategory, type InboxItem } from "@/lib/client/derive";
import { fmtTime } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

import { ItemActions } from "./item-actions";
import { ItemDetail } from "./item-detail";

type Filter = "all" | InboxCategory;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approvals", label: "Approvals" },
  { value: "holds", label: "Holds" },
  { value: "exceptions", label: "Exceptions" },
];

export function InboxView() {
  const { snapshot, error, loading, refresh } = useEve();
  if (!snapshot) {
    return (
      <main className="flex flex-col gap-4 px-4 py-5 sm:px-6">
        <h1 className="text-title">Inbox</h1>
        {error ? <ErrorState error={error} onRetry={refresh} /> : loading ? <ListSkeleton label="Loading inbox" /> : null}
      </main>
    );
  }
  return <Inbox snapshot={snapshot} />;
}

function Inbox({ snapshot }: { snapshot: AppSnapshot }) {
  const all = useMemo(() => buildInbox(snapshot), [snapshot]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<InboxItem | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [feedSheet, setFeedSheet] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const items = all
    .filter((i) => filter === "all" || i.category === filter)
    .filter((i) => !q || `${i.title} ${i.meta} ${i.detail}`.toLowerCase().includes(q));
  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  const count = (f: Filter) => (f === "all" ? all.length : all.filter((i) => i.category === f).length);
  const counters = runCounters(groupRuns(snapshot.decisions), snapshot.now);
  const mobileItem = all.find((i) => i.id === mobileDetail);

  const moveSelection = (delta: number) => {
    if (!items.length) return;
    const idx = Math.max(0, items.findIndex((i) => i.id === selected?.id));
    const next = items[Math.min(items.length - 1, Math.max(0, idx + delta))];
    setSelectedId(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <div className={cn("grid min-h-full flex-1", railOpen ? "xl:grid-cols-[minmax(0,1fr)_19rem]" : "xl:grid-cols-[minmax(0,1fr)_3rem]")}>
      <main className="flex min-w-0 flex-col">
        <header className="flex flex-col gap-5 border-b px-4 pt-5 pb-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-title">Inbox</h1>
              <p className="text-small text-muted-foreground">
                {all.length
                  ? `${all.length} ${all.length === 1 ? "item needs" : "items need"} you.`
                  : "Nothing needs you right now."}{" "}
                Eve finished {counters.doneToday} {counters.doneToday === 1 ? "run" : "runs"} today and is running {counters.running}.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="pt-px text-small text-muted-foreground tabular-nums">{fmtTime(snapshot.now)}</span>
              <DueChip due={snapshot.event.closingAt} now={snapshot.now} context="to closing ceremony" align="end" />
            </div>
          </div>
          <Horizon
            items={all.map((i) => ({ id: i.id, label: i.mark, dueAt: i.dueAt }))}
            now={snapshot.now}
            nowLabel={fmtTime(snapshot.now)}
            activeId={activeId}
            onActiveChange={setActiveId}
          />
        </header>

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b px-4 pt-2 sm:px-6">
          <div role="tablist" aria-label="Filter inbox" className="-mb-px flex gap-1 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                role="tab"
                type="button"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2 font-medium transition-colors duration-150",
                  filter === f.value ? "border-foreground text-foreground" : "border-transparent text-foreground/60 hover:text-foreground",
                )}
              >
                {f.label}
                <span className="text-caption tabular-nums text-muted-foreground">{count(f.value)}</span>
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 pb-2 sm:w-auto">
            <label className="relative flex-1 sm:w-56">
              <span className="sr-only">Search inbox</span>
              <SearchIcon aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search inbox" className="pl-8" />
            </label>
            <Button variant="outline" size="default" className="xl:hidden" onClick={() => setFeedSheet(true)}>
              <ActivityIcon aria-hidden />
              Agent
            </Button>
          </div>
        </div>

        {items.length ? (
          <div className="grid flex-1 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Narrow: full rows that carry their own actions. */}
            <ul aria-label="Inbox, soonest first" className="md:hidden">
              {items.map((item) => (
                <FullRow
                  key={item.id}
                  item={item}
                  snapshot={snapshot}
                  onDetails={() => setMobileDetail(item.id)}
                  onEvidence={() => setEvidenceFor(item)}
                />
              ))}
            </ul>
            {/* Wide: compact rows that open in the detail pane. */}
            <ul
              ref={listRef}
              aria-label="Inbox, soonest first"
              className="max-md:hidden"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "j") {
                  e.preventDefault();
                  moveSelection(1);
                } else if (e.key === "ArrowUp" || e.key === "k") {
                  e.preventDefault();
                  moveSelection(-1);
                }
              }}
            >
              {items.map((item) => (
                <CompactRow
                  key={item.id}
                  item={item}
                  now={snapshot.now}
                  active={activeId === item.id}
                  selected={selected?.id === item.id}
                  onActiveChange={setActiveId}
                  onSelect={setSelectedId}
                />
              ))}
            </ul>
            {selected ? (
              <aside aria-label="Selected item" className="border-l bg-background px-5 py-5 max-md:hidden">
                <div className="sticky top-5">
                  <ItemDetail key={selected.id} item={selected} snapshot={snapshot} onEvidence={() => setEvidenceFor(selected)} />
                </div>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="px-4 py-6 sm:px-6">
            <EmptyState title={all.length ? "No items match" : "You are clear"}>
              {all.length
                ? "Try another filter or clear the search."
                : "Approvals, holds, and exceptions land here when Eve needs a person. Routine in-policy work is handled and logged in the agent feed."}
            </EmptyState>
          </div>
        )}
      </main>

      {/* Wide: the collapsible agent rail. */}
      <aside aria-label="Agent activity" className="hidden border-l bg-rail xl:block">
        <div className="sticky top-0 flex max-h-dvh flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4">
          <div className={cn("flex items-center", railOpen ? "justify-between" : "justify-center")}>
            {railOpen ? <h2 className="text-subheading">Agent</h2> : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={railOpen}
              aria-label={railOpen ? "Collapse agent activity" : "Expand agent activity"}
              onClick={() => setRailOpen((o) => !o)}
            >
              {railOpen ? <PanelRightCloseIcon aria-hidden /> : <PanelRightOpenIcon aria-hidden />}
            </Button>
          </div>
          {railOpen ? (
            <>
              <AgentFeed variant="rail" limit={12} />
              <p className="text-caption text-faint">The agent cannot release money.</p>
            </>
          ) : null}
        </div>
      </aside>

      <Sheet open={feedSheet} onOpenChange={setFeedSheet} title="Agent activity" description="Live runs, refreshed every 2 seconds">
        {feedSheet ? <AgentFeed variant="rail" limit={20} /> : null}
      </Sheet>
      <Sheet
        open={mobileItem !== undefined}
        onOpenChange={(o) => !o && setMobileDetail(null)}
        title="Details"
      >
        {mobileItem ? <ItemDetail item={mobileItem} snapshot={snapshot} onEvidence={() => setEvidenceFor(mobileItem)} /> : null}
      </Sheet>
      <EvidenceSheet
        open={evidenceFor !== null}
        onOpenChange={(o) => !o && setEvidenceFor(null)}
        title={evidenceFor?.title ?? "Evidence"}
        objectIds={evidenceFor ? objectIdsOf(evidenceFor) : []}
        checks={evidenceFor?.ref.kind === "claim" ? evidenceFor.ref.claim.checks : undefined}
        documentId={evidenceFor?.ref.kind === "claim" ? evidenceFor.ref.claim.documentId : undefined}
      />
    </div>
  );
}

function objectIdsOf(item: InboxItem): string[] {
  const r = item.ref;
  switch (r.kind) {
    case "payouts":
      return r.payouts.map((p) => p.id);
    case "payout":
      return [r.payout.id, r.payout.sourceId];
    case "claim":
      return [r.claim.id];
    case "award":
      return [r.award.id, ...(r.payout ? [r.payout.id] : [])];
    case "packet":
      return [r.packet.id, r.packet.payoutId];
    case "person":
      return [r.person.id];
  }
}

function CompactRow({
  item,
  now,
  active,
  selected,
  onActiveChange,
  onSelect,
}: {
  item: InboxItem;
  now: string;
  active: boolean;
  selected: boolean;
  onActiveChange: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      className="border-b last:border-b-0"
      onMouseEnter={() => onActiveChange(item.id)}
      onMouseLeave={() => onActiveChange(null)}
    >
      <button
        type="button"
        data-id={item.id}
        aria-pressed={selected}
        onClick={() => onSelect(item.id)}
        onFocus={() => onActiveChange(item.id)}
        onBlur={() => onActiveChange(null)}
        data-active={active || undefined}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 text-left transition-colors duration-150 ease-dusk outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:bg-surface sm:px-6",
          selected && "bg-surface-hover data-active:bg-surface-hover",
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{item.title}</span>
            {item.critical ? <Badge variant="critical">{item.critical}</Badge> : null}
          </span>
          <span className="truncate text-small text-muted-foreground">{item.meta}</span>
          <span className="truncate text-small text-muted-foreground">{item.detail}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <Money amountMinor={item.amountMinor} currency={item.currency} className="font-semibold" />
          <span className="text-caption text-muted-foreground">{item.amountNote}</span>
          <DueChip due={item.dueAt} now={now} align="end" />
        </span>
      </button>
    </li>
  );
}

function FullRow({
  item,
  snapshot,
  onDetails,
  onEvidence,
}: {
  item: InboxItem;
  snapshot: AppSnapshot;
  onDetails: () => void;
  onEvidence: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{item.title}</h3>
            {item.critical ? <Badge variant="critical">{item.critical}</Badge> : null}
          </div>
          <p className="text-small text-muted-foreground">{item.meta}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Money amountMinor={item.amountMinor} currency={item.currency} className="font-semibold" />
          <span className="text-caption text-muted-foreground">{item.amountNote}</span>
          <DueChip due={item.dueAt} now={snapshot.now} align="end" />
        </div>
      </div>
      {item.detail ? <p className="text-small text-muted-foreground">{item.detail}</p> : null}
      <div className="flex flex-wrap items-center gap-2 [&_[data-slot=button]]:h-9 [&>div]:contents">
        <ItemActions item={item} snapshot={snapshot} layout="row" onEvidence={onEvidence} />
        <Button size="sm" variant="ghost" onClick={onDetails}>
          Details
        </Button>
      </div>
    </li>
  );
}
