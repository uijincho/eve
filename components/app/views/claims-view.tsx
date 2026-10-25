"use client";

import { CircleCheckIcon, DownloadIcon, FileTextIcon, PlusIcon, ScrollTextIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { ClaimDecision } from "@/components/app/claim-decision";
import { ClaimForm, ClaimOutcome } from "@/components/app/claim-form";
import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { CheckList, EvidenceSheet } from "@/components/app/evidence-sheet";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { Sheet } from "@/components/app/sheet";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Airline, Airport } from "@/components/eve/airline";
import { DueChip } from "@/components/eve/due-chip";
import { Evidence } from "@/components/eve/evidence";
import { Money } from "@/components/eve/money";
import { TagList } from "@/components/eve/tag-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot, Claim } from "@/lib/contracts";
import { documentUrl, exportUrl } from "@/lib/client/api";
import { big, canOrganize, checkTag, claimReasonText, claimStatusLabel, failedChecks, isOrgBookedFlight, projectStatusLabel } from "@/lib/client/derive";
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
        return `${open} of ${s.claims.length} need a person.`;
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
          {
            key: "id",
            header: "Claim",
            stack: "title",
            sort: (c) => c.personName,
            cell: (c) => (
              <span className="flex flex-col">
                {c.personName}
                <span className="text-caption font-normal text-muted-foreground tabular-nums">{c.id}</span>
              </span>
            ),
          },
          { key: "what", header: "Details", cell: (c) => <ClaimDetails claim={c} />, stack: "meta" },
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

            <Sheet open={selected !== undefined} onOpenChange={(o) => !o && setOpenId(null)} title={selected?.personName ?? "Claim"} description={selected ? `Claim ${selected.id}` : undefined}>
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

/** Origin and carrier as chips, the carrier as its logo; expenses show their category. */
function ClaimDetails({ claim: c }: { claim: Claim }) {
  if (c.type !== "travel") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{humanize(c.category)}</Badge>
        {c.merchant ? <span className="text-small text-muted-foreground">{c.merchant}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {c.origin ? <Airport code={c.origin} /> : null}
      {c.merchant ? <Airline name={c.merchant} /> : null}
      {c.cabin && c.cabin !== "economy" ? <Badge variant="pending">{humanize(c.cabin)}</Badge> : null}
      {!c.origin && !c.merchant ? <span className="text-small text-muted-foreground">Travel</span> : null}
    </span>
  );
}

function ChecksSummary({ claim }: { claim: Claim }) {
  const failed = failedChecks(claim);
  if (!claim.checks.length) return <span className="text-small text-muted-foreground">Not checked</span>;
  if (!failed.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-4 text-positive" />
        All passed
      </span>
    );
  }
  return <TagList tags={failed.map(checkTag)} max={2} />;
}

/** Why the fare was flagged, what Eve asked, and the attendee's answer. */
function FareReviewPanel({ claim: c }: { claim: Claim }) {
  const r = c.fareReview!;
  const first = c.personName.split(" ")[0];
  return (
    <section aria-label="Fare check" className="flex flex-col gap-3 rounded-lg border bg-surface p-3 text-small">
      <h3 className="font-medium">Fare check · {r.route}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Paid</dt>
        <dd className="text-right font-semibold"><Money amountMinor={big(c.usdMinor)} /></dd>
        {r.peerCount ? (
          <>
            <dt className="text-muted-foreground">Other attendees, median ({r.peerCount})</dt>
            <dd className="text-right"><Money amountMinor={big(r.medianMinor ?? "0")} /></dd>
            <dt className="text-muted-foreground">Other attendees, 75th percentile</dt>
            <dd className="text-right"><Money amountMinor={big(r.percentileMinor ?? "0")} /></dd>
          </>
        ) : null}
        {r.market ? (
          <>
            <dt className="text-muted-foreground">{r.market.basis === "typical_high" ? "Market typical high" : "Cheapest tracked fare"} ({r.market.capturedOn})</dt>
            <dd className="text-right">
              <Evidence source={`${r.market.source === "serpapi" ? "Google Flights via SerpApi" : r.market.source === "duffel_test" ? "Duffel test mode" : "Fare table"} · ${r.market.truth}`}>
                <Money amountMinor={big(r.market.referenceMinor)} />
              </Evidence>
            </dd>
            {r.market.priceOnDateMinor ? (
              <>
                <dt className="text-muted-foreground">Lowest on the booking date</dt>
                <dd className="text-right"><Money amountMinor={big(r.market.priceOnDateMinor)} /></dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      <p><span className="font-medium">Eve asked {first}:</span> {r.question}</p>
      {r.explanation ? (
        <p><span className="font-medium">{first} answered:</span> {r.explanation}</p>
      ) : (
        <p className="text-muted-foreground">Waiting for {first}&apos;s answer. You can still decide now.</p>
      )}
    </section>
  );
}

export function ClaimDetail({ claim: c, snapshot, onEvidence }: { claim: Claim; snapshot: AppSnapshot; onEvidence: () => void }) {
  const person = snapshot.people.find((p) => p.id === c.personId);
  const open = c.status === "escalated" || c.status === "needs_info" || c.status === "submitted";
  const first = c.personName.split(" ")[0];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Money amountMinor={big(c.usdMinor)} className="text-title" />
          {c.currency !== "USD" ? (
            <span className="text-small text-muted-foreground">
              <Evidence source={`FX ${c.fxRate} · ${c.fxSource}`}>
                <Money amountMinor={big(c.amountMinor)} currency={c.currency} />
              </Evidence>{" "}
              on the receipt
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5 pt-1">
          <StatusBadge status={c.status} label={claimStatusLabel(c)} />
          <DueChip due={c.dueAt} now={snapshot.now} context="review" inline />
        </div>
      </div>

      {!open && c.reason ? <p className="text-small">{claimReasonText(c)}</p> : null}

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-small">
        <dt className="text-muted-foreground">{c.type === "travel" ? "Airline" : "Merchant"}</dt>
        <dd className="flex justify-end">{c.type === "travel" ? <Airline name={c.merchant} withName /> : c.merchant}</dd>
        {c.type === "travel" ? (
          <>
            <dt className="text-muted-foreground">Flight</dt>
            <dd className="flex items-center justify-end gap-1.5">
              {c.origin ? <Airport code={c.origin} /> : null}
              {c.cabin && c.cabin !== "economy" ? <Badge variant="pending">{humanize(c.cabin)}</Badge> : null}
              {c.travelDate ? <span>{fmtDate(c.travelDate)}</span> : null}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="text-right">{humanize(c.category)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Purchased</dt>
        <dd className="text-right">{fmtDay(c.purchasedAt, true)}</dd>
        {c.type === "travel" && person ? (
          <>
            <dt className="text-muted-foreground">Project</dt>
            <dd className={person.projectStatus === "none" ? "text-right text-critical" : "text-right"}>
              {person.projectUrl ? (
                <a href={person.projectUrl} target="_blank" rel="noreferrer" className="underline decoration-faint decoration-dotted underline-offset-4 hover:decoration-foreground">
                  {projectStatusLabel(person.projectStatus)}
                </a>
              ) : (
                projectStatusLabel(person.projectStatus)
              )}
            </dd>
          </>
        ) : null}
      </dl>

      {c.fareReview ? <FareReviewPanel claim={c} /> : null}

      <div className="flex flex-col gap-3">
        <CheckList checks={c.checks} />
        <div className="-ml-2.5 flex flex-wrap gap-1">
          {c.documentId ? (
            <LinkButton href={documentUrl(c.documentId)} external size="sm" variant="ghost" target="_blank">
              <FileTextIcon aria-hidden />
              Receipt
            </LinkButton>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onEvidence}>
            <ScrollTextIcon aria-hidden />
            Evidence
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t pt-4">
          <ClaimDecision claim={c} snapshot={snapshot} />
        </div>
      ) : c.status === "approved" && isOrgBookedFlight(c) ? (
        <p className="text-small text-muted-foreground">Booked by the organization. {first} pays nothing, so there is no payout.</p>
      ) : c.status === "approved" && canOrganize(snapshot.actor).allowed && !snapshot.payouts.some((p) => p.sourceId === c.id) ? (
        <ActionButton wide size="default" variant="default" label="Propose payout" pendingLabel="Proposing" call={payloads.payoutPropose(c.id, "claim")} />
      ) : null}
    </div>
  );
}
