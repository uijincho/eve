"use client";

import { cn } from "cn";
import { useState } from "react";

import { BlockedAction } from "@/components/eve/blocked-action";
import { BreakdownBar } from "@/components/eve/breakdown-bar";
import { DueChip } from "@/components/eve/due-chip";
import { Horizon } from "@/components/eve/horizon";
import { InboxRow } from "@/components/eve/inbox-row";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SAMPLE_CLOSING,
  SAMPLE_INBOX,
  SAMPLE_NOW,
  type InboxCategory,
  type SampleInboxItem,
} from "@/lib/design/sample";

type Filter = "all" | InboxCategory | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approvals", label: "Approvals" },
  { value: "holds", label: "Holds" },
  { value: "exceptions", label: "Exceptions" },
  { value: "done", label: "Done" },
];

const NAV = [
  "Inbox",
  "Claims",
  "Prizes",
  "Payouts",
  "People",
  "Budget",
  "Disburse",
  "Audit trail",
  "Filings",
  "Agent",
  "Settings",
];

/**
 * The organizer inbox in its shell. The horizon and the list share one hover;
 * selecting a row opens it in the detail pane.
 */
export function InboxExample() {
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("priya");

  const items = SAMPLE_INBOX.filter((item) =>
    filter === "all" ? true : item.category === filter,
  );
  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  const count = (f: Filter) =>
    f === "all"
      ? SAMPLE_INBOX.length
      : SAMPLE_INBOX.filter((i) => i.category === f).length;

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid xl:grid-cols-[10rem_minmax(0,1fr)]">
        <nav aria-label="App" className="hidden flex-col gap-0.5 border-r bg-rail p-3 xl:flex">
          <span className="px-2 pt-1 pb-4 text-subheading">Eve</span>
          {NAV.map((label) => (
            <a
              key={label}
              href="#example"
              aria-current={label === "Inbox" ? "page" : undefined}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-small transition-colors hover:text-foreground",
                label === "Inbox" ? "bg-surface font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
              {label === "Inbox" ? (
                <span className="text-caption tabular-nums text-muted-foreground">{SAMPLE_INBOX.length}</span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="min-w-0">
          <header className="flex flex-col gap-6 border-b px-5 pt-5 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-heading">Inbox</h3>
                <p className="text-small text-muted-foreground">
                  7 items need you. Eve auto-approved 23 in-policy claims today.
                </p>
              </div>
              <DueChip due={SAMPLE_CLOSING} now={SAMPLE_NOW} context="to closing ceremony" align="end" />
            </div>
            <Horizon
              items={items.map((i) => ({ id: i.id, label: i.mark, dueAt: i.dueAt }))}
              now={SAMPLE_NOW}
              nowLabel="1:42 PM"
              activeId={activeId}
              onActiveChange={setActiveId}
            />
          </header>

          <div className="px-5 pt-2 pb-1">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList
                variant="line"
                className="max-w-full flex-wrap justify-start gap-y-2 group-data-horizontal/tabs:h-auto"
              >
                {FILTERS.map((f) => (
                  <TabsTrigger key={f.value} value={f.value} className="flex-none px-2">
                    {f.label}
                    <span className="text-caption tabular-nums text-muted-foreground">
                      {count(f.value)}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {items.length ? (
            <div className="grid border-t md:grid-cols-[minmax(0,1fr)_19rem]">
              {/* Narrow screens: full rows with their actions. */}
              <ul aria-label="Inbox" className="md:hidden">
                {items.map((item) => (
                  <InboxRow key={item.id} item={item} now={SAMPLE_NOW} />
                ))}
              </ul>
              {/* Wide screens: compact rows that open in the detail pane. */}
              <ul aria-label="Inbox" className="max-md:hidden">
                {items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    now={SAMPLE_NOW}
                    compact
                    active={activeId === item.id}
                    onActiveChange={setActiveId}
                    selected={selected?.id === item.id}
                    onSelect={setSelectedId}
                  />
                ))}
              </ul>
              {selected ? <Detail item={selected} /> : null}
            </div>
          ) : (
            <div className="border-t px-5 py-12">
              <p className="font-semibold">Nothing resolved yet today</p>
              <p className="mt-1 text-small text-muted-foreground">
                Items you approve, reject, or send back move here with who decided and when.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ item }: { item: SampleInboxItem }) {
  const [primary, ...rest] = item.actions;
  return (
    <aside
      aria-label={`${item.title}, details`}
      className="flex flex-col gap-6 border-l p-5 max-md:hidden"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-subheading">{item.title}</h4>
          <DueChip due={item.dueAt} now={SAMPLE_NOW} align="end" className="shrink-0 pt-1" />
        </div>
        <p className="text-small text-muted-foreground">{item.meta}</p>
        {item.state ? <Badge variant="critical">{item.state.label}</Badge> : null}
      </div>

      <p className="text-small">{item.detail}</p>

      {item.breakdown ? (
        <BreakdownBar
          grossMinor={item.breakdown.grossMinor}
          deductions={item.breakdown.deductions}
          netLabel={item.breakdown.netLabel}
          estimate={item.breakdown.estimate}
          currency={item.currency}
        />
      ) : (
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">{item.amountNote}</span>
          <Money amountMinor={item.amountMinor} currency={item.currency} className="font-semibold" />
        </div>
      )}

      {item.rule ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-small text-muted-foreground">{item.rule.text}</p>
          {item.rule.verified ? null : <TruthLabel kind="unverified" className="self-start" />}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-3 border-t pt-4">
        {item.blocked ? (
          <BlockedAction action={item.blocked.action} reason={item.blocked.reason} />
        ) : null}
        {primary ? (
          <Button size="sm" variant={item.blocked ? "secondary" : "default"} className="w-full">
            {primary}
          </Button>
        ) : null}
        {rest.length ? (
          <div className="-mx-2.5 flex flex-wrap">
            {rest.map((label) => (
              <Button key={label} size="sm" variant="ghost">
                {label}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="text-caption text-muted-foreground">
          Eve prepares and explains. A human controller signs.
        </p>
      </div>
    </aside>
  );
}
