"use client";

import { CircleCheckIcon, CircleXIcon, FileTextIcon } from "lucide-react";

import { Sheet } from "@/components/app/sheet";
import { StatusBadge } from "@/components/app/status-badge";
import { TruthLabel } from "@/components/eve/truth-label";
import type { Check, Decision } from "@/lib/contracts";
import { documentUrl } from "@/lib/client/api";
import { failedCheckText } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";
import { useEve } from "@/lib/client/use-eve";

/**
 * The evidence drawer: every decision Eve logged on an object, with its
 * facts, checks, rule version, and source document.
 */
export function EvidenceSheet({
  open,
  onOpenChange,
  title,
  objectIds,
  decisionId,
  checks,
  documentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  objectIds: string[];
  decisionId?: string;
  checks?: Check[];
  documentId?: string;
}) {
  const { snapshot } = useEve();
  const decisions = (snapshot?.decisions ?? [])
    .filter((d) => (decisionId ? d.id === decisionId : objectIds.includes(d.objectId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rules = snapshot?.rules ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description="Evidence from the decision log">
      <div className="flex flex-col gap-6">
        {documentId ? (
          <a
            href={documentUrl(documentId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 self-start rounded-md text-small font-medium underline decoration-faint decoration-dotted underline-offset-4 hover:decoration-foreground"
          >
            <FileTextIcon aria-hidden className="size-4" />
            Open source document
          </a>
        ) : null}

        {checks?.length ? <CheckList checks={checks} /> : null}

        {decisions.length ? (
          <ol className="flex flex-col gap-4">
            {decisions.map((d) => {
              const rule = d.ruleId ? rules.find((r) => r.id === d.ruleId && r.version === d.ruleVersion) : undefined;
              return (
                <li key={d.id} className="flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{d.summary}</p>
                    <StatusBadge status={d.status} />
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {fmtDateTime(d.createdAt)} · {d.actor}{d.facts?.via === "slack" ? " via Slack" : ""} · <span className="font-mono">{d.tool}{d.ruleId ? ` · ${d.ruleId} v${d.ruleVersion}` : ""}</span>
                  </p>
                  {rule ? (
                    <div className="flex flex-col gap-1 text-small text-muted-foreground">
                      <span className="flex flex-wrap items-center gap-2">
                        {rule.explanation}
                        {!rule.verified ? <TruthLabel kind="unverified" /> : null}
                      </span>
                      <a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="self-start underline decoration-faint decoration-dotted underline-offset-4 hover:text-foreground">
                        Rule source
                      </a>
                    </div>
                  ) : null}
                  {Object.keys(d.facts ?? {}).length ? (
                    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
                      {Object.entries(d.facts).map(([k, v]) => (
                        <FactRow key={k} k={k} v={v} />
                      ))}
                    </dl>
                  ) : null}
                  {d.checks?.length ? <CheckList checks={d.checks} /> : null}
                  {d.documentId && d.tool === "portalAgent" ? (
                    <a href={documentUrl(d.documentId)} target="_blank" rel="noreferrer" className="self-start overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {/* eslint-disable-next-line @next/next/no-img-element -- stored screenshot served by the documents route */}
                      <img src={documentUrl(d.documentId)} alt="Portal screen after this step" width={256} height={192} loading="lazy" className="block aspect-[4/3] w-64 bg-rail" />
                    </a>
                  ) : d.documentId ? (
                    <a href={documentUrl(d.documentId)} target="_blank" rel="noreferrer" className="self-start text-small underline decoration-faint decoration-dotted underline-offset-4 hover:decoration-foreground">
                      Source document
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-small text-muted-foreground">
            No decisions are logged for this item yet. Eve records each step as it works.
          </p>
        )}
      </div>
    </Sheet>
  );
}

function FactRow({ k, v }: { k: string; v: unknown }) {
  const text = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return (
    <>
      <dt className="truncate text-muted-foreground">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
      <dd className="break-words tabular-nums">{text}</dd>
    </>
  );
}

export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul aria-label="Checks" className="flex flex-col gap-2">
      {checks.map((c) => (
        <li key={c.code} className="flex items-start gap-2 text-small">
          {c.passed ? (
            <CircleCheckIcon aria-label="Passed" className="mt-px size-4 shrink-0 text-positive" />
          ) : (
            <CircleXIcon aria-label="Flagged" className="mt-px size-4 shrink-0 text-critical" />
          )}
          <span className="flex flex-col">
            <span className="font-medium">{c.passed ? c.label : failedCheckText(c)}</span>
            {c.passed ? <span className="text-muted-foreground">{c.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export type { Decision };
