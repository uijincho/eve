"use client";

import { useState } from "react";

import { ClaimForm, ClaimOutcome } from "@/components/app/claim-form";
import { CheckList } from "@/components/app/evidence-sheet";
import { Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import { big } from "@/lib/client/derive";
import { fmtDay, humanize } from "@/lib/client/format";

import { PortalFrame } from "./portal-frame";

export function PortalClaims() {
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <PortalFrame title="Claims" lede="Upload a receipt and Eve checks it against the travel policy: your name, dates, cabin, the cap after currency conversion, and duplicates.">
      {(s, me) => {
        const mine = s.claims.filter((c) => c.personId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section title="New claim">
              {me.adult ? <ClaimForm onSubmitted={setSubmitted} /> : <p className="text-small text-critical">Claims are blocked: you must be 18 or older at the event start.</p>}
              {submitted ? <ClaimOutcome claimId={submitted} /> : null}
            </Section>
            <Section title="Your claims" aside={`${mine.length}`}>
              {mine.length ? (
                <ul className="flex flex-col divide-y rounded-xl border">
                  {mine.map((c) => (
                    <li key={c.id}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 hover:bg-surface">
                          <span className="flex flex-col">
                            <span className="font-medium">{c.merchant || "Receipt"} · {c.id}</span>
                            <span className="text-small text-muted-foreground">{c.type === "travel" ? "Travel" : humanize(c.category)} · {fmtDay(c.purchasedAt)}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <Money amountMinor={big(c.usdMinor)} className="font-semibold" />
                            <StatusBadge status={c.status} />
                          </span>
                        </summary>
                        <div className="flex flex-col gap-3 px-4 pb-4">
                          {c.reason ? <p className="text-small">{c.reason}</p> : null}
                          <CheckList checks={c.checks} />
                          {c.status === "needs_info" ? (
                            <p className="text-small text-muted-foreground">Reply to the email Eve sent, or upload a corrected receipt as a new claim.</p>
                          ) : null}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted-foreground">No claims yet. Travel and expenses you submit show up here with their status.</p>
              )}
            </Section>
          </div>
        );
      }}
    </PortalFrame>
  );
}

