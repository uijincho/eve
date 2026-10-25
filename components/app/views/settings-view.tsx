"use client";

import { useState } from "react";

import { AccountingExports } from "@/components/app/accounting-exports";
import { ActionButton } from "@/components/app/action-button";
import { BooksCurrencyNote } from "@/components/app/books-currency-note";
import { PageFrame } from "@/components/app/page-frame";
import { Section } from "@/components/app/page-header";
import {
  LimitsForm,
  MoneyMovementForm,
  NotificationsForm,
  OrgIdentityForm,
  PeriodLockForm,
  TravelPolicyForm,
} from "@/components/app/settings-forms";
import { TeamSection } from "@/components/app/team-section";
import { TruthLabel } from "@/components/eve/truth-label";
import { canControl, canManage, canOrganize, type Permission } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

export function SettingsView() {
  const [resetConfirm, setResetConfirm] = useState(false);
  return (
    <PageFrame
      title="Settings"
      lede={() => "Eve works inside these limits. Every change is logged."}
    >
      {(s) => (
        <div className="flex max-w-3xl flex-col gap-12">
          <ReadOnlyNote permission={canOrganize(s.actor)} />
          <Section title="Organization"><OrgIdentityForm snapshot={s} /></Section>
          <Section title="Approval limits">
            <BooksCurrencyNote snapshot={s} />
            <LimitsForm snapshot={s} />
          </Section>
          <Section title="Money movement"><MoneyMovementForm snapshot={s} /></Section>
          <Section title="Travel policy"><TravelPolicyForm snapshot={s} /></Section>
          <Section title="Notifications"><NotificationsForm snapshot={s} /></Section>
          <Section title="Period lock" aside={s.event.locked ? "This event is locked" : undefined}>
            <PeriodLockForm snapshot={s} permission={canControl(s.actor, s)} />
          </Section>
          {s.actor.role !== "attendee" ? (
            <Section title="Team">
              <TeamSection snapshot={s} />
            </Section>
          ) : null}
          {s.actor.role !== "attendee" ? (
            <Section title="Accounting exports">
              <AccountingExports />
            </Section>
          ) : null}
          <Section title="Integrations">
            {s.integrationStatus.length ? (
              <ul className="flex flex-col divide-y rounded-xl border">
                {s.integrationStatus.map((i) => (
                  <li key={i.name} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{i.name}</span>
                      <span className="text-small text-muted-foreground">{i.detail}</span>
                    </span>
                    <ModeLabel mode={i.mode} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted-foreground">No integrations reported.</p>
            )}
          </Section>
          {s.demo ? (
            <Section title="Sample data">
              <p className="text-small text-muted-foreground">Resetting deletes and reseeds only the sample organization. Real organizations are never touched.</p>
              {resetConfirm ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton variant="destructive" label="Confirm reset" pendingLabel="Resetting" onDone={() => setResetConfirm(false)} call={payloads.demoReset()} />
                  <ActionButton variant="ghost" label="Keep current data" call={() => { setResetConfirm(false); return null; }} />
                </div>
              ) : (
                <ActionButton className="self-start" label="Reset sample data" permission={canManage(s.actor)} call={() => { setResetConfirm(true); return null; }} />
              )}
            </Section>
          ) : null}
        </div>
      )}
    </PageFrame>
  );
}

function ReadOnlyNote({ permission }: { permission: Permission }) {
  if (permission.allowed) return null;
  return (
    <p className="rounded-lg border border-dashed border-input px-4 py-3 text-small text-muted-foreground">
      {permission.reason} Fields are shown for reference; saving is locked.
    </p>
  );
}

function ModeLabel({ mode }: { mode: string }) {
  const m = mode.toLowerCase();
  if (m.includes("test")) return <TruthLabel kind="test" />;
  if (m.includes("estimate")) return <TruthLabel kind="estimate" />;
  return <span className="text-small text-muted-foreground">{mode}</span>;
}
