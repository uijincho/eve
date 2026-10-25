"use client";

import { useState } from "react";
import { Monitor } from "lucide-react";
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
  preparing: "Preparing documents", filling: "Submitting in browser", submitting: "Recording confirmation",
  submitted: "Submitted · awaiting payment", failed: "Needs attention", cancelled: "Cancelled",
};

export function BatchProgress({ batch: b }: { batch: DisbursementBatch }) {
  const preparing = b.status === "preparing";
  const label = b.validating ? "Checking payments before submission"
    : preparing && b.packetIds.length === b.count ? "Building upload bundle"
    : b.status === "filling" && !b.streamUrl ? "Opening browser"
    : STATUS[b.status];
  const awaitingBrowser = !b.streamUrl && (preparing || b.status === "filling");
  return <div className="flex flex-col gap-3">
    <p role="status" className={b.status === "failed" ? "text-critical" : "text-muted-foreground"}>
      {label}{preparing && !b.validating ? ` · ${b.packetIds.length} of ${b.count} packets saved` : ""}
    </p>
    {awaitingBrowser ? <div className="flex items-start gap-3 border-t pt-3 text-small text-muted-foreground">
      <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{preparing ? "Browser preview starts after preparation" : "Connecting to the live browser"}</p>
        <p>{b.validating ? `Eve is checking all ${b.count} payments. The live browser will appear here when submission starts.`
          : preparing ? "Eve prepares the documents first, then submits the whole batch in one browser session."
          : "The live view will appear here automatically. You can enlarge it to follow the upload and submission."}</p>
      </div>
    </div> : null}
  </div>;
}

const BATCH_LIMIT = 200;

export function DisbursementBatches({ snapshot: s }: { snapshot: AppSnapshot }) {
  // The controller picks each payment; nothing is included until it is ticked.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const batches = s.batches ?? [];
  const reserved = new Set(batches.filter((b) => b.status !== "cancelled").flatMap((b) => b.payoutIds));
  const pending = s.payouts.filter((p) => !reserved.has(p.id) && !["paid", "processing"].includes(p.status));
  const ready = pending.filter((p) => !batchBlocker(p, s));
  const selected = ready.filter((p) => picked.has(p.id));
  const blocked = pending.filter((p) => batchBlocker(p, s));
  const gross = selected.reduce((n, p) => n + big(p.grossMinor), 0n);
  const withheld = selected.reduce((n, p) => n + big(p.withholdingMinor), 0n);
  const selectable = ready.slice(0, BATCH_LIMIT);
  const allChosen = selectable.length > 0 && selectable.every((p) => picked.has(p.id));
  const permission = selected.length > BATCH_LIMIT ? { allowed: false as const, reason: `Choose ${BATCH_LIMIT} payments or fewer per batch.` }
    : selected.length ? canControl(s.actor, s) : { allowed: false as const, reason: "Select at least one payment to release." };
  const toggle = (id: string, on: boolean) => setPicked((before) => { const next = new Set(before); if (on) next.add(id); else next.delete(id); return next; });
  return <>
    <section aria-label="Release a batch" className="flex flex-col gap-4 rounded-2xl border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-subheading">{selected.length ? `${selected.length} of ${ready.length} selected` : `${ready.length} payments ready to release`}</h2>
          <Money amountMinor={gross - withheld} className="text-title font-semibold" />
          <p className="text-small text-muted-foreground">{selected.length ? `Eve prepares the documents for the selected payments and submits them as one batch to ${s.org.sponsorName || "the sponsor"}. The rest stay ready.` : "Tick the payments you want to send in this batch."}</p>
        </div>
        <ActionButton label={selected.length ? `Release ${selected.length} selected` : "Release selected"} pendingLabel="Preparing batch" variant="default" size="default" permission={permission}
          onDone={(r) => r.ok && setPicked(new Set())}
          call={payloads.batchRelease(selected.map((p) => ({ id: p.id, quote: batchQuoteKey(p) })))} />
      </div>
      <p className="text-small text-muted-foreground">Gross <Money amountMinor={gross} /> · Withheld <Money amountMinor={withheld} /> · No payment is marked paid until remittance is reconciled.</p>
      {ready.length > BATCH_LIMIT ? <p className="text-small">A batch holds up to {BATCH_LIMIT} payments. Release the rest in another batch.</p> : null}
      <div className="flex flex-col">
        {ready.length ? <label className="flex items-center gap-3 border-b py-2 text-small font-medium">
          <input type="checkbox" checked={allChosen} ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allChosen; }}
            onChange={(e) => setPicked(e.target.checked ? new Set(selectable.map((p) => p.id)) : new Set())} className="size-4 shrink-0 accent-foreground" />
          {ready.length > BATCH_LIMIT ? `Select the first ${BATCH_LIMIT}` : `Select all ${ready.length}`}
        </label> : null}
        <ul className="divide-y">
          {ready.map((p) => <li key={p.id} className="flex items-center gap-3 py-3">
            <input type="checkbox" aria-label={`Include ${p.personName}, ${payoutSource(s, p)}`} checked={picked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} className="size-4 shrink-0 accent-foreground" />
            <span className="min-w-0 flex-1"><span className="font-medium">{p.personName}</span><span className="block text-small text-muted-foreground">{payoutSource(s, p)}</span></span>
            <Money amountMinor={big(p.grossMinor) - big(p.withholdingMinor)} />
          </li>)}
          {!ready.length ? <li className="py-3 text-small text-muted-foreground">Approved, eligible payouts appear here automatically.</li> : null}
        </ul>
      </div>
      {blocked.length ? <details><summary className="cursor-pointer py-1 text-small font-medium">{blocked.length} payments excluded · need attention</summary><ul className="mt-2 divide-y">
        {blocked.map((p) => <li key={p.id} className="flex flex-col gap-1 py-2"><span className="font-medium">{p.personName}</span><span className="text-small text-muted-foreground">{batchBlocker(p, s)}</span></li>)}
      </ul></details> : null}
    </section>
    {batches.length ? <Section title="Batches">
      <div className="flex flex-col gap-4">{batches.map((b) => {
        const paid = b.packetIds.filter((id) => s.packets.some((p) => p.id === id && p.status === "paid")).length;
        return <section key={b.id} aria-label={`Batch of ${b.count} payments`} className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">{b.count} payments · <Money amountMinor={big(b.netMinor)} /></h3>{b.status === "submitted" && paid === b.count ? <span>Paid</span> : null}</div>
          {b.status !== "submitted" || paid !== b.count ? <BatchProgress batch={b} /> : null}
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
