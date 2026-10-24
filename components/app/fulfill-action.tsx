"use client";

import { ActionButton } from "@/components/app/action-button";
import { TruthLabel } from "@/components/eve/truth-label";
import type { AppSnapshot, Award } from "@/lib/contracts";
import { canFulfill } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

/**
 * Confirms an item prize was shipped or bought locally. Delivery is simulated;
 * the server books the item's fair market value as reportable income and any
 * withholding the organization pays on top.
 */
export function FulfillAction({ award: a, snapshot: s, layout = "pane" }: { award: Award; snapshot: AppSnapshot; layout?: "pane" | "row" }) {
  const pane = layout === "pane";
  const label = a.fulfillment === "ship" ? "Confirm shipped" : "Confirm bought locally";
  return (
    <div className="flex w-full flex-col gap-2">
      <ActionButton
        wide={pane}
        size={pane ? "default" : "sm"}
        variant={pane ? "default" : "secondary"}
        label={label}
        pendingLabel="Confirming"
        permission={canFulfill(s.actor, a, s)}
        call={payloads.awardFulfill(a.id)}
      />
      {pane ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <TruthLabel kind="simulated" />
          Eve does not ship or buy anything. Confirming records the delivery and reports the item&rsquo;s value as income.
        </p>
      ) : null}
    </div>
  );
}
