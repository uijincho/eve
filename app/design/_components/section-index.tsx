"use client";

import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";

export type IndexEntry = { id: string; label: string; children?: IndexEntry[] };

/** The last section whose top has scrolled past the reading line. */
function useCurrentSection(entries: IndexEntry[]) {
  const [current, setCurrent] = useState(entries[0]?.id);

  useEffect(() => {
    const ids = entries.flatMap((e) => [e.id, ...(e.children ?? []).map((c) => c.id)]);
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let next = ids[0];
      for (const id of ids) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 120) next = id;
      }
      setCurrent(atBottom ? ids[ids.length - 1] : next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [entries]);

  return current;
}

/** Sticky contents list for wide screens. */
export function SectionIndex({ entries }: { entries: IndexEntry[] }) {
  const current = useCurrentSection(entries);

  return (
    <nav aria-label="On this page" className="flex flex-col gap-1 text-small">
      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col">
          <IndexLink id={entry.id} current={current} strong>
            {entry.label}
          </IndexLink>
          {entry.children ? (
            <div className="mb-2 ml-3 flex flex-col border-l">
              {entry.children.map((child) => (
                <IndexLink key={child.id} id={child.id} current={current} nested>
                  {child.label}
                </IndexLink>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

/** The same contents as a jump menu, for narrow screens. */
export function MobileIndex({ entries }: { entries: IndexEntry[] }) {
  const current = useCurrentSection(entries);

  return (
    <div className="relative">
      <label htmlFor="mobile-index" className="sr-only">
        Jump to section
      </label>
      <select
        id="mobile-index"
        value={current}
        onChange={(e) => {
          window.location.hash = e.target.value;
        }}
        className="h-8 max-w-48 appearance-none truncate rounded-lg border border-input bg-background pr-8 pl-2.5 text-small text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {entries.map((entry) =>
          entry.children ? (
            <optgroup key={entry.id} label={entry.label}>
              <option value={entry.id}>{entry.label}</option>
              {entry.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ),
        )}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function IndexLink({
  id,
  current,
  strong,
  nested,
  children,
}: {
  id: string;
  current?: string;
  strong?: boolean;
  nested?: boolean;
  children: React.ReactNode;
}) {
  const active = current === id;
  return (
    <a
      href={`#${id}`}
      aria-current={active ? "location" : undefined}
      className={cn(
        "rounded-md py-1 transition-colors duration-150 hover:text-foreground",
        nested ? "-ml-px border-l border-transparent pl-3" : "px-0",
        strong && "font-medium",
        active ? "text-foreground" : "text-muted-foreground",
        active && nested && "border-foreground",
      )}
    >
      {children}
    </a>
  );
}
