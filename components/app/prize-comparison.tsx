"use client";

import { cn } from "cn";

import { BreakdownBar } from "@/components/eve/breakdown-bar";
import { Evidence } from "@/components/eve/evidence";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import type { AppSnapshot, Award, Payout, Person } from "@/lib/contracts";
import { FULFILLMENT_LABEL, payoutFees, prizeOptions, ruleLabel } from "@/lib/client/derive";
import { fmtRate } from "@/lib/client/format";

/** What the winner receives as cash, and the three fulfilment options. */
export function PrizeComparison({
  snapshot,
  award,
  person,
  payout,
  className,
}: {
  snapshot: AppSnapshot;
  award: Award;
  person?: Person;
  payout?: Payout;
  className?: string;
}) {
  const inKind = payout?.provider === "in_kind";
  // An in-kind delivery is not a cash payout: keep the cash option as an estimate.
  const o = prizeOptions(snapshot, award, person, inKind ? undefined : payout);
  const rule = inKind ? (snapshot.rules.find((r) => r.id === payout.ruleId && r.version === payout.ruleVersion) ?? o.rule) : o.rule;
  const first = award.personName.split(" ")[0];
  const fees = payout ? payoutFees(payout) : { recipient: 0n, org: 0n };
  const fee = fees.recipient;
  const ruleSource = rule
    ? `Rule ${rule.id} v${rule.version} · ${fmtRate(rule.rateBps)}${rule.verified ? "" : " · unverified"}`
    : "No matching rule loaded";

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">{inKind ? `What ${first} received, as reported income` : `What ${first} receives as cash`}</h3>
          {inKind ? <TruthLabel kind="simulated" /> : o.fromPayout ? null : <TruthLabel kind="estimate" />}
        </div>
        <BreakdownBar
          grossMinor={Number(inKind ? BigInt(payout.grossMinor) : o.gross)}
          currency={award.currency}
          estimate={!inKind && !o.fromPayout}
          netLabel={inKind ? `Item value delivered to ${first}` : `${o.fromPayout ? "Net" : "Est. net"} to ${first}`}
          deductions={[
            {
              label: inKind ? "Withholding the organization pays on top" : rule ? `Withholding, ${fmtRate(rule.rateBps)}` : "Withholding",
              amountMinor: Number(inKind ? BigInt(payout.withholdingMinor) : o.withholding),
              kind: "withholding",
            },
            { label: "Fees", amountMinor: Number(fee), kind: "fee" },
          ]}
        />
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
          <dt className="text-muted-foreground">Rule</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {rule ? (
              <Evidence source={ruleSource} href={rule.sourceUrl}>
                {ruleLabel(rule)}
              </Evidence>
            ) : (
              <span className="text-muted-foreground">No rule matched yet</span>
            )}
            {rule && !rule.verified ? <TruthLabel kind="unverified" /> : null}
          </dd>
          {fees.org ? (
            <>
              <dt className="text-muted-foreground">Fees</dt>
              <dd>
                <Money amountMinor={fees.org} currency={award.currency} /> paid by the organization
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Form</dt>
          <dd>
            {person ? `${person.taxForm} ${person.taxStatus === "valid" ? "valid" : person.taxStatus === "missing" ? "not signed yet" : person.taxStatus}` : "Unknown"}
          </dd>
        </dl>
      </section>

      {award.kind === "item" ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">
            {o.recommended !== "undecided" && award.fulfillment === "undecided"
              ? `Eve recommends ${FULFILLMENT_LABEL[o.recommended].toLowerCase()}`
              : `Fulfilment: ${FULFILLMENT_LABEL[award.fulfillment]}`}
          </h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-small">
            <Option label="Ship it" note="shipping + duty, est." chosen={award.fulfillment === "ship"}>
              <Money amountMinor={o.ship} currency={award.currency} estimate />
            </Option>
            <Option label="Buy local" note="local retail, est." chosen={award.fulfillment === "local"}>
              <Money amountMinor={o.local} currency={award.currency} estimate />
            </Option>
            <Option label="Cash equivalent" note="net after withholding" chosen={award.fulfillment === "cash"}>
              <Money amountMinor={o.cashNet} currency={award.currency} estimate={!o.fromPayout} />
            </Option>
          </dl>
          <p className="text-small text-muted-foreground">
            The item&rsquo;s fair market value counts toward {first}&rsquo;s reportable prize total either way.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Option({ label, note, chosen, children }: { label: string; note: string; chosen: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className={cn(chosen && "font-semibold")}>
        {label} <span className="text-caption text-muted-foreground">{chosen ? "chosen" : note}</span>
      </dt>
      <dd className="text-right">{children}</dd>
    </>
  );
}
