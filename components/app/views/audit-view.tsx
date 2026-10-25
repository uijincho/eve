"use client";

import { DownloadIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { DataTable, FilterChips, type Column } from "@/components/app/data-table";
import { EvidenceSheet } from "@/components/app/evidence-sheet";
import { LinkButton } from "@/components/app/link-button";
import { PageFrame } from "@/components/app/page-frame";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Input } from "@/components/ui/input";
import type { Decision } from "@/lib/contracts";
import { exportUrl } from "@/lib/client/api";
import { objectLabel } from "@/lib/client/derive";
import { fmtDateTime } from "@/lib/client/format";

export function AuditView() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [open, setOpen] = useState<Decision | null>(null);
  return (
    <PageFrame
      title="Audit trail"
      lede={(s) => `${s.decisions.length} decisions logged. Ledger entries are immutable.`}
      actions={() => (
        <>
          <LinkButton href={exportUrl("ledger")} external variant="outline">
            <DownloadIcon aria-hidden />
            Ledger CSV
          </LinkButton>
        </>
      )}
    >
      {(s) => {
        const types = [...new Set(s.decisions.map((d) => d.objectType))].sort();
        const q = query.trim().toLowerCase();
        const rows = s.decisions
          .filter((d) => type === "all" || d.objectType === type)
          .filter((d) => !q || `${d.objectId} ${d.personName} ${d.summary} ${d.actor} ${d.tool} ${d.ruleId ?? ""}`.toLowerCase().includes(q));
        const columns: Column<Decision>[] = [
          {
            key: "obj",
            header: "Object",
            stack: "title",
            sort: (d) => d.personName || d.objectId,
            cell: (d) => (
              <span className="flex flex-col">
                {d.personName || objectLabel(d)}
                <span className="text-caption font-normal text-muted-foreground">{d.personName ? objectLabel({ ...d, personName: "" }) : d.objectId}</span>
              </span>
            ),
          },
          { key: "sum", header: "Decision", stack: "meta", cell: (d) => <span className="line-clamp-2" title={d.summary}>{d.summary}</span>, className: "max-w-[44ch]" },
          { key: "who", header: "Actor", stack: "meta", sort: (d) => d.actor, cell: (d) => <span className="whitespace-nowrap">{d.actor}{d.facts?.via === "slack" ? " via Slack" : ""}</span> },
          { key: "status", header: "Result", stack: "end", sort: (d) => d.status, cell: (d) => <StatusBadge status={d.status} /> },
          { key: "at", header: "When", align: "end", stack: "end", sort: (d) => d.createdAt, cell: (d) => <span className="text-small whitespace-nowrap text-muted-foreground">{fmtDateTime(d.createdAt)}</span> },
        ];
        return (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <FilterChips label="Object type" value={type} onChange={setType} options={[{ value: "all", label: "All", count: s.decisions.length }, ...types.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1), count: s.decisions.filter((d) => d.objectType === t).length }))]} />
              <label className="relative ml-auto w-full sm:w-72">
                <span className="sr-only">Search decisions</span>
                <SearchIcon aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person, object, rule, or actor" className="pl-8" />
              </label>
            </div>
            <DataTable label="Decision log" rows={rows} columns={columns} rowKey={(d) => d.id} onRowClick={setOpen} selectedKey={open?.id} initialSort={{ key: "at", dir: "desc" }} empty={<EmptyState title="No decisions match">Try a person&rsquo;s name, an object id like C-2241, or a rule id.</EmptyState>} />
            <EvidenceSheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open ? objectLabel(open) : "Evidence"} objectIds={open ? [open.objectId] : []} decisionId={open?.id} />
          </>
        );
      }}
    </PageFrame>
  );
}
