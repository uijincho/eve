"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountMenu } from "@/components/app/account-menu";
import { EveMark } from "@/components/eve/logo";
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
  const { navRef, edges } = useOverflowEdges(pathname);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-rail">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-2 rounded-md text-subheading font-semibold"><EveMark className="size-6" />Eve</Link>
          <span className="truncate text-small text-muted-foreground">{snapshot?.event.name ?? "Portal"}</span>
          <AccountMenu variant="bar" />
        </div>
        <nav
          ref={navRef}
          aria-label="Portal"
          className="mx-auto max-w-5xl overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={fadeMask(edges)}
        >
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
    </div>
  );
}

/**
 * Tracks whether the tab row has more to either side, so narrow screens fade
 * that edge as a cue, and keeps the current tab scrolled into view.
 */
function useOverflowEdges(pathname: string) {
  const navRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () =>
      setEdges({ before: el.scrollLeft > 2, after: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [pathname]);
  return { navRef, edges };
}

function fadeMask({ before, after }: { before: boolean; after: boolean }): React.CSSProperties | undefined {
  if (!before && !after) return undefined;
  const mask = `linear-gradient(to right, ${before ? "transparent, black 2rem" : "black"}, ${after ? "black calc(100% - 3rem), transparent" : "black"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}
