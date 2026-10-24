"use client";

import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "start" | "end";
  sort?: (row: T) => string | number | bigint;
  /** Where the cell goes when the table stacks under 768px. */
  stack?: "title" | "meta" | "end" | "hide";
  className?: string;
};

/**
 * A dense table with sortable headers. Under 768px it becomes a stacked list
 * in the same order, with the title at left and amount and due at right.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  onRowClick,
  selectedKey,
  empty,
  initialSort,
  leading,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: React.ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** A leading cell such as a selection checkbox. */
  leading?: { header: React.ReactNode; cell: (row: T) => React.ReactNode };
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sortCol = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = sortCol?.sort
    ? [...rows].sort((a, b) => {
        const x = sortCol.sort!(a);
        const y = sortCol.sort!(b);
        const r = x < y ? -1 : x > y ? 1 : 0;
        return sort!.dir === "asc" ? r : -r;
      })
    : rows;

  if (!rows.length) return <>{empty}</>;

  const title = columns.find((c) => c.stack === "title") ?? columns[0];
  const metas = columns.filter((c) => c.stack === "meta");
  const ends = columns.filter((c) => c.stack === "end");

  return (
    <div className="relative overflow-x-auto rounded-xl border" role="region" aria-label={`${label} table`} tabIndex={0}>
      <table aria-label={label} className="w-full border-collapse max-md:hidden">
        <thead>
          <tr className="border-b">
            {leading ? <th className="w-10 px-4 py-2.5 text-left">{leading.header}</th> : null}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "px-4 py-2.5 text-caption font-medium text-muted-foreground",
                    c.align === "end" ? "text-right" : "text-left",
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort({ key: c.key, dir: active && sort!.dir === "asc" ? "desc" : "asc" })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm hover:text-foreground",
                        c.align === "end" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? <ArrowUpIcon aria-hidden className="size-3" /> : <ArrowDownIcon aria-hidden className="size-3" />
                      ) : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b align-top transition-colors duration-150 last:border-b-0 hover:bg-surface",
                  onRowClick && "cursor-pointer",
                  selectedKey === k && "bg-surface-hover hover:bg-surface-hover",
                )}
              >
                {leading ? (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {leading.cell(row)}
                  </td>
                ) : null}
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-3", c.align === "end" && "text-right", c.className)}>
                    {i === 0 && onRowClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick(row);
                        }}
                        className="rounded-sm text-left font-medium hover:underline"
                      >
                        {c.cell(row)}
                      </button>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul aria-label={label} className="md:hidden">
        {sorted.map((row) => {
          const k = rowKey(row);
          const body = (
            <>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{title.cell(row)}</span>
                {metas.map((c) => (
                  <span key={c.key} className="text-small text-muted-foreground">
                    {c.cell(row)}
                  </span>
                ))}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                {ends.map((c) => (
                  <span key={c.key}>{c.cell(row)}</span>
                ))}
              </span>
            </>
          );
          return (
            <li key={k} className={cn("flex items-start gap-3 border-b px-4 py-3 last:border-b-0", selectedKey === k && "bg-surface-hover")}>
              {leading ? <span className="pt-0.5">{leading.cell(row)}</span> : null}
              {onRowClick ? (
                <button type="button" onClick={() => onRowClick(row)} className="flex min-w-0 flex-1 justify-between gap-4 text-left">
                  {body}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 justify-between gap-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Filter chips: a row of toggle buttons with counts. */
export function FilterChips<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; count?: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-small font-medium transition-colors duration-150",
            value === o.value ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="text-caption tabular-nums text-muted-foreground">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
