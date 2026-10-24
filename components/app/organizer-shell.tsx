"use client";

import { cn } from "cn";
import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { PersonaSwitcher } from "@/components/app/persona-switcher";
import { Sheet } from "@/components/app/sheet";
import { EveMark } from "@/components/eve/logo";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { buildInbox } from "@/lib/client/derive";
import { fmtDate, fmtTime } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

type NavItem = { href: string; label: string; count?: (n: Counts) => number };
type Counts = { inbox: number; claims: number; payouts: number; prizes: number; sponsor: number };

const PRIMARY: NavItem[] = [
  { href: "/overview", label: "Overview" },
  { href: "/inbox", label: "Inbox", count: (n) => n.inbox },
  { href: "/claims", label: "Claims", count: (n) => n.claims },
  { href: "/prizes", label: "Prizes", count: (n) => n.prizes },
  { href: "/payouts", label: "Payouts", count: (n) => n.payouts },
  { href: "/people", label: "People" },
  { href: "/budget", label: "Budget" },
  { href: "/sponsor", label: "Sponsor", count: (n) => n.sponsor },
];
const SECONDARY: NavItem[] = [
  { href: "/audit", label: "Audit trail" },
  { href: "/filings", label: "Filings" },
  { href: "/agent", label: "Agent" },
  { href: "/settings", label: "Settings" },
];
const SETUP: NavItem[] = [
  { href: "/setup", label: "Organization setup" },
  { href: "/events/new", label: "Event setup" },
];

export function OrganizerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { snapshot } = useEve();
  const [menuOpen, setMenuOpen] = useState(false);

  const counts = useMemo<Counts | null>(() => {
    if (!snapshot) return null;
    return {
      inbox: buildInbox(snapshot).length,
      claims: snapshot.claims.filter((c) => c.status === "escalated" || c.status === "needs_info").length,
      prizes: snapshot.awards.filter((a) => a.status !== "paid" && a.status !== "proposed").length,
      payouts: snapshot.payouts.filter((p) => ["proposed", "approved", "frozen", "failed", "held"].includes(p.status)).length,
      sponsor: snapshot.packets.filter((p) => p.status === "exception" || p.status === "questioned").length,
    };
  }, [snapshot]);

  const current = [...PRIMARY, ...SECONDARY, ...SETUP].find((n) => isCurrent(pathname, n.href));
  const attendeeHere = snapshot?.actor.role === "attendee";

  const nav = (onNavigate?: () => void) => (
    <nav aria-label="Organizer" className="flex flex-col gap-0.5">
      {PRIMARY.filter((n) => n.href !== "/sponsor" || snapshot?.org.mode !== "direct").map((n) => (
        <NavLink key={n.href} item={n} counts={counts} pathname={pathname} onNavigate={onNavigate} />
      ))}
      <hr className="mx-2 my-2 border-border" />
      {SECONDARY.map((n) => (
        <NavLink key={n.href} item={n} counts={counts} pathname={pathname} onNavigate={onNavigate} />
      ))}
      <hr className="mx-2 my-2 border-border" />
      {SETUP.map((n) => (
        <NavLink key={n.href} item={n} counts={counts} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </nav>
  );

  const eventCard = snapshot ? (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-background px-3 py-2.5">
      <span className="text-small font-semibold">{snapshot.event.name}</span>
      <span className="text-caption text-muted-foreground">
        {fmtDate(snapshot.event.startsAt)} to {fmtDate(snapshot.event.endsAt, true)} · {snapshot.event.venue}
      </span>
      <span className="mt-1.5 text-caption text-muted-foreground">Closing ceremony</span>
      <span className="text-small font-semibold tabular-nums">
        {fmtDate(snapshot.event.closingAt)}, {fmtTime(snapshot.event.closingAt)}
      </span>
    </div>
  ) : (
    <div aria-hidden className="h-[6.5rem] animate-pulse rounded-xl bg-surface-hover" />
  );

  return (
    <div className="flex min-h-dvh flex-col xl:grid xl:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Wide: the rail. */}
      <aside className="sticky top-0 hidden h-dvh p-3 pr-0 xl:flex">
        <div className="flex w-full flex-col gap-4 overflow-y-auto rounded-2xl border bg-rail px-3 pt-4 pb-3">
        <Brand demo={snapshot?.demo} />
        {eventCard}
        {nav()}
        <div className="mt-auto border-t pt-3">
          <PersonaSwitcher />
        </div>
        </div>
      </aside>

      {/* Narrow: a top bar with the same navigation in a sheet. */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-rail px-2 xl:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
          <MenuIcon aria-hidden />
        </Button>
        <Brand demo={snapshot?.demo} compact />
        <span aria-hidden className="text-border">/</span>
        <span className="truncate text-small font-medium">{current?.label ?? ""}</span>
        {counts && current?.href !== "/inbox" && counts.inbox ? (
          <Link
            href="/inbox"
            className="ml-auto rounded-md px-2 py-1 text-small text-muted-foreground hover:text-foreground"
          >
            Inbox <span className="tabular-nums text-foreground">{counts.inbox}</span>
          </Link>
        ) : null}
      </header>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Eve" side="left" description={snapshot?.event.name}>
        <div className="flex flex-col gap-4">
          {nav(() => setMenuOpen(false))}
          <div className="border-t pt-3">
            <PersonaSwitcher />
          </div>
        </div>
      </Sheet>

      <div id="main" className="flex min-w-0 flex-1 flex-col">
        {attendeeHere ? (
          <p role="note" className="border-b bg-surface px-4 py-2 text-small text-muted-foreground sm:px-6">
            {snapshot?.demo ? "Your sample persona is an attendee, so organizer data is hidden." : "You are signed in as an attendee, so organizer pages are hidden."}{" "}
            <Link href="/portal" className="font-medium text-foreground underline">
              Open your portal
            </Link>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function Brand({ demo, compact }: { demo?: boolean; compact?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", !compact && "px-1")}>
      <Link
        href="/overview"
        className={cn("flex items-center gap-2 rounded-md font-semibold tracking-[-0.02em]", compact ? "text-subheading" : "text-heading")}
      >
        <EveMark className={compact ? "size-6" : "size-7"} />
        Eve
      </Link>
      {demo && !compact ? <TruthLabel kind="sample" /> : null}
    </div>
  );
}

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  counts,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  counts: Counts | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isCurrent(pathname, item.href);
  const n = counts && item.count ? item.count(counts) : 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 text-body transition-colors duration-150",
        active ? "bg-foreground font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {item.label}
      {n ? (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-semibold tabular-nums",
            active ? "bg-money text-foreground" : "bg-surface-hover text-muted-foreground",
          )}
        >
          {n}
        </span>
      ) : null}
    </Link>
  );
}
