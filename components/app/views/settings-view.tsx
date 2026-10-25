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
import { SlackSection } from "@/components/app/slack-section";
import { TeamSection } from "@/components/app/team-section";
import { TruthLabel } from "@/components/eve/truth-label";
import { Badge } from "@/components/ui/badge";
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
        <div className="flex flex-col gap-4">
          <ReadOnlyNote permission={canOrganize(s.actor)} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title="Organization"><OrgIdentityForm snapshot={s} /></Card>
              <Card title="Approval limits">
                <BooksCurrencyNote snapshot={s} />
                <LimitsForm snapshot={s} />
              </Card>
              <Card title="Money movement"><MoneyMovementForm snapshot={s} /></Card>
              <Card title="Travel policy"><TravelPolicyForm snapshot={s} /></Card>
              <Card title="Period lock" aside={s.event.locked ? <Badge variant="secondary">Locked</Badge> : undefined}>
                <PeriodLockForm snapshot={s} permission={canControl(s.actor, s)} />
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {s.actor.role !== "attendee" ? <Card title="Team"><TeamSection snapshot={s} /></Card> : null}
              <Card title="Notifications"><NotificationsForm snapshot={s} /></Card>
              {s.slack ? <Card title="Slack"><SlackSection snapshot={s} /></Card> : null}
              <Card title="Integrations">
                {s.integrationStatus.length ? (
                  <ul className="flex flex-col divide-y">
                    {s.integrationStatus.map((i) => (
                      <li key={i.name} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{i.name}</span>
                          <span className="text-caption text-muted-foreground">{i.detail}</span>
                        </span>
                        <ModeLabel mode={i.mode} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">No integrations reported.</p>
                )}
              </Card>
              {s.actor.role !== "attendee" ? <Card title="Accounting exports"><AccountingExports /></Card> : null}
              {s.demo ? (
                <Card title="Sample data">
                  <p className="text-small text-muted-foreground">Reseeds the sample organization only.</p>
                  {resetConfirm ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton variant="destructive" label="Confirm reset" pendingLabel="Resetting" onDone={() => setResetConfirm(false)} call={payloads.demoReset()} />
                      <ActionButton variant="ghost" label="Keep current data" call={() => { setResetConfirm(false); return null; }} />
                    </div>
                  ) : (
                    <ActionButton className="self-start" label="Reset sample data" permission={canManage(s.actor)} call={() => { setResetConfirm(true); return null; }} />
                  )}
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}

function ReadOnlyNote({ permission }: { permission: Permission }) {
  if (permission.allowed) return null;
  return (
    <p className="rounded-lg border border-dashed border-input px-4 py-3 text-small text-muted-foreground">
      {permission.reason} Saving is locked.
    </p>
  );
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Section title={title} aside={aside} className="gap-4 rounded-2xl border bg-surface p-5">
      {children}
    </Section>
  );
}

function ModeLabel({ mode }: { mode: string }) {
  const m = mode.toLowerCase();
  if (m.includes("test")) return <TruthLabel kind="test" />;
  if (m.includes("estimate")) return <TruthLabel kind="estimate" />;
  return <Badge variant={m === "live" ? "positive" : "secondary"}>{mode}</Badge>;
}
