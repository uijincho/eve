"use client";

import { cn } from "cn";

import { BlockedAction } from "@/components/eve/blocked-action";
import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type InboxRowItem = {
  id: string;
  title: string;
  meta: string;
  detail: string;
  amountMinor: number;
  currency: string;
  amountNote: string;
  dueAt: string;
  dueContext: string;
  state?: { tone: "critical"; label: string };
  actions: string[];
  blocked?: { action: string; reason: string };
};

/**
 * One thing that needs a person: what happened, why Eve escalated it, the
 * amount, the deadline, and what you can do. `compact` rows sit beside a
 * detail pane: they select instead of carrying actions.
 */
export function InboxRow({
  item,
  now,
  active = false,
  onActiveChange,
  compact = false,
  selected = false,
  onSelect,
}: {
  item: InboxRowItem;
  now: string;
  active?: boolean;
  onActiveChange?: (id: string | null) => void;
  compact?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const hover = {
    onMouseEnter: () => onActiveChange?.(item.id),
    onMouseLeave: () => onActiveChange?.(null),
    onFocusCapture: () => onActiveChange?.(item.id),
    onBlurCapture: () => onActiveChange?.(null),
  };

  if (compact) {
    return (
      <li {...hover} className="border-b last:border-b-0">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect?.(item.id)}
          data-active={active || undefined}
          className={cn(
            "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 text-left transition-colors duration-150 ease-dusk outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:bg-surface",
            selected && "bg-surface-hover data-active:bg-surface-hover",
          )}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">{item.title}</span>
              {item.state ? <Badge variant="critical">{item.state.label}</Badge> : null}
            </span>
            <span className="truncate text-small text-muted-foreground">{item.meta}</span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <Money amountMinor={item.amountMinor} currency={item.currency} className="font-semibold" />
            <DueChip due={item.dueAt} now={now} align="end" />
          </span>
        </button>
      </li>
    );
  }

  const [first, ...rest] = item.actions;
  return (
    <li
      {...hover}
      data-active={active || undefined}
      className="grid grid-cols-1 gap-x-6 gap-y-3 border-b px-4 py-4 transition-colors duration-150 ease-dusk last:border-b-0 data-active:bg-surface md:grid-cols-[minmax(0,1fr)_8rem_9rem]"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{item.title}</h3>
          {item.state ? <Badge variant="critical">{item.state.label}</Badge> : null}
        </div>
        <p className="text-small text-muted-foreground">{item.meta}</p>
        <p className="text-small text-muted-foreground">{item.detail}</p>
      </div>

      <div className="flex items-start justify-between gap-4 md:contents">
        <div className="flex flex-col gap-0.5 md:items-end md:text-right">
          <Money amountMinor={item.amountMinor} currency={item.currency} className="font-semibold" />
          <span className="text-caption text-muted-foreground">{item.amountNote}</span>
        </div>
        <DueChip due={item.dueAt} now={now} context={item.dueContext} align="end" />
      </div>

      <div className="col-span-full flex flex-wrap items-center gap-2">
        {item.blocked ? (
          <BlockedAction action={item.blocked.action} reason={item.blocked.reason} />
        ) : null}
        {first ? (
          <Button size="sm" variant={item.blocked ? "ghost" : "secondary"}>
            {first}
          </Button>
        ) : null}
        {rest.map((label) => (
          <Button key={label} size="sm" variant="ghost">
            {label}
          </Button>
        ))}
      </div>
    </li>
  );
}

/** Placeholder rows while the inbox loads. Same geometry as a real row. */
export function InboxRowSkeleton() {
  return (
    <li
      aria-hidden
      className="grid grid-cols-1 gap-x-6 gap-y-3 border-b px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_8rem_9rem]"
    >
      <div className="flex flex-col gap-2 py-0.5">
        <span className="h-3.5 w-2/5 animate-pulse rounded-sm bg-surface-hover" />
        <span className="h-3 w-1/3 animate-pulse rounded-sm bg-surface" />
        <span className="h-3 w-3/5 animate-pulse rounded-sm bg-surface" />
      </div>
      <span className="h-3.5 w-16 animate-pulse rounded-sm bg-surface-hover md:justify-self-end" />
      <span className="h-3.5 w-12 animate-pulse rounded-sm bg-surface max-md:hidden md:justify-self-end" />
    </li>
  );
}

export function InboxList({
  className,
  label,
  busy,
  children,
}: {
  className?: string;
  label?: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      aria-busy={busy || undefined}
      className={cn("overflow-hidden rounded-xl border", className)}
    >
      {children}
    </ul>
  );
}
