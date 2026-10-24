"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { DataTable, type Column } from "@/components/app/data-table";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { Section } from "@/components/app/page-header";
import { ReasonAction } from "@/components/app/reason-action";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import type { AppSnapshot, SponsorPacket } from "@/lib/contracts";
import { documentUrl, exportUrl } from "@/lib/client/api";
import { big, canManage } from "@/lib/client/derive";
import { fmtDate } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";

export function SponsorView() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <PageFrame
      title="Sponsor"
      lede={(s) => `${s.org.sponsorName} holds the bank account and pays within about ${s.org.sponsorTurnaroundDays} days. Eve prepares each packet; remittance differences stay open until someone reconciles them.`}
    >
      {(s) => {
        if (s.org.mode === "direct")
          return <EmptyState title="Sponsor packets are off">This organization pays directly. Switch to sponsor or hybrid mode in Settings to send packets to a fiscal sponsor.</EmptyState>;
        const packeted = new Set(s.packets.map((k) => k.payoutId));
        const candidates = s.payouts.filter((p) => (p.status === "approved" || p.status === "proposed") && !packeted.has(p.id));
        const selected = s.packets.find((k) => k.id === openId);
        const columns: Column<SponsorPacket>[] = [
          { key: "id", header: "Packet", stack: "title", sort: (k) => k.id, cell: (k) => `${k.id} · ${k.personName}` },
          { key: "sub", header: "Submitted", stack: "meta", sort: (k) => k.submittedAt ?? "", cell: (k) => (k.submittedAt ? `Submitted ${fmtDate(k.submittedAt)}` : "Not submitted") },
          { key: "status", header: "Status", stack: "end", sort: (k) => k.status, cell: (k) => <StatusBadge status={k.status} /> },
          { key: "req", header: "Requested", align: "end", stack: "hide", sort: (k) => big(k.requestedMinor), cell: (k) => <Money amountMinor={big(k.requestedMinor)} /> },
          { key: "paid", header: "Remitted", align: "end", stack: "end", sort: (k) => big(k.paidMinor), cell: (k) => <Money amountMinor={big(k.paidMinor)} className={big(k.paidMinor) !== big(k.requestedMinor) && k.status !== "draft" && k.status !== "submitted" ? "font-semibold text-critical" : "font-semibold"} /> },
          { key: "due", header: "Aging", align: "end", stack: "hide", sort: (k) => k.dueAt, cell: (k) => <DueChip due={k.dueAt} now={s.now} align="end" /> },
        ];
        return (
          <>
            <div className="flex items-center gap-2">
              <TruthLabel kind="simulated" />
              <span className="text-small text-muted-foreground">The sponsor is a simulated counterparty for this demo.</span>
            </div>
            <DataTable label="Sponsor packets" rows={s.packets} columns={columns} rowKey={(k) => k.id} onRowClick={(k) => setOpenId(k.id)} selectedKey={openId} initialSort={{ key: "due", dir: "asc" }} empty={<EmptyState title="No packets yet">Approved payouts in sponsor mode become packets with the request and its supporting documents.</EmptyState>} />
            {candidates.length ? (
              <Section title="Ready for a packet" aside={`${candidates.length} approved payouts`}>
                <ul className="flex flex-col divide-y rounded-xl border">
                  {candidates.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <span className="flex flex-col">
                        <span className="font-medium">{p.personName}</span>
                        <span className="text-small text-muted-foreground">{p.id} · {p.sourceType === "award" ? "prize" : "claim"} {p.sourceId}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Money amountMinor={big(p.grossMinor)} currency={p.currency} className="font-semibold" />
                        <ActionButton label="Create packet" pendingLabel="Creating" permission={canManage(s.actor)} call={payloads.sponsorCreate(p.id)} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected ? `Packet ${selected.id}` : "Packet"} description={selected?.personName}>
              {selected ? <PacketDetail packet={selected} snapshot={s} /> : null}
            </Sheet>
          </>
        );
      }}
    </PageFrame>
  );
}

function PacketDetail({ packet: k, snapshot: s }: { packet: SponsorPacket; snapshot: AppSnapshot }) {
  const manage = canManage(s.actor);
  const diff = big(k.paidMinor) - big(k.requestedMinor);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={k.status} />
        <DueChip due={k.dueAt} now={s.now} context="expected remittance" />
      </div>
      {k.reason ? <p className="text-small">{k.reason}</p> : null}
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-muted-foreground">Requested</dt>
        <dd className="text-right"><Money amountMinor={big(k.requestedMinor)} /></dd>
        <dt className="text-muted-foreground">Remitted</dt>
        <dd className="text-right"><Money amountMinor={big(k.paidMinor)} /></dd>
        {diff !== 0n && (k.status === "exception" || k.status === "paid" || k.status === "questioned") ? (
          <>
            <dt className="font-semibold">Difference</dt>
            <dd className="text-right font-semibold text-critical"><Money amountMinor={diff} signDisplay="exceptZero" /></dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Payout</dt>
        <dd className="text-right">{k.payoutId}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <LinkButton href={k.documentId ? documentUrl(k.documentId) : exportUrl("packet", k.id)} external target="_blank" size="sm" variant="outline">
          <DownloadIcon aria-hidden />
          Download packet
        </LinkButton>
      </div>
      <div className="flex flex-col gap-2 border-t pt-4">
        {k.status === "draft" ? (
          <ActionButton wide size="default" variant="default" label="Submit to sponsor" pendingLabel="Submitting" permission={manage} call={payloads.sponsorSubmit(k.id)} />
        ) : k.status === "exception" || k.status === "questioned" ? (
          <>
            <ActionButton wide size="default" variant="default" label="Accept with fee" pendingLabel="Reconciling" permission={manage} call={payloads.sponsorReconcile(k.id, { acceptShortfall: true, note: "Shortfall accepted as the sponsor wire fee" })} />
            {manage.allowed ? <ReasonAction label="Add a note" submitLabel="Save note" pendingLabel="Saving" prompt="Note for the reconciliation record (the exception stays open)" build={(r) => payloads.sponsorReconcile(k.id, { note: r })} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
