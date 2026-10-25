"use client";

import { FileTextIcon } from "lucide-react";

import { CheckList } from "@/components/app/evidence-sheet";
import { PortalRunPanel } from "@/components/app/portal-run-panel";
import { PrizeComparison } from "@/components/app/prize-comparison";
import { StatusBadge } from "@/components/app/status-badge";
import { TaxFormLink } from "@/components/app/tax-form-link";
import { Airline, Airport } from "@/components/eve/airline";
import { BreakdownBar } from "@/components/eve/breakdown-bar";
import { DueChip } from "@/components/eve/due-chip";
import { Evidence } from "@/components/eve/evidence";
import { Money } from "@/components/eve/money";
import { TagList } from "@/components/eve/tag-list";
import { TruthLabel } from "@/components/eve/truth-label";
import type { AppSnapshot, Payout } from "@/lib/contracts";
import { big, type InboxItem, payoutFees, payoutSource, providerLabel, isInKind, payoutValue, projectStatusLabel } from "@/lib/client/derive";
import { useEve } from "@/lib/client/use-eve";
import { documentUrl } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/client/format";

import { ItemActions } from "./item-actions";

/** The selected inbox item: what, why, the evidence, and the decision. */
export function ItemDetail({
  item,
  snapshot,
  onEvidence,
}: {
  item: InboxItem;
  snapshot: AppSnapshot;
  onEvidence: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-subheading">{item.title}</h2>
            <p className="text-small text-muted-foreground">{item.meta}</p>
          </div>
          <Money amountMinor={item.amountMinor} currency={item.currency} className="pt-0.5 text-subheading" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <TagList tags={item.tags} />
          <span title={`Due for ${item.dueContext}, ${fmtDateTime(item.dueAt)}`}>
            <DueChip due={item.dueAt} now={snapshot.now} context={item.dueContext} inline />
          </span>
        </div>
      </div>

      {item.detail ? <p className="max-w-[60ch] text-small text-muted-foreground">{item.detail}</p> : null}

      <DetailBody item={item} snapshot={snapshot} />

      <div className="border-t pt-4">
        <ItemActions item={item} snapshot={snapshot} layout="pane" onEvidence={onEvidence} />
      </div>
    </div>
  );
}

function DetailBody({ item, snapshot }: { item: InboxItem; snapshot: AppSnapshot }) {
  const ref = item.ref;
  switch (ref.kind) {
    case "portal":
      return <PortalRunPanel run={ref.run} packet={ref.packet} snapshot={snapshot} actions={false} />;
    case "award":
      return <PrizeComparison snapshot={snapshot} award={ref.award} person={ref.person} payout={ref.payout} />;
    case "payout":
      return <PayoutBreakdown payout={ref.payout} showStatus={false} showUnverified={!item.tags.some((t) => t.label === "Unverified rule")} />;
    case "payouts":
      return (
        <ul aria-label="Payouts in this batch" className="flex flex-col divide-y rounded-xl border">
          {ref.payouts.map((p) => (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{p.personName}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {snapshot ? payoutSource(snapshot, p) : p.sourceType === "award" ? "Prize" : "Claim"}
                </span>
              </span>
              <span className="flex flex-col items-end">
                <Money amountMinor={payoutValue(p)} currency={p.currency} className="font-semibold" />
                <span className="text-caption text-muted-foreground">
                  net of <Money amountMinor={big(p.grossMinor)} currency={p.currency} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      );
    case "claim": {
      const c = ref.claim;
      return (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-small">
            <dt className="text-muted-foreground">Receipt</dt>
            <dd className="text-right">
              <Money amountMinor={big(c.amountMinor)} currency={c.currency} />
            </dd>
            {c.currency !== "USD" ? (
              <>
                <dt className="text-muted-foreground">Converted</dt>
                <dd className="text-right">
                  <Evidence source={`FX ${c.fxRate} · ${c.fxSource}`}>
                    <Money amountMinor={big(c.usdMinor)} currency="USD" />
                  </Evidence>
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{c.type === "travel" ? "Airline" : "Merchant"}</dt>
            <dd className="flex justify-end">{c.type === "travel" ? <Airline name={c.merchant} withName /> : c.merchant}</dd>
            {c.type === "travel" && c.origin ? (
              <>
                <dt className="text-muted-foreground">From</dt>
                <dd className="flex justify-end"><Airport code={c.origin} /></dd>
              </>
            ) : null}
            {c.type === "travel" ? (
              <>
                <dt className="text-muted-foreground">Project</dt>
                <dd className="text-right">{projectStatusLabel(snapshot.people.find((p) => p.id === c.personId)?.projectStatus)}</dd>
              </>
            ) : null}
          </dl>
          <CheckList checks={c.checks} />
          {c.documentId ? (
            <a href={documentUrl(c.documentId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 self-start text-small underline decoration-faint decoration-dotted underline-offset-4 hover:decoration-foreground">
              <FileTextIcon aria-hidden className="size-3.5" />
              Open receipt
            </a>
          ) : null}
        </div>
      );
    }
    case "packet": {
      const k = ref.packet;
      return (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
          <dt className="text-muted-foreground">Requested</dt>
          <dd className="text-right"><Money amountMinor={big(k.requestedMinor)} /></dd>
          <dt className="text-muted-foreground">Remitted</dt>
          <dd className="text-right"><Money amountMinor={big(k.paidMinor)} /></dd>
          <dt className="font-semibold">Difference</dt>
          <dd className="text-right font-semibold text-critical">
            <Money amountMinor={big(k.paidMinor) - big(k.requestedMinor)} signDisplay="exceptZero" />
          </dd>
        </dl>
      );
    }
    case "person": {
      const p = ref.person;
      return (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
            <dt className="text-muted-foreground">Form</dt>
            <dd className="text-right">{p.taxForm} <StatusBadge status={p.taxStatus} /></dd>
            <dt className="text-muted-foreground">Chases sent</dt>
            <dd className="text-right tabular-nums">{p.chaseCount}</dd>
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd className="text-right"><Money amountMinor={big(p.outstandingMinor)} /></dd>
          </dl>
          <TaxFormLink person={p} className="self-start" />
        </div>
      );
    }
  }
}

export function PayoutBreakdown({ payout: p, showStatus = true, showUnverified = true }: { payout: Payout; showStatus?: boolean; showUnverified?: boolean }) {
  const estimate = p.truth === "Estimate";
  const fees = payoutFees(p);
  const { snapshot } = useEve();
  return (
    <div className="flex flex-col gap-4">
      {showStatus || estimate || (showUnverified && !p.ruleVerified) ? (
        <div className="flex flex-wrap items-center gap-2">
          {showStatus ? <StatusBadge status={p.status} /> : null}
          {estimate ? <TruthLabel kind="estimate" /> : null}
          {showUnverified && !p.ruleVerified ? <TruthLabel kind="unverified" /> : null}
        </div>
      ) : null}
      <BreakdownBar
        grossMinor={Number(big(p.grossMinor))}
        currency={p.currency}
        estimate={estimate}
        netLabel={isInKind(p) ? `Item value delivered to ${p.personName.split(" ")[0]}` : `Net to ${p.personName.split(" ")[0]}`}
        deductions={[
          { label: isInKind(p) ? "Withholding the organization pays on top" : "Withholding", amountMinor: Number(big(p.withholdingMinor)), kind: "withholding" },
          { label: "Fees", amountMinor: Number(fees.recipient), kind: "fee" },
        ]}
      />
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
        {fees.org ? (
          <>
            <dt className="text-muted-foreground">Fees the organization pays</dt>
            <dd className="text-right">
              <Money amountMinor={fees.org} currency={p.currency} />
            </dd>
          </>
        ) : null}
        {p.destinationCurrency !== p.currency && !isInKind(p) ? (
          <>
            <dt className="text-muted-foreground">Received in {p.destinationCurrency}</dt>
            <dd className="text-right">
              <Money amountMinor={big(p.destinationNetMinor)} currency={p.destinationCurrency} estimate={p.status !== "paid"} />
            </dd>
            <dd className="col-span-2 -mt-1 text-right text-caption text-muted-foreground tabular-nums">
              1 {p.currency} = {p.fxRate} {p.destinationCurrency}
              {p.provider === "mock_wire" ? " · incl. 2% FX spread" : ""}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Rule</dt>
        <dd className="text-right font-mono text-caption">{p.ruleId} v{p.ruleVersion}</dd>
        <dt className="text-muted-foreground">Provider</dt>
        <dd className="text-right">{providerLabel(p.provider)}{p.providerRef ? ` · ${p.providerRef}` : ""}</dd>
        {p.releasedBy ? (
          <>
            <dt className="text-muted-foreground">Released by</dt>
            <dd className="text-right">{snapshot?.personas.find((member) => member.id === p.releasedBy)?.name ?? "Controller"}</dd>
          </>
        ) : null}
      </dl>
      {fees.recipient > 0n && fees.recipient * 10n >= big(p.grossMinor) ? (
        <p className="text-small">Transfer fees consume at least 10% of this payment. You can cover fees in Settings.</p>
      ) : null}
    </div>
  );
}
