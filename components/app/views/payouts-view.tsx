"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { PayoutBreakdown } from "@/components/app/inbox/item-detail";
import { LinkButton } from "@/components/app/link-button";
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
import { big, canControl, canManage, canRelease, sumMinor, type Permission } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";
import { initialParam } from "@/lib/client/url-param";

type Filter = "release" | "attention" | "processing" | "paid" | "all";
const ATTENTION = ["frozen", "failed", "returned", "held"];

export function PayoutsView() {
  const [filter, setFilter] = useState<Filter>("release");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(() => initialParam("payout"));
  const [evidence, setEvidence] = useState<Payout | null>(null);

  return (
    <PageFrame
      title="Payouts"
      lede={(s) => `Eve proposes payouts with withholding, fees, and FX shown up front. Only a controller releases money; ${s.org.mode === "direct" ? "payouts run through the test provider" : "sponsor-mode payouts become packets"}.`}
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
              ? p.status === "proposed" || p.status === "approved"
              : f === "attention"
                ? ATTENTION.includes(p.status)
                : f === "processing"
                  ? p.status === "processing"
                  : p.status === "paid";
        const rows = s.payouts.filter((p) => match(p, filter));
        const releasable = s.payouts.filter((p) => canRelease(s.actor, p, s).allowed);
        const chosen = releasable.filter((p) => picked.has(p.id));
        const selected = s.payouts.find((p) => p.id === openId);
        const firstReady = s.payouts.find((p) => p.status === "proposed" || p.status === "approved");
        const blocked: Permission | undefined = !releasable.length && firstReady ? canRelease(s.actor, firstReady, s) : undefined;

        const columns: Column<Payout>[] = [
          { key: "who", header: "Recipient", stack: "title", sort: (p) => p.personName, cell: (p) => p.personName },
          { key: "src", header: "For", stack: "meta", cell: (p) => `${p.sourceType === "award" ? "Prize" : "Claim"} ${p.sourceId} · ${p.provider}` },
          { key: "status", header: "Status", stack: "end", sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
          { key: "gross", header: "Gross", align: "end", stack: "hide", sort: (p) => big(p.grossMinor), cell: (p) => <Money amountMinor={big(p.grossMinor)} currency={p.currency} /> },
          { key: "wh", header: "Withheld", align: "end", stack: "hide", cell: (p) => <Money amountMinor={-big(p.withholdingMinor)} currency={p.currency} signDisplay="exceptZero" /> },
          {
            key: "net",
            header: "Net received",
            align: "end",
            stack: "end",
            sort: (p) => big(p.netMinor),
            cell: (p) => (
              <span className="flex flex-col items-end">
                <Money amountMinor={big(p.netMinor)} currency={p.currency} className="font-semibold" />
                {p.destinationCurrency !== p.currency ? (
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
                  { value: "processing", label: "Processing", count: s.payouts.filter((p) => match(p, "processing")).length },
                  { value: "paid", label: "Paid", count: s.payouts.filter((p) => match(p, "paid")).length },
                  { value: "all", label: "All", count: s.payouts.length },
                ]}
              />
            </div>

            {filter === "release" ? (
              <div className="flex flex-col gap-3 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {chosen.length ? `${chosen.length} selected · ` : ""}
                    <Money amountMinor={sumMinor((chosen.length ? chosen : releasable).map((p) => p.netMinor))} /> net
                  </span>
                  <span className="text-small text-muted-foreground">
                    {chosen.length ? "Release sends test-mode money through the provider." : releasable.length ? "Select payouts to release, or release all you may release." : "Nothing you can release right now."}
                  </span>
                </div>
                <ActionButton
                  size="default"
                  variant="default"
                  label={chosen.length ? `Release ${chosen.length} ${chosen.length === 1 ? "payout" : "payouts"}` : releasable.length ? `Release all ${releasable.length}` : "Release payouts"}
                  pendingLabel="Releasing"
                  permission={blocked ?? (releasable.length ? { allowed: true } : { allowed: false, reason: "No payouts are ready to release." })}
                  onDone={(r) => r.ok && setPicked(new Set())}
                  call={payloads.payoutRelease((chosen.length ? chosen : releasable).map((p) => p.id))}
                />
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
                          checked={chosen.length === releasable.length && releasable.length > 0}
                          onChange={(e) => setPicked(e.target.checked ? new Set(releasable.map((p) => p.id)) : new Set())}
                        />
                      ),
                      cell: (p) =>
                        canRelease(s.actor, p, s).allowed ? (
                          <input
                            type="checkbox"
                            aria-label={`Select payout to ${p.personName}`}
                            className="size-4 accent-foreground"
                            checked={picked.has(p.id)}
                            onChange={(e) =>
                              setPicked((x) => {
                                const n = new Set(x);
                                if (e.target.checked) n.add(p.id);
                                else n.delete(p.id);
                                return n;
                              })
                            }
                          />
                        ) : null,
                    }
                  : undefined
              }
              empty={<EmptyState title="No payouts here">Payouts appear when an approved claim or a prize with a valid tax form is proposed.</EmptyState>}
            />

            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected ? `Payout ${selected.id}` : "Payout"} description={selected?.personName}>
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
        <DueChip due={p.dueAt} now={s.now} context="release" />
        {p.reason ? <p className="text-small">{p.reason}</p> : null}
      </div>
      <PayoutBreakdown payout={p} />
      <div className="flex flex-col gap-2 border-t pt-4">
        {p.status === "frozen" ? (
          <VerifyCode personId={p.personId} personName={p.personName} permission={manage} primary />
        ) : p.status === "failed" || p.status === "returned" ? (
          <ActionButton wide size="default" variant="default" label="Retry payout" pendingLabel="Retrying" permission={canControl(s.actor, s)} call={payloads.payoutRetry(p.id)} />
        ) : p.status === "proposed" || p.status === "approved" || p.status === "held" ? (
          <ActionButton wide size="default" variant="default" label="Release payout" pendingLabel="Releasing" permission={release} call={payloads.payoutRelease([p.id])} />
        ) : null}
        <Button size="sm" variant="ghost" className="self-start" onClick={onEvidence}>
          View evidence
        </Button>
      </div>
    </div>
  );
}
