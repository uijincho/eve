"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import type { AppSnapshot, Person } from "@/lib/contracts";
import { awardName, big, prizeOptions, payoutSource, providerLabel, isInKind, payoutValue } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";

import { PortalFrame } from "./portal-frame";

type Todo = { id: string; title: string; detail: string; href: string; dueAt?: string; critical?: string };

function todos(s: AppSnapshot, me: Person): Todo[] {
  const list: Todo[] = [];
  if (!me.adult) list.push({ id: "age", title: "Payments are blocked", detail: "Eve can only pay people who are 18 or older at the event start.", href: "/portal/profile", critical: "Blocked" });
  if (me.taxStatus !== "valid")
    list.push({ id: "tax", title: `Sign your ${me.taxForm}`, detail: me.taxStatus === "expired" ? "Your form has lapsed. Payments wait until you sign a new one." : me.taxStatus === "review" ? "Your form needs review. An organizer may contact you." : "Payments wait until your tax form is signed.", href: "/portal/profile" });
  const frozen = s.payouts.find((p) => p.personId === me.id && p.status === "frozen");
  if (frozen) list.push({ id: "frozen", title: "Confirm your new bank details", detail: "Enter the code we sent to your original email. Your payout is frozen until then.", href: "/portal/payouts", dueAt: frozen.dueAt, critical: "Frozen" });
  if (!me.payoutLast4) list.push({ id: "bank", title: "Add a payout account", detail: `Choose where to receive money, in ${me.payoutCurrency || "your currency"}.`, href: "/portal/payouts" });
  for (const a of s.awards.filter((x) => x.personId === me.id)) {
    if (a.kind === "item" && a.fulfillment === "undecided") list.push({ id: `a-${a.id}`, title: `Choose how to receive your ${a.title}`, detail: a.recommendation || "Ship it, buy it locally, or take cash.", href: "/portal/prizes", dueAt: a.dueAt });
    if (a.teamId && !a.splitConfirmed) list.push({ id: `s-${a.id}`, title: "Confirm your team's split", detail: `${a.track}: every member confirms before payment.`, href: "/portal/prizes", dueAt: a.dueAt });
  }
  for (const c of s.claims.filter((x) => x.personId === me.id && x.status === "needs_info"))
    list.push({ id: `c-${c.id}`, title: `Answer a question about claim ${c.id}`, detail: c.reason, href: "/portal/claims", dueAt: c.dueAt });
  return list;
}

export function PortalOverview() {
  return (
    <PortalFrame title="Your event money" lede="Everything Eve needs from you, and what you will receive. Amounts marked est. can change with exchange rates.">
      {(s, me) => {
        const list = todos(s, me);
        const mine = s.payouts.filter((p) => p.personId === me.id);
        const notices = s.notices.filter((n) => n.personId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const awards = s.awards.filter((a) => a.personId === me.id && !mine.some((p) => p.sourceId === a.id));
        return (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h2 className="text-subheading">{list.length ? `${list.length} ${list.length === 1 ? "thing needs" : "things need"} you` : "Nothing needs you right now"}</h2>
                {list.length ? (
                  <ul className="flex flex-col divide-y rounded-xl border">
                    {list.map((t) => (
                      <li key={t.id}>
                        <Link href={t.href} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface">
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-2 font-semibold">{t.title}{t.critical ? <StatusBadge status="frozen" label={t.critical} /> : null}</span>
                            <span className="text-small text-muted-foreground">{t.detail}</span>
                          </span>
                          {t.dueAt ? <DueChip due={t.dueAt} now={s.now} align="end" /> : <span />}
                          <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">Your profile, forms, and payout account are complete.</p>
                )}
              </section>
              <section className="flex flex-col gap-3">
                <h2 className="text-subheading">What you will receive</h2>
                {mine.length || awards.length ? (
                  <ul className="flex flex-col divide-y rounded-xl border">
                    {mine.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <span className="flex flex-col">
                          <span className="font-medium">{p.sourceType === "award" ? "Prize" : "Reimbursement"} · {payoutSource(s, p)}</span>
                          <span className="text-small text-muted-foreground">{p.status === "paid" ? `Paid ${fmtDateTime(p.paidAt)}` : p.reason || providerLabel(p.provider)}</span>
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <Money amountMinor={isInKind(p) ? payoutValue(p) : big(p.destinationNetMinor)} currency={isInKind(p) ? p.currency : p.destinationCurrency} estimate={!isInKind(p) && p.status !== "paid"} className="font-semibold" />
                          <StatusBadge status={p.status} />
                        </span>
                      </li>
                    ))}
                    {awards.map((a) => {
                      const o = prizeOptions(s, a, me);
                      return (
                        <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <span className="flex flex-col">
                            <span className="font-medium">{awardName(a, " · ")}</span>
                            <span className="text-small text-muted-foreground">Not proposed yet</span>
                          </span>
                          <Money amountMinor={o.cashNet} currency={a.currency} estimate className="font-semibold" />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">No payments yet. Approved claims and prizes appear here with the amount you will actually receive.</p>
                )}
              </section>
            </div>
            <section className="flex flex-col gap-3">
              <h2 className="text-subheading">Messages</h2>
              {notices.length ? (
                <ol className="flex flex-col gap-4">
                  {notices.slice(0, 8).map((n) => (
                    <li key={n.id} className="flex flex-col gap-0.5 border-b pb-3 text-small last:border-b-0">
                      <span className="font-medium">{n.title}</span>
                      <span className="whitespace-pre-line text-muted-foreground">{n.body}</span>
                      <span className="text-caption text-faint">{fmtDateTime(n.createdAt)} · {n.channel}{n.status === "simulated" ? " · simulated delivery" : ""}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-small text-muted-foreground">Reminders and confirmations from Eve appear here and in your email.</p>
              )}
            </section>
          </div>
        );
      }}
    </PortalFrame>
  );
}
