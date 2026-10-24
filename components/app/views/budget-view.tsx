"use client";

import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { PageFrame } from "@/components/app/page-frame";
import { Section } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { CapacityBar } from "@/components/eve/capacity-bar";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, BudgetLine } from "@/lib/contracts";
import { big, budgetTotals, canManage } from "@/lib/client/derive";
import { payloads, toMinor } from "@/lib/client/payloads";

export function BudgetView() {
  return (
    <PageFrame
      title="Budget"
      lede={(s) => {
        const t = budgetTotals(s);
        return (
          <>
            <Money amountMinor={t.spent + t.committed} className="font-semibold text-foreground" /> spent and committed of <Money amountMinor={t.cap} /> across {s.budgets.length} lines. Committed spend is approved but not yet paid.
          </>
        );
      }}
    >
      {(s) => {
        const t = budgetTotals(s);
        return s.budgets.length ? (
          <>
            <CapacityBar label="Whole event" capMinor={Number(t.cap)} spentMinor={Number(t.spent)} committedMinor={Number(t.committed)} className="max-w-3xl" />
            <Section title="Lines" aside="Spent, committed, and remaining against each cap">
              <ul className="grid max-w-3xl gap-6">
                {s.budgets.map((b) => (
                  <BudgetRow key={b.id} line={b} snapshot={s} />
                ))}
              </ul>
            </Section>
          </>
        ) : (
          <EmptyState title="No budget lines yet">Add travel, prizes, food, and swag lines in event setup. Eve tracks spent and committed money against each cap.</EmptyState>
        );
      }}
    </PageFrame>
  );
}

function BudgetRow({ line: b, snapshot }: { line: BudgetLine; snapshot: AppSnapshot }) {
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState((Number(big(b.capMinor)) / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const manage = canManage(snapshot.actor);
  return (
    <li className="flex flex-col gap-2 border-b pb-6 last:border-b-0">
      <CapacityBar label={b.name} capMinor={Number(big(b.capMinor))} spentMinor={Number(big(b.spentMinor))} committedMinor={Number(big(b.committedMinor))} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span>Funded by {b.fundingSource}</span>
        {manage.allowed && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change cap
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-start gap-2">
          <label className="sr-only" htmlFor={`cap-${b.id}`}>New cap for {b.name}, USD</label>
          <Input
            id={`cap-${b.id}`}
            inputMode="decimal"
            value={cap}
            onChange={(e) => { setCap(e.target.value); setError(null); }}
            className="w-36"
            aria-invalid={error ? true : undefined}
          />
          <ActionButton
            label="Save cap"
            pendingLabel="Saving"
            onDone={(r) => r.ok && setEditing(false)}
            call={() => {
              const minor = toMinor(cap);
              if (!minor) {
                setError("Enter an amount like 60000.00");
                return null;
              }
              return payloads.budgetUpdate({ id: b.id, name: b.name, capMinor: minor, fundingSource: b.fundingSource });
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          {error ? <p className="w-full text-small text-critical">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
