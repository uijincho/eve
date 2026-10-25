"use client";

import { useState } from "react";
import { ActionButton } from "@/components/app/action-button";
import { LinkButton } from "@/components/app/link-button";
import { LiveDesktop } from "@/components/app/live-desktop";
import { Section } from "@/components/app/page-header";
import { Money } from "@/components/eve/money";
import type { AppSnapshot, DisbursementBatch } from "@/lib/contracts";
import { documentUrl } from "@/lib/client/api";
import { big, canControl, payoutSource } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";
import { batchBlocker, batchQuoteKey } from "@/lib/disbursement";

const STATUS: Record<DisbursementBatch["status"], string> = {
  preparing: "Preparing documents", filling: "Uploading to portal", submitting: "Submitting batch",
  submitted: "Submitted · awaiting payment", failed: "Needs attention", cancelled: "Cancelled",
};

export function DisbursementBatches({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const batches = s.batches ?? [];
  const reserved = new Set(batches.filter((b) => b.status !== "cancelled").flatMap((b) => b.payoutIds));
  const pending = s.payouts.filter((p) => !reserved.has(p.id) && !["paid", "processing"].includes(p.status));
  const ready = pending.filter((p) => !batchBlocker(p, s));
  const selected = ready.filter((p) => !excluded.has(p.id)).slice(0, 200);
  const blocked = pending.filter((p) => batchBlocker(p, s));
  const gross = selected.reduce((n, p) => n + big(p.grossMinor), 0n);
  const withheld = selected.reduce((n, p) => n + big(p.withholdingMinor), 0n);
  const permission = selected.length ? canControl(s.actor, s) : { allowed: false as const, reason: "Select at least one eligible payment." };
  return <>
    <section aria-label="Release a batch" className="flex flex-col gap-4 rounded-2xl border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-subheading">{selected.length} payments ready to release</h2>
          <Money amountMinor={gross - withheld} className="text-title font-semibold" />
          <p className="text-small text-muted-foreground">Eve prepares the documents and submits one batch to {s.org.sponsorName || "the sponsor"}.</p>
        </div>
        <ActionButton label={`Release ${selected.length} payments`} pendingLabel="Preparing batch" variant="default" size="default" permission={permission}
          call={payloads.batchRelease(selected.map((p) => ({ id: p.id, quote: batchQuoteKey(p) })))} />
      </div>
      <p className="text-small text-muted-foreground">Gross <Money amountMinor={gross} /> · Withheld <Money amountMinor={withheld} /> · No payment is marked paid until remittance is reconciled.</p>
      {ready.length > 200 ? <p className="text-small">The first 200 selected payments will be included. Release the remaining payments in another batch.</p> : null}
      <details>
        <summary className="cursor-pointer py-1 text-small font-medium">Review recipients ({ready.length})</summary>
        <ul className="mt-2 divide-y">
          {ready.map((p) => <li key={p.id} className="flex items-center gap-3 py-3">
            <input type="checkbox" aria-label={`Include ${p.personName}, ${payoutSource(s, p)}`} checked={selected.some((item) => item.id === p.id)} onChange={(e) => setExcluded((before) => { const next = new Set(before); if (e.target.checked) next.delete(p.id); else next.add(p.id); return next; })} className="size-4 shrink-0 accent-foreground" />
            <span className="min-w-0 flex-1"><span className="font-medium">{p.personName}</span><span className="block text-small text-muted-foreground">{payoutSource(s, p)}</span></span>
            <Money amountMinor={big(p.grossMinor) - big(p.withholdingMinor)} />
          </li>)}
          {!ready.length ? <li className="py-3 text-small text-muted-foreground">Approved, eligible payouts appear here automatically.</li> : null}
        </ul>
      </details>
      {blocked.length ? <details><summary className="cursor-pointer py-1 text-small font-medium">{blocked.length} payments excluded · need attention</summary><ul className="mt-2 divide-y">
        {blocked.map((p) => <li key={p.id} className="flex flex-col gap-1 py-2"><span className="font-medium">{p.personName}</span><span className="text-small text-muted-foreground">{batchBlocker(p, s)}</span></li>)}
      </ul></details> : null}
    </section>
    {batches.length ? <Section title="Batches">
      <div className="flex flex-col gap-4">{batches.map((b) => {
        const paid = b.packetIds.filter((id) => s.packets.some((p) => p.id === id && p.status === "paid")).length;
        return <section key={b.id} aria-label={`Batch of ${b.count} payments`} className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">{b.count} payments · <Money amountMinor={big(b.netMinor)} /></h3><span aria-live="polite" className={b.status === "failed" ? "text-critical" : "text-muted-foreground"}>{b.status === "submitted" && paid === b.count ? "Paid" : b.validating ? "Checking payments before submission" : STATUS[b.status]}</span></div>
          {b.validating ? <p className="text-small text-muted-foreground">Eve is checking all {b.count} payments against the controller’s release before submitting automatically.</p> : null}
          <p className="text-small text-muted-foreground">Released by {b.approvedByName}{b.status === "submitted" ? ` · ${paid} of ${b.count} paid` : ""}</p>
          {b.error ? <p className="text-small text-critical">{b.error}</p> : null}
          {b.confirmation ? <p className="text-small">Portal confirmation: <strong>{b.confirmation}</strong></p> : null}
          {b.streamUrl ? <LiveDesktop
            src={b.streamUrl}
            title={`Live portal submission for ${b.count} payments, view only`}
            caption={`${b.provider === "browser-use" ? "Browser Use" : "Eve"} is submitting ${b.count} payments in one portal session. Live view only.`}
            className="w-full max-w-3xl"
          /> : null}
          <div className="flex flex-wrap gap-2">
            {b.documentId ? <LinkButton href={documentUrl(b.documentId)} external size="sm" variant="outline">Download bundle</LinkButton> : null}
            {b.canRetry ? <ActionButton label="Retry batch" pendingLabel="Restarting" permission={s.actor.id === b.approvedBy ? canControl(s.actor, s) : { allowed: false, reason: "The controller who released this batch must retry it." }} call={payloads.batchRetry(b.id)} /> : null}
            {b.canCancel ? <ActionButton label="Cancel batch" pendingLabel="Cancelling" variant="outline" permission={canControl(s.actor, s)} call={payloads.batchCancel(b.id)} /> : null}
          </div>
          <details><summary className="cursor-pointer text-small">View batch payments</summary><ul className="mt-2 divide-y">{b.payoutIds.map((id) => {
            const p = s.payouts.find((row) => row.id === id); const packet = s.packets.find((row) => row.payoutId === id);
            return <li key={id} className="flex flex-wrap justify-between gap-2 py-2 text-small"><span>{p?.personName ?? "Payment"} · {p ? payoutSource(s, p) : id}</span><span>{packet?.status === "draft" ? "Awaiting submission" : packet?.status ?? (b.status === "preparing" ? "Preparing packet" : "Needs review")}</span></li>;
          })}</ul></details>
        </section>;
      })}</div>
    </Section> : null}
  </>;
}
