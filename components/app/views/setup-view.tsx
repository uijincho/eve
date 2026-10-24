"use client";

import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { LimitsForm, MoneyMovementForm, NotificationsForm, OrgIdentityForm } from "@/components/app/settings-forms";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";

const STEPS = [
  { id: "org", label: "Organization", why: "Your legal name and country decide which payer tax rules apply." },
  { id: "money", label: "How money moves", why: "Pay directly, or prepare packets for the university or fiscal sponsor that holds the account." },
  { id: "limits", label: "People and limits", why: "Eve auto-approves only up to its limit. A controller releases every payout." },
  { id: "accounting", label: "Accounting", why: "Eve keeps a double-entry ledger and exports it for your books." },
  { id: "notify", label: "Notifications", why: "Where Eve sends escalations and the daily digest." },
] as const;

export function SetupView() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const next = () => {
    setDone((d) => new Set(d).add(step));
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const current = STEPS[step];

  return (
    <PageFrame title="Organization setup" lede={() => "About ten minutes, once per organization. Each step saves as you go."}>
      {(s) => (
        <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Setup steps">
            <ol className="flex gap-1 overflow-x-auto lg:flex-col">
              {STEPS.map((x, i) => (
                <li key={x.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => setStep(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-small transition-colors duration-150",
                      i === step ? "bg-surface font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span aria-hidden className={cn("grid size-5 place-items-center rounded-full border text-caption tabular-nums", done.has(i) && "border-positive text-positive")}>
                      {done.has(i) ? <CheckIcon className="size-3" /> : i + 1}
                    </span>
                    {x.label}
                    {done.has(i) ? <span className="sr-only">(saved)</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section aria-labelledby="step-title" className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 id="step-title" className="text-heading">{current.label}</h2>
              <p className="max-w-[60ch] text-small text-muted-foreground">{current.why}</p>
            </div>
            {current.id === "org" ? <OrgIdentityForm snapshot={s} submitLabel="Save and continue" onSaved={next} /> : null}
            {current.id === "money" ? <MoneyMovementForm snapshot={s} submitLabel="Save and continue" onSaved={next} /> : null}
            {current.id === "limits" ? <LimitsForm snapshot={s} submitLabel="Save and continue" onSaved={next} /> : null}
            {current.id === "accounting" ? (
              <div className="flex max-w-xl flex-col gap-4">
                <div className="flex flex-col gap-1 rounded-lg border px-4 py-3">
                  <span className="flex items-center gap-2 font-medium">Starter chart of accounts <TruthLabel kind="simulated" /></span>
                  <span className="text-small text-muted-foreground">QuickBooks sandbox sync is not connected in this demo. The ledger exports as CSV from the audit trail.</span>
                </div>
                <Button className="self-start" variant="secondary" onClick={next}>Continue</Button>
              </div>
            ) : null}
            {current.id === "notify" ? <NotificationsForm snapshot={s} submitLabel="Save and finish" onSaved={() => setDone((d) => new Set(d).add(step))} /> : null}
            {done.size >= STEPS.length - 1 && step === STEPS.length - 1 ? (
              <LinkButton href="/events/new" variant="secondary" className="self-start">Set up the event</LinkButton>
            ) : null}
          </section>
        </div>
      )}
    </PageFrame>
  );
}
