import { cn } from "cn";

import { Money } from "@/components/eve/money";
import { formatMoney } from "@/lib/design/money";

type Deduction = {
  label: string;
  amountMinor: number;
  kind: "withholding" | "fee";
};

const SWATCH = {
  net: "bg-foreground",
  withholding: "bg-chart-3",
  fee: "bg-chart-4",
} as const;

/**
 * Gross to net on one fixed scale, so net is visibly what is left.
 * Pass the same `scaleMinor` to several bars to compare them.
 */
export function BreakdownBar({
  grossMinor,
  deductions,
  currency = "USD",
  netLabel = "Est. net received",
  estimate = true,
  scaleMinor = grossMinor,
  className,
}: {
  grossMinor: number;
  deductions: Deduction[];
  currency?: string;
  netLabel?: string;
  estimate?: boolean;
  scaleMinor?: number;
  className?: string;
}) {
  const netMinor =
    grossMinor - deductions.reduce((sum, d) => sum + d.amountMinor, 0);
  const pct = (minor: number) => `${(minor / scaleMinor) * 100}%`;
  const segments = [
    { key: "net", minor: netMinor, className: SWATCH.net },
    ...deductions.map((d) => ({
      key: d.label,
      minor: d.amountMinor,
      className: SWATCH[d.kind],
    })),
  ].filter((s) => s.minor > 0);

  const summary = [
    `Gross ${formatMoney(grossMinor, currency)}`,
    ...deductions.map((d) => `${d.label} ${formatMoney(d.amountMinor, currency)}`),
    `${netLabel} ${formatMoney(netMinor, currency)}`,
  ].join(", ");

  return (
    <figure className={cn("flex flex-col gap-4", className)}>
      <div role="img" aria-label={summary} className="flex h-2 gap-0.5">
        {segments.map((s) => (
          <span
            key={s.key}
            className={cn("h-full rounded-sm", s.className)}
            style={{ width: pct(s.minor) }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
        <Row label="Gross" swatch="bg-transparent ring-1 ring-inset ring-input">
          <Money amountMinor={grossMinor} currency={currency} />
        </Row>
        {deductions.map((d) => (
          <Row key={d.label} label={d.label} swatch={SWATCH[d.kind]}>
            <Money
              amountMinor={-d.amountMinor}
              currency={currency}
              signDisplay="exceptZero"
            />
          </Row>
        ))}
        <Row label={netLabel} swatch={SWATCH.net} strong>
          <Money amountMinor={netMinor} currency={currency} estimate={estimate} />
        </Row>
      </dl>
    </figure>
  );
}

function Row({
  label,
  swatch,
  strong,
  children,
}: {
  label: string;
  swatch: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <span aria-hidden className={cn("size-2 rounded-sm", swatch)} />
      <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("text-right", strong && "font-semibold")}>{children}</dd>
    </>
  );
}
