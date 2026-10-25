"use client";

import { DownloadIcon, LoaderCircleIcon, ScrollTextIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { PayoutBreakdown } from "@/components/app/inbox/item-detail";
import { heldOnUnverifiedRule, ResolvePayoutRule } from "@/components/app/resolve-rule";
import { LinkButton } from "@/components/app/link-button";
import { BooksCurrencyNote } from "@/components/app/books-currency-note";
import { PageFrame } from "@/components/app/page-frame";
import { VerifyCode } from "@/components/app/verify-code";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import { Button } from "@/components/ui/button";
import type { AppSnapshot, Payout } from "@/lib/contracts";
import { exportUrl } from "@/lib/client/api";
import { big, canControl, canManage, canRelease, payoutSource, type Permission, providerLabel, releaseInFlight, releaseStopped, sumMinor, payoutValue, isInKind, sponsorOwner, sponsorOwnerNote } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";
import { initialParam } from "@/lib/client/url-param";

type Filter = "release" | "attention" | "processing" | "paid" | "all";
const ATTENTION = ["frozen", "failed", "returned", "held"];

const unpaidReady = (p: Payout) => p.status === "proposed" || p.status === "approved";
/** Ready, and no sponsor batch or packet owns it, so it can be released here. */
const readyHere = (s: AppSnapshot, p: Payout) => unpaidReady(p) && !sponsorOwner(s, p);
/** Ready, but a sponsor batch or packet owns it; Disburse follows it. */
const inSponsorBatch = (s: AppSnapshot, p: Payout) => unpaidReady(p) && !!sponsorOwner(s, p);

export function PayoutsView() {
  const [filter, setFilter] = useState<Filter>("release");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => initialParam("payout"));
  const [evidence, setEvidence] = useState<Payout | null>(null);

  return (
    <PageFrame
      title="Payouts"
      lede={(s) => `${s.payouts.filter((p) => readyHere(s, p)).length} ready for the controller.`}
      actions={() => (
        <LinkButton href={exportUrl("payouts")} external variant="outline">
          <DownloadIcon aria-hidden />
          Export CSV
        </LinkButton>
      )}
    >
      {(s) => {
        const match = (p: Payout, f: Filter) =>
          f === "all"
            ? true
            : f === "release"
              ? readyHere(s, p)
              : f === "attention"
                ? ATTENTION.includes(p.status)
                : f === "processing"
                  ? p.status === "processing" || inSponsorBatch(s, p)
                  : p.status === "paid";
        const rows = s.payouts.filter((p) => match(p, filter));
        const releasable = s.payouts.filter((p) => canRelease(s.actor, p, s).allowed);
        const chosen = releasable.filter((p) => picked.has(p.id));
        const selected = s.payouts.find((p) => p.id === openId);
        const ready = s.payouts.filter((p) => readyHere(s, p));
        const batched = s.payouts.filter((p) => inSponsorBatch(s, p));
        const firstReady = ready[0];
        const blocked: Permission | undefined = !releasable.length && firstReady ? canRelease(s.actor, firstReady, s) : undefined;
        const allChosen = releasable.length > 0 && chosen.length === releasable.length;
        const toggle = (id: string, on: boolean) =>
          setPicked((x) => {
            const n = new Set(x);
            if (on) n.add(id);
            else n.delete(id);
            return n;
          });

        const columns: Column<Payout>[] = [
          { key: "who", header: "Recipient", stack: "title", sort: (p) => p.personName, cell: (p) => p.personName },
          { key: "src", header: "For", stack: "meta", cell: (p) => payoutSource(s, p) },
          { key: "status", header: "Status", stack: "end", sort: (p) => p.status, cell: (p) => (inSponsorBatch(s, p) ? <StatusBadge status="processing" label="In sponsor batch" /> : <StatusBadge status={p.status} />) },
          { key: "gross", header: "Gross", align: "end", stack: "hide", sort: (p) => big(p.grossMinor), cell: (p) => <Money amountMinor={big(p.grossMinor)} currency={p.currency} /> },
          { key: "wh", header: "Withheld", align: "end", stack: "hide", cell: (p) => <Money amountMinor={-big(p.withholdingMinor)} currency={p.currency} signDisplay="exceptZero" /> },
          {
            key: "net",
            header: "Net received",
            align: "end",
            stack: "end",
            sort: (p) => payoutValue(p),
            cell: (p) => (
              <span className="flex flex-col items-end">
                <Money amountMinor={payoutValue(p)} currency={p.currency} className="font-semibold" />
                {p.destinationCurrency !== p.currency && !isInKind(p) ? (
                  <Money amountMinor={big(p.destinationNetMinor)} currency={p.destinationCurrency} estimate={p.status !== "paid"} className="text-caption text-muted-foreground" />
                ) : null}
              </span>
            ),
          },
          { key: "due", header: "Due", align: "end", stack: "hide", sort: (p) => p.dueAt, cell: (p) => (p.status === "paid" ? <span className="text-small text-muted-foreground">{fmtDateTime(p.paidAt)}</span> : <DueChip due={p.dueAt} now={s.now} align="end" />) },
        ];

        return (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterChips
                label="Status"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "release", label: "Ready to release", count: s.payouts.filter((p) => match(p, "release")).length },
                  { value: "attention", label: "Frozen, held, failed", count: s.payouts.filter((p) => match(p, "attention")).length },
                  { value: "processing", label: "Processing or in a batch", count: s.payouts.filter((p) => match(p, "processing")).length },
                  { value: "paid", label: "Paid", count: s.payouts.filter((p) => match(p, "paid")).length },
                  { value: "all", label: "All", count: s.payouts.length },
                ]}
              />
            </div>

            <BooksCurrencyNote snapshot={s} />
            {filter === "release" ? (
              <div className="flex flex-col gap-3 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {chosen.length ? `${chosen.length} of ${releasable.length} selected · ` : ""}
                    <Money amountMinor={sumMinor((chosen.length ? chosen : releasable.length ? releasable : ready).map((p) => p.netMinor))} /> net
                  </span>
                  <span className="text-small text-muted-foreground">
                    {chosen.length
                      ? "Only the selected payouts are sent by wire. The rest stay ready."
                      : releasable.length
                        ? "Tick the payouts you want to release."
                        : ready.length
                          ? `${ready.length} ${ready.length === 1 ? "payout is" : "payouts are"} waiting for a controller.`
                          : "Nothing is waiting for release."}
                  </span>
                  {batched.length ? (
                    <span className="text-small text-muted-foreground">
                      {batched.length} more {batched.length === 1 ? "is" : "are"} already in a sponsor batch.{" "}
                      <Link href="/sponsor" className="font-medium text-foreground underline underline-offset-2">
                        Follow on Disburse
                      </Link>
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {releasable.length ? (
                    <Button size="default" variant="ghost" onClick={() => setPicked(allChosen ? new Set() : new Set(releasable.map((p) => p.id)))}>
                      {allChosen ? "Clear selection" : `Select all ${releasable.length}`}
                    </Button>
                  ) : null}
                  <ActionButton
                    size="default"
                    variant="default"
                    label={chosen.length ? `Release ${chosen.length} selected` : "Release selected"}
                    pendingLabel="Releasing"
                    permission={blocked ?? (!releasable.length ? { allowed: false, reason: "No payouts are ready to release." } : chosen.length ? { allowed: true } : { allowed: false, reason: "Select at least one payout to release." })}
                    onDone={(r) => r.ok && setPicked(new Set())}
                    call={payloads.payoutRelease(chosen.map((p) => p.id))}
                  />
                </div>
              </div>
            ) : null}

            <DataTable
              label="Payouts"
              rows={rows}
              columns={columns}
              rowKey={(p) => p.id}
              onRowClick={(p) => setOpenId(p.id)}
              selectedKey={openId}
              initialSort={{ key: "due", dir: "asc" }}
              leading={
                filter === "release" && releasable.length
                  ? {
                      header: (
                        <input
                          type="checkbox"
                          aria-label="Select all releasable payouts"
                          className="size-4 accent-foreground"
                          checked={allChosen}
                          ref={(el) => {
                            if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                          }}
                          onChange={(e) => setPicked(e.target.checked ? new Set(releasable.map((p) => p.id)) : new Set())}
                        />
                      ),
                      cell: (p) =>
                        canRelease(s.actor, p, s).allowed ? (
                          <input
                            type="checkbox"
                            aria-label={`Select payout to ${p.personName}, ${payoutSource(s, p)}`}
                            className="size-4 accent-foreground"
                            checked={picked.has(p.id)}
                            onChange={(e) => toggle(p.id, e.target.checked)}
                          />
                        ) : null,
                    }
                  : undefined
              }
              empty={<EmptyState title="No payouts here">Payouts appear when an approved claim or a prize with a valid tax form is proposed.</EmptyState>}
            />

            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected?.personName ?? "Payout"} description={selected ? payoutSource(s, selected) : undefined}>
              {selected ? <PayoutDetail payout={selected} snapshot={s} onEvidence={() => setEvidence(selected)} /> : null}
            </Sheet>
            <EvidenceSheet open={evidence !== null} onOpenChange={(o) => !o && setEvidence(null)} title={evidence ? `Payout ${evidence.id}` : "Evidence"} objectIds={evidence ? [evidence.id, evidence.sourceId] : []} />
          </>
        );
      }}
    </PageFrame>
  );
}

function PayoutDetail({ payout: p, snapshot: s, onEvidence }: { payout: Payout; snapshot: AppSnapshot; onEvidence: () => void }) {
  const release = canRelease(s.actor, p, s);
  const manage = canManage(s.actor);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {p.status === "paid" ? (
          <p className="text-small text-muted-foreground">Paid {fmtDateTime(p.paidAt)}</p>
        ) : releaseInFlight(s, p) ? (
          <p className="flex items-center gap-2 text-small text-muted-foreground" role="status">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
            Release accepted. Sending through {providerLabel(p.provider)}; this updates on its own.
          </p>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={p.status} />
            <DueChip due={p.dueAt} now={s.now} context="release" inline />
          </span>
        )}
        {p.reason ? <p className="text-small text-muted-foreground">{p.reason}</p> : null}
      </div>
      {releaseStopped(s, p) ? (
        <p role="alert" className="text-small text-critical">Release stopped: {releaseStopped(s, p)!.summary}</p>
      ) : null}
      <PayoutBreakdown payout={p} showStatus={p.status === "paid" || releaseInFlight(s, p)} />
      <div className="flex flex-col gap-2 border-t pt-4">
        {p.status === "frozen" ? (
          <VerifyCode personId={p.personId} personName={p.personName} permission={manage} primary />
        ) : p.status === "failed" || p.status === "returned" ? (
          <ActionButton wide size="default" variant="default" label="Retry payout" pendingLabel="Retrying" permission={canControl(s.actor, s)} call={payloads.payoutRetry(p.id)} />
        ) : heldOnUnverifiedRule(s, p) ? (
          <ResolvePayoutRule payout={p} snapshot={s} />
        ) : unpaidReady(p) && sponsorOwner(s, p) ? (
          <>
            <p className="text-small text-muted-foreground">{sponsorOwnerNote(s, p)}</p>
            <LinkButton href="/sponsor" size="default" variant="secondary" className="self-start">
              Open Disburse
            </LinkButton>
          </>
        ) : p.status === "proposed" || p.status === "approved" || p.status === "held" ? (
          <ActionButton wide size="default" variant="default" label="Release payout" pendingLabel="Releasing" permission={release} call={payloads.payoutRelease([p.id])} />
        ) : null}
        <Button size="sm" variant="ghost" className="-ml-2.5 self-start" onClick={onEvidence}>
          <ScrollTextIcon aria-hidden />
          Evidence
        </Button>
      </div>
    </div>
  );
}
