import { cn } from "cn";

import { formatMoney, type MinorUnits } from "@/lib/design/money";

/** An amount from integer minor units. Estimates say so. */
export function Money({
  amountMinor,
  currency = "USD",
  estimate = false,
  signDisplay,
  className,
}: {
  amountMinor: MinorUnits;
  currency?: string;
  estimate?: boolean;
  signDisplay?: "auto" | "always" | "exceptZero";
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {estimate ? (
        <span className="font-normal text-muted-foreground">est. </span>
      ) : null}
      {formatMoney(amountMinor, currency, { signDisplay })}
    </span>
  );
}
