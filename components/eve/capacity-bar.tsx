import { cn } from "cn";

import { Money } from "@/components/eve/money";
import { formatMoney } from "@/lib/design/money";

/**
 * Spent, committed, and remaining against a cap. The remaining figure sits at
 * the cap's end of the bar; going over turns the overflow critical.
 */
export function CapacityBar({
  label,
  capMinor,
  spentMinor,
  committedMinor = 0,
  currency = "USD",
  className,
}: {
  label: string;
  capMinor: number;
  spentMinor: number;
  committedMinor?: number;
  currency?: string;
  className?: string;
}) {
  const used = spentMinor + committedMinor;
  const over = Math.max(0, used - capMinor);
  const scale = Math.max(capMinor, used);
  const pct = (minor: number) => `${(minor / scale) * 100}%`;
  const remaining = capMinor - used;

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold">{label}</span>
        <span className="text-small text-muted-foreground">
          {over > 0 ? (
            <>
              <span className="font-semibold text-critical">
                <Money amountMinor={over} currency={currency} /> over
              </span>{" "}
              the <Money amountMinor={capMinor} currency={currency} /> cap
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">
                <Money amountMinor={remaining} currency={currency} /> left
              </span>{" "}
              of <Money amountMinor={capMinor} currency={currency} />
            </>
          )}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${formatMoney(spentMinor, currency)} spent, ${formatMoney(committedMinor, currency)} committed, cap ${formatMoney(capMinor, currency)}`}
        className="relative flex h-2 gap-0.5"
      >
        <span className="h-full rounded-sm bg-foreground" style={{ width: pct(Math.min(spentMinor, capMinor)) }} />
        {committedMinor > 0 && spentMinor < capMinor ? (
          <span
            className="h-full rounded-sm bg-chart-3"
            style={{ width: pct(Math.min(committedMinor, capMinor - spentMinor)) }}
          />
        ) : null}
        {over > 0 ? (
          <span className="h-full rounded-sm bg-critical" style={{ width: pct(over) }} />
        ) : (
          <span className="h-full flex-1 rounded-sm bg-surface-hover" />
        )}
        {over > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1 -bottom-1 w-px bg-foreground"
            style={{ left: pct(capMinor) }}
          />
        ) : null}
      </div>
      <div className="flex gap-4 text-caption text-muted-foreground">
        <Legend swatch="bg-foreground">
          Spent <Money amountMinor={spentMinor} currency={currency} />
        </Legend>
        {committedMinor > 0 ? (
          <Legend swatch="bg-chart-3">
            Committed <Money amountMinor={committedMinor} currency={currency} />
          </Legend>
        ) : null}
      </div>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-sm", swatch)} />
      <span>{children}</span>
    </span>
  );
}
