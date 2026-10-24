"use client";

import { cn } from "cn";
import { LoaderCircleIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ResultText } from "@/components/app/result-text";
import { SignOutButton } from "@/components/app/sign-out-button";
import type { ActionResult, Role } from "@/lib/contracts";
import { ROLE_LABEL, initials } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

const ROLES: Role[] = ["organizer", "controller", "auditor", "attendee"];

/**
 * Demo-only persona switcher. It changes which sample person the demo session
 * represents; the server still decides what that persona may do.
 */
export function PersonaSwitcher({ className }: { className?: string }) {
  const { snapshot, setPersona } = useEve();
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  if (!snapshot) return null;
  const { actor, personas } = snapshot;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-border text-caption font-semibold"
        >
          {initials(actor.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-small font-semibold">{actor.name}</span>
          <span className="text-caption text-muted-foreground">{ROLE_LABEL[actor.role]}</span>
        </span>
        {pending ? <LoaderCircleIcon aria-label="Switching" className="ml-auto size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      {!snapshot.demo ? <SignOutButton className="self-start" /> : null}
      {snapshot.demo && personas.length > 1 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-caption text-faint">
            Demo persona
          </label>
          <select
            id={id}
            value={actor.id}
            disabled={pending}
            onChange={async (e) => {
              const next = personas.find((p) => p.id === e.target.value);
              if (!next) return;
              setPending(true);
              const r = await setPersona(next.id);
              setPending(false);
              setResult(r.ok ? null : r);
              if (!r.ok) return;
              const inPortal = pathname.startsWith("/portal");
              if (next.role === "attendee" && !inPortal) router.push("/portal");
              if (next.role !== "attendee" && inPortal) router.push("/");
            }}
            className="h-7 w-full rounded-md border border-border bg-rail px-1.5 text-small outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* Grouped by role so the closed select shows only a name and fits the 176px rail. */}
            {ROLES.filter((r) => personas.some((p) => p.role === r)).map((r) => (
              <optgroup key={r} label={ROLE_LABEL[r]}>
                {personas.filter((p) => p.role === r).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {result ? <ResultText result={result} /> : null}
        </div>
      ) : null}
    </div>
  );
}
