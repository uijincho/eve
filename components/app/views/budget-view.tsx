"use client";

import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { BooksCurrencyNote } from "@/components/app/books-currency-note";
import { PageFrame } from "@/components/app/page-frame";
import { Section } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { CapacityBar } from "@/components/eve/capacity-bar";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, BudgetLine } from "@/lib/contracts";
import { big, booksCurrency, budgetTotals, canManage } from "@/lib/client/derive";
import { minorToInput } from "@/lib/client/format";
import { payloads, toMinor } from "@/lib/client/payloads";

export function BudgetView() {
  return (
    <PageFrame
      title="Budget"
      lede={(s) => {
        const t = budgetTotals(s);
        return (
          <>
            <Money amountMinor={t.spent + t.committed} currency={booksCurrency(s)} className="font-semibold text-foreground" /> spent and committed of <Money amountMinor={t.cap} currency={booksCurrency(s)} /> across {s.budgets.length} lines. Committed spend is approved but not yet paid.
          </>
        );
      }}
    >
      {(s) => {
        const t = budgetTotals(s);
        return s.budgets.length ? (
          <>
            <CapacityBar label="Whole event" capMinor={Number(t.cap)} spentMinor={Number(t.spent)} committedMinor={Number(t.committed)} currency={booksCurrency(s)} className="max-w-3xl" />
            <BooksCurrencyNote snapshot={s} />
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

/** A budget line as the server sends it: amounts in the USD books, plus the cap as the organizer entered it. */
type BudgetDTO = BudgetLine & { currency?: string; enteredCapMinor?: string; enteredCurrency?: string; fxSource?: string };

function BudgetRow({ line: b, snapshot }: { line: BudgetDTO; snapshot: AppSnapshot }) {
  const books = b.currency ?? booksCurrency(snapshot);
  const entered = b.enteredCurrency ?? snapshot.org.currency;
  const [editing, setEditing] = useState(false);
  // Edit the cap the organizer typed, in their currency; never the converted books amount.
  const [cap, setCap] = useState(minorToInput(b.enteredCapMinor ?? b.capMinor));
  const [error, setError] = useState<string | null>(null);
  const manage = canManage(snapshot.actor);
  return (
    <li className="flex flex-col gap-2 border-b pb-6 last:border-b-0">
      <CapacityBar label={b.name} capMinor={Number(big(b.capMinor))} spentMinor={Number(big(b.spentMinor))} committedMinor={Number(big(b.committedMinor))} currency={books} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span>
          Funded by {b.fundingSource}
          {entered !== books && b.enteredCapMinor ? (
            <>
              {" · "}cap set as <Money amountMinor={big(b.enteredCapMinor)} currency={entered} />{b.fxSource ? `, converted at ${b.fxSource}` : ""}
            </>
          ) : null}
        </span>
        {manage.allowed && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change cap
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-start gap-2">
          <label className="sr-only" htmlFor={`cap-${b.id}`}>New cap for {b.name}, {entered}</label>
          <Input
            id={`cap-${b.id}`}
            inputMode="decimal"
            value={cap}
            onChange={(e) => { setCap(e.target.value); setError(null); }}
            className="w-36"
            aria-invalid={error ? true : undefined}
          />
          <span className="self-center text-small text-muted-foreground">{entered}</span>
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
