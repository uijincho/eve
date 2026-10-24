"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { PersonaSwitcher } from "@/components/app/persona-switcher";
import { Sheet } from "@/components/app/sheet";
import { TruthLabel } from "@/components/eve/truth-label";
import { initials } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

const NAV = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/profile", label: "Profile and tax form" },
  { href: "/portal/claims", label: "Claims" },
  { href: "/portal/travel", label: "Travel" },
  { href: "/portal/prizes", label: "Prizes" },
  { href: "/portal/payouts", label: "Payouts" },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { snapshot } = useEve();
  const [personaOpen, setPersonaOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-rail">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-3 px-4">
          <Link href="/portal" className="rounded-md text-subheading">Eve</Link>
          <span className="truncate text-small text-muted-foreground">{snapshot?.event.name ?? "Portal"}</span>
          {snapshot?.demo ? <TruthLabel kind="sample" className="max-sm:hidden" /> : null}
          <button
            type="button"
            onClick={() => setPersonaOpen(true)}
            aria-label={snapshot ? `${snapshot.actor.name}, switch demo persona` : "Switch demo persona"}
            className="ml-auto flex items-center gap-2 rounded-md px-1.5 py-1 text-small hover:bg-surface"
          >
            <span aria-hidden className="grid size-7 place-items-center rounded-full bg-border text-caption font-semibold">
              {snapshot ? initials(snapshot.actor.name) : ""}
            </span>
            <span className="max-sm:hidden">{snapshot?.actor.name}</span>
          </button>
        </div>
        <nav aria-label="Portal" className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {NAV.map((n) => {
              const active = n.href === "/portal" ? pathname === "/portal" : pathname.startsWith(n.href);
              return (
                <li key={n.href} className="shrink-0">
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center border-b-2 px-2 text-small font-medium transition-colors duration-150",
                      active ? "border-foreground text-foreground" : "border-transparent text-foreground/60 hover:text-foreground",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <div id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        {children}
      </div>
      <Sheet open={personaOpen} onOpenChange={setPersonaOpen} title="Demo persona" description="Sample data only. The server decides what each persona may see and do.">
        <PersonaSwitcher />
      </Sheet>
    </div>
  );
}
