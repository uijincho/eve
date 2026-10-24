"use client";

import { cn } from "cn";
import { createContext, useContext } from "react";

import { formatMoney, type MinorUnits } from "@/lib/design/money";

/** Set by the app when the org's own currency is not USD, so USD amounts read "US$". */
export const MoneyDisplay = createContext<{ explicitUsd: boolean }>({ explicitUsd: false });

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
  const { explicitUsd } = useContext(MoneyDisplay);
  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {estimate ? (
        <span className="font-normal text-muted-foreground">est. </span>
      ) : null}
      {formatMoney(amountMinor, currency, { signDisplay, explicitUsd })}
    </span>
  );
}
