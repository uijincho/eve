"use client";

import { DownloadIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { ClaimForm, ClaimOutcome } from "@/components/app/claim-form";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { CheckList, EvidenceSheet } from "@/components/app/evidence-sheet";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { ReasonAction } from "@/components/app/reason-action";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { Evidence } from "@/components/eve/evidence";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Claim } from "@/lib/contracts";
import { documentUrl, exportUrl } from "@/lib/client/api";
import { big, canOrganize, canReview, isOrgBookedFlight, claimStatusLabel, claimReasonText } from "@/lib/client/derive";
import { fmtDate, fmtDay, humanize } from "@/lib/client/format";
import { initialParam } from "@/lib/client/url-param";
import { payloads } from "@/lib/client/payloads";

type StatusFilter = "all" | "open" | "escalated" | "needs_info" | "approved" | "rejected" | "paid";

export function ClaimsView() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [type, setType] = useState<"all" | "travel" | "expense">("all");
  const [flagged, setFlagged] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(() => initialParam("claim"));
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Claim | null>(null);

  return (
    <PageFrame
      title="Claims"
      lede={(s) => {
        const open = s.claims.filter((c) => c.status === "escalated" || c.status === "needs_info").length;
        return `${s.claims.length} travel and expense claims. ${open} need a person; the rest Eve handled within policy.`;
      }}
      actions={(s) => (
        <>
          <LinkButton href={exportUrl("claims")} external variant="outline">
            <DownloadIcon aria-hidden />
            Export CSV
          </LinkButton>
          {canOrganize(s.actor).allowed ? (
            <Button onClick={() => setSubmitOpen(true)}>
              <PlusIcon aria-hidden />
              Submit a claim
            </Button>
          ) : null}
        </>
      )}
    >
      {(s) => {
        const q = query.trim().toLowerCase();
        const rows = s.claims
          .filter((c) =>
            status === "all"
              ? true
              : status === "open"
                ? ["submitted", "processing", "escalated", "needs_info"].includes(c.status)
                : c.status === status,
          )
          .filter((c) => type === "all" || c.type === type)
          .filter((c) => !flagged || c.checks.some((k) => !k.passed))
          .filter((c) => !q || `${c.id} ${c.personName} ${c.merchant} ${c.origin ?? ""}`.toLowerCase().includes(q));
        const count = (f: StatusFilter) =>
          s.claims.filter((c) =>
            f === "all" ? true : f === "open" ? ["submitted", "processing", "escalated", "needs_info"].includes(c.status) : c.status === f,
          ).length;
        const selected = s.claims.find((c) => c.id === openId);

        const columns: Column<Claim>[] = [
          { key: "id", header: "Claim", cell: (c) => `${c.id} · ${c.personName}`, stack: "title", sort: (c) => c.personName },
          { key: "what", header: "Details", cell: (c) => [c.type === "travel" ? `${c.origin ?? ""} ${c.cabin ?? ""}`.trim() || "Travel" : humanize(c.category), c.merchant].filter(Boolean).join(" · "), stack: "meta" },
          { key: "flags", header: "Checks", cell: (c) => <ChecksSummary claim={c} />, stack: "meta" },
          { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} label={claimStatusLabel(c)} />, stack: "end", sort: (c) => c.status },
          {
            key: "amount",
            header: "Amount",
            align: "end",
            stack: "end",
            sort: (c) => big(c.usdMinor),
            cell: (c) => (
              <span className="flex flex-col items-end">
                <Money amountMinor={big(c.usdMinor)} className="font-semibold" />
                {c.currency !== "USD" ? <Money amountMinor={big(c.amountMinor)} currency={c.currency} className="text-caption text-muted-foreground" /> : null}
              </span>
            ),
          },
          { key: "due", header: "Due", align: "end", stack: "hide", sort: (c) => c.dueAt, cell: (c) => <DueChip due={c.dueAt} now={s.now} align="end" /> },
        ];

        return (
          <>
            <div className="flex flex-col gap-3">
              <FilterChips
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "open", label: "Open", count: count("open") },
                  { value: "escalated", label: "Escalated", count: count("escalated") },
                  { value: "needs_info", label: "Needs info", count: count("needs_info") },
                  { value: "approved", label: "Approved", count: count("approved") },
                  { value: "rejected", label: "Rejected", count: count("rejected") },
                  { value: "paid", label: "Paid", count: count("paid") },
                  { value: "all", label: "All", count: count("all") },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <FilterChips
                  label="Type"
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "all", label: "All types" },
                    { value: "travel", label: "Travel" },
                    { value: "expense", label: "Expenses" },
                  ]}
                />
                <label className="inline-flex h-8 items-center gap-2 text-small">
                  <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} className="size-4 accent-foreground" />
                  Flagged checks only
                </label>
                <label className="relative ml-auto w-full sm:w-64">
                  <span className="sr-only">Search claims</span>
                  <SearchIcon aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person, merchant, airport" className="pl-8" />
                </label>
              </div>
            </div>

            <DataTable
              label="Claims"
              rows={rows}
              columns={columns}
              rowKey={(c) => c.id}
              onRowClick={(c) => setOpenId(c.id)}
              selectedKey={openId}
              initialSort={{ key: "due", dir: "asc" }}
              empty={<EmptyState title="No claims match">Change the filters or search. New claims appear here as attendees submit receipts.</EmptyState>}
            />

            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected ? `Claim ${selected.id}` : "Claim"} description={selected?.personName}>
              {selected ? <ClaimDetail claim={selected} snapshot={s} onEvidence={() => setEvidence(selected)} /> : null}
            </Sheet>
            <Sheet open={submitOpen} onOpenChange={setSubmitOpen} title="Submit a claim" description="Eve reads the receipt and runs the policy checks">
              <div className="flex flex-col gap-6">
                <ClaimForm people={s.people} onSubmitted={setSubmittedId} />
                {submittedId ? <ClaimOutcome claimId={submittedId} /> : null}
              </div>
            </Sheet>
            <EvidenceSheet
              open={evidence !== null}
              onOpenChange={(o) => !o && setEvidence(null)}
              title={evidence ? `Claim ${evidence.id}` : "Evidence"}
              objectIds={evidence ? [evidence.id] : []}
              checks={evidence?.checks}
              documentId={evidence?.documentId}
            />
          </>
        );
      }}
    </PageFrame>
  );
}

function ChecksSummary({ claim }: { claim: Claim }) {
  const failed = claim.checks.filter((k) => !k.passed);
  if (!claim.checks.length) return <span className="text-muted-foreground">Not checked yet</span>;
  if (!failed.length) return <span className="text-muted-foreground">All {claim.checks.length} passed</span>;
  return <span className="text-critical">Flagged: {failed.map((k) => k.label.toLowerCase()).join(", ")}</span>;
}

export function ClaimDetail({ claim: c, snapshot, onEvidence }: { claim: Claim; snapshot: AppSnapshot; onEvidence: () => void }) {
  const perm = canReview(snapshot.actor, c, snapshot);
  const open = c.status === "escalated" || c.status === "needs_info" || c.status === "submitted";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={c.status} label={claimStatusLabel(c)} />
        <DueChip due={c.dueAt} now={snapshot.now} context="review" />
      </div>
      {c.reason ? <p className="text-small">{claimReasonText(c)}</p> : null}
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-muted-foreground">Receipt amount</dt>
        <dd className="text-right"><Money amountMinor={big(c.amountMinor)} currency={c.currency} /></dd>
        <dt className="text-muted-foreground">In USD</dt>
        <dd className="text-right font-semibold">
          {c.currency !== "USD" ? (
            <Evidence source={`FX ${c.fxRate} · ${c.fxSource}`}>
              <Money amountMinor={big(c.usdMinor)} />
            </Evidence>
          ) : (
            <Money amountMinor={big(c.usdMinor)} />
          )}
        </dd>
        <dt className="text-muted-foreground">Merchant</dt>
        <dd className="text-right">{c.merchant}</dd>
        <dt className="text-muted-foreground">Purchased</dt>
        <dd className="text-right">{fmtDay(c.purchasedAt, true)}</dd>
        {c.travelDate ? (
          <>
            <dt className="text-muted-foreground">Travel</dt>
            <dd className="text-right">{[c.origin, c.cabin, fmtDate(c.travelDate)].filter(Boolean).join(" · ")}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Category</dt>
        <dd className="text-right">{humanize(c.category)}</dd>
      </dl>
      <CheckList checks={c.checks} />
      <div className="flex flex-wrap gap-2">
        {c.documentId ? (
          <LinkButton href={documentUrl(c.documentId)} external size="sm" variant="outline" target="_blank">
            Open receipt
          </LinkButton>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onEvidence}>
          View evidence
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <ActionButton
            wide
            size="default"
            variant="default"
            label="Approve"
            pendingLabel="Approving"
            permission={perm}
            call={payloads.claimReview(c.id, "approve", "Approved after review")}
          />
          {perm.allowed ? (
            <div className="flex flex-wrap gap-2">
              <ReasonAction label="Reject" pendingLabel="Rejecting" prompt="Why is this claim rejected? The attendee sees this." build={(r) => payloads.claimReview(c.id, "reject", r)} />
              <ReasonAction label="Ask for info" submitLabel="Send question" pendingLabel="Sending" prompt={`What should Eve ask ${c.personName.split(" ")[0]}?`} build={(r) => payloads.claimReview(c.id, "needs_info", r)} />
            </div>
          ) : null}
        </div>
      ) : c.status === "approved" && isOrgBookedFlight(c) ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <TruthLabel kind="simulated" /> Booked by the organization. {c.personName.split(" ")[0]} pays nothing, so there is no payout.
        </p>
      ) : c.status === "approved" && canOrganize(snapshot.actor).allowed && !snapshot.payouts.some((p) => p.sourceId === c.id) ? (
        <ActionButton wide size="default" variant="default" label="Propose payout" pendingLabel="Proposing" call={payloads.payoutPropose(c.id, "claim")} />
      ) : null}
    </div>
  );
}
