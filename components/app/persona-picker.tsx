"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ResultText } from "@/components/app/action-button";
import { ErrorState } from "@/components/app/states";
import { TruthLabel } from "@/components/eve/truth-label";
import type { ActionResult, Actor } from "@/lib/contracts";
import { ROLE_LABEL, initials } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

const WHAT: Record<string, string> = {
  organizer: "Works the inbox, reviews claims, enters winners, proposes payouts. Cannot release money.",
  controller: "Releases payouts and locks periods. Cannot release a payout they requested.",
  attendee: "Signs tax forms, uploads receipts, picks a prize option, and tracks payouts.",
  auditor: "Reads every decision and its evidence. Cannot change anything.",
};

/** Demo sign-in: choose which sample person to be. Not real authentication. */
export function PersonaPicker() {
  const { snapshot, error, refresh, setPersona } = useEve();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const choose = async (p: Actor) => {
    setPending(p.id);
    const r = await setPersona(p.id);
    setPending(null);
    if (!r.ok) return setResult(r);
    router.push(p.role === "attendee" ? "/portal" : "/");
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-heading">Eve</span>
          <TruthLabel kind="sample" />
        </div>
        <h1 className="text-title">Choose a sample persona</h1>
        <p className="max-w-[60ch] text-small text-muted-foreground">
          This demo runs on a synthetic event. Picking a persona does not grant real access; the server enforces what each role may see and do.
        </p>
      </div>
      {error && !snapshot ? <ErrorState error={error} onRetry={refresh} /> : null}
      {snapshot ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {snapshot.personas.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => choose(p)}
                disabled={pending !== null}
                aria-busy={pending === p.id || undefined}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface disabled:cursor-wait"
              >
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-border text-caption font-semibold">{initials(p.name)}</span>
                <span className="flex flex-col">
                  <span className="font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {ROLE_LABEL[p.role]}</span></span>
                  <span className="text-small text-muted-foreground">{WHAT[p.role] ?? ""}</span>
                </span>
                {pending === p.id ? <LoaderCircleIcon aria-label="Switching" className="size-4 animate-spin" /> : snapshot.actor.id === p.id ? <span className="text-caption text-muted-foreground">Current</span> : <span />}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {snapshot && !snapshot.personas.length ? <p className="text-small text-muted-foreground">Sample personas are only available in demo mode.</p> : null}
      <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
    </main>
  );
}
