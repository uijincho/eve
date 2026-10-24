"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthForm } from "@/components/app/auth-form";
import { ResultText } from "@/components/app/result-text";
import { TruthLabel } from "@/components/eve/truth-label";
import type { ActionResult, Actor } from "@/lib/contracts";
import { ROLE_LABEL, initials } from "@/lib/client/format";
import { homeFor, onboarding } from "@/lib/client/account";
import { useEve } from "@/lib/client/use-eve";

const WHAT: Record<string, string> = {
  organizer: "Works the inbox, reviews claims, enters winners, proposes payouts. Cannot release money.",
  controller: "Releases payouts and locks periods. Cannot release a payout they requested.",
  attendee: "Signs tax forms, uploads receipts, picks a prize option, and tracks payouts.",
  auditor: "Reads every decision and its evidence. Cannot change anything.",
};

/**
 * Sign-in: a real account (email and password) first; in demo mode, the
 * sample personas below it. Picking a persona is not real authentication.
 */
export function PersonaPicker() {
  const { snapshot, setPersona } = useEve();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const choose = async (p: Actor) => {
    setPending(p.id);
    const r = await setPersona(p.id);
    setPending(null);
    if (!r.ok) return setResult(r);
    router.push(p.role === "attendee" ? "/portal" : "/overview");
  };

  const afterSignIn = async () => {
    // A real session replaces any sample persona in this browser.
    await fetch("/api/demo/session", { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    const next = new URLSearchParams(window.location.search).get("next");
    try {
      const me = await onboarding.get();
      if (me.needsSetup && !me.memberships.length) return router.replace("/onboarding");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(me.memberships[0]?.role));
    } catch {
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview");
    }
  };

  const personas = snapshot?.demo ? snapshot.personas : [];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-10 px-4 py-12 sm:py-16">
      <div className="flex flex-col gap-2">
        <span className="text-heading">Eve</span>
        <h1 className="text-title">Sign in</h1>
        <p className="max-w-[56ch] text-small text-muted-foreground">
          Organizers, controllers and auditors sign in with the email their invitation was sent to. Attendees use the portal link from their organizer.
        </p>
      </div>
      <AuthForm onSignedIn={afterSignIn} />

      {personas.length ? (
        <section aria-labelledby="sample-heading" className="flex flex-col gap-4 border-t pt-8">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h2 id="sample-heading" className="text-subheading">Explore the sample event</h2>
              <TruthLabel kind="sample" />
            </div>
            <p className="max-w-[56ch] text-small text-muted-foreground">
              A synthetic event with seeded data. Picking a persona does not grant real access; the server enforces what each role may see and do.
            </p>
          </div>
          <ul className="flex flex-col divide-y rounded-xl border">
            {personas.map((p) => (
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
                  {pending === p.id ? <LoaderCircleIcon aria-label="Switching" className="size-4 animate-spin" /> : <span />}
                </button>
              </li>
            ))}
          </ul>
          <span role="status" aria-live="polite">{result ? <ResultText result={result} /> : null}</span>
        </section>
      ) : null}
    </main>
  );
}
