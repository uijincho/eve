"use client";

import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";

import { DueChip } from "@/components/eve/due-chip";
import { Money } from "@/components/eve/money";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SAMPLE_CLAIMS, SAMPLE_NOW } from "@/lib/design/sample";

type Claim = (typeof SAMPLE_CLAIMS)[number];

const STATUS_VARIANT = {
  "Needs you": "outline",
  "Over cap": "critical",
  Held: "outline",
  Approved: "positive",
} as const;

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const helper = createColumnHelper<typeof features, Claim>();

const NUMERIC = new Set(["amountMinor"]);

const columns = helper.columns([
  helper.accessor("id", {
    header: "Claim",
    cell: (c) => <span className="font-medium">{c.getValue()}</span>,
  }),
  helper.accessor("person", { header: "Person" }),
  helper.accessor("what", { header: "For", enableSorting: false }),
  helper.accessor("amountMinor", {
    header: "Amount",
    cell: (c) => <Money amountMinor={c.getValue()} />,
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (c) => <Badge variant={STATUS_VARIANT[c.getValue()]}>{c.getValue()}</Badge>,
  }),
  helper.accessor("due", {
    header: "Due",
    sortFn: (a, b) =>
      new Date(a.original.due).getTime() - new Date(b.original.due).getTime(),
    cell: (c) => <DueChip due={c.getValue()} now={SAMPLE_NOW} />,
  }),
]);

const data = [...SAMPLE_CLAIMS];

/** A dense, sortable table. Figures right-aligned; the due column keeps its hue. */
export function ClaimsTable() {
  const [sorting, setSorting] = useState<SortingState>([{ id: "due", desc: false }]);
  const table = useTable({
    features,
    columns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className="overflow-hidden rounded-xl border">
      {/* Narrow screens: each claim stacks, in the table's current order. */}
      <ul aria-label="Claims" className="md:hidden">
        {table.getRowModel().rows.map((row) => {
          const claim = row.original;
          return (
            <li key={row.id} className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">
                  {claim.id} · {claim.person}
                </span>
                <span className="text-small text-muted-foreground">{claim.what}</span>
                <Badge variant={STATUS_VARIANT[claim.status]}>{claim.status}</Badge>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money amountMinor={claim.amountMinor} className="font-medium" />
                <DueChip due={claim.due} now={SAMPLE_NOW} align="end" />
              </div>
            </li>
          );
        })}
      </ul>
      <Table className="max-md:hidden">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const numeric = NUMERIC.has(header.column.id);
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                    className={numeric ? "px-4 text-right" : "px-4"}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUpIcon aria-hidden className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon aria-hidden className="size-3" />
                        ) : (
                          <ChevronsUpDownIcon aria-hidden className="size-3 opacity-60" />
                        )}
                      </button>
                    ) : (
                      <span className="text-caption font-medium text-muted-foreground">
                        <table.FlexRender header={header} />
                      </span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-surface">
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={NUMERIC.has(cell.column.id) ? "px-4 py-3 text-right" : "px-4 py-3"}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
