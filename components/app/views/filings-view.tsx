"use client";

import { DownloadIcon } from "lucide-react";

import { ActionButton } from "@/components/app/action-button";
import { DataTable, type Column } from "@/components/app/data-table";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Money } from "@/components/eve/money";
import type { Filing } from "@/lib/contracts";
import { documentUrl, exportUrl } from "@/lib/client/api";
import { big, canManage } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

export function FilingsView() {
  return (
    <PageFrame
      title="Filings"
      lede={(s) =>
        s.org.country === "CA"
          ? "Draft T4A and NR4 worksheets per person, in Canadian dollars with the conversion shown. Eve prepares and explains; a human controller signs. Drafts are not filed returns."
          : "Draft year-end forms per person from the ledger. Eve prepares and explains; a human controller signs. Drafts are not submitted returns."
      }
      actions={(s) => (
        <>
          <LinkButton href={exportUrl("filings")} external variant="outline">
            <DownloadIcon aria-hidden />
            Filings CSV
          </LinkButton>
          {s.org.country === "US" ? (
            <LinkButton href={exportUrl("1042-summary", undefined, { year: new Date(s.now).getFullYear() })} external target="_blank" variant="outline">
              <DownloadIcon aria-hidden />
              {new Date(s.now).getFullYear()} 1042 summary
            </LinkButton>
          ) : null}
          <ActionButton
            size="default"
            variant="default"
            label={`Generate ${new Date(s.now).getFullYear()} drafts`}
            pendingLabel="Generating"
            permission={canManage(s.actor)}
            call={payloads.filingsGenerate(new Date(s.now).getFullYear())}
          />
        </>
      )}
    >
      {(s) => {
        const columns: Column<Filing>[] = [
          { key: "who", header: "Person", stack: "title", sort: (f) => f.personName, cell: (f) => f.personName },
          { key: "form", header: "Form", stack: "meta", sort: (f) => f.form, cell: (f) => `${f.form} · ${f.year}` },
          { key: "status", header: "Status", stack: "end", sort: (f) => f.status, cell: (f) => <StatusBadge status={f.status} label={f.status === "draft" ? "Draft" : "Reviewed"} /> },
          { key: "gross", header: "Gross", align: "end", stack: "end", sort: (f) => big(f.grossMinor), cell: (f) => <Money amountMinor={big(f.grossMinor)} currency={f.currency ?? "USD"} className="font-semibold" /> },
          { key: "wh", header: "Withheld", align: "end", stack: "hide", sort: (f) => big(f.withholdingMinor), cell: (f) => <Money amountMinor={big(f.withholdingMinor)} currency={f.currency ?? "USD"} /> },
          {
            key: "dl",
            header: "Download",
            align: "end",
            stack: "meta",
            cell: (f) => (
              <a href={f.documentId ? documentUrl(f.documentId) : exportUrl("filing", f.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-small underline decoration-faint decoration-dotted underline-offset-4 hover:decoration-foreground">
                {f.form} draft
              </a>
            ),
          },
        ];
        return (
          <DataTable label="Filing drafts" rows={s.filings} columns={columns} rowKey={(f) => f.id} initialSort={{ key: "who", dir: "asc" }} empty={<EmptyState title="No drafts yet">{s.org.country === "CA" ? "Generate drafts to prepare T4A and NR4 worksheets from paid prizes and stipends." : "Generate drafts to prepare 1099 and 1042-S forms from paid prizes and stipends."} Unverified rules stay labelled.</EmptyState>} />
        );
      }}
    </PageFrame>
  );
}
