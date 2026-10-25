"use client";

import { ActionButton } from "@/components/app/action-button";
import { ReasonAction } from "@/components/app/reason-action";
import type { AppSnapshot, Claim } from "@/lib/contracts";
import { canReview } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

/**
 * Reject, ask, or approve, on one line with Approve filling the rest. A
 * reason form opens beneath the row so the buttons never jump.
 */
export function ClaimDecision({ claim: c, snapshot }: { claim: Claim; snapshot: AppSnapshot }) {
  const perm = canReview(snapshot.actor, c, snapshot);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {perm.allowed ? (
        <>
          <ReasonAction
            label="Reject"
            variant="destructive"
            size="default"
            formClassName="order-last"
            pendingLabel="Rejecting"
            prompt="Why is this claim rejected? The attendee sees this."
            build={(r) => payloads.claimReview(c.id, "reject", r)}
          />
          {c.status !== "needs_info" ? (
            <ReasonAction
              label="Ask for info"
              variant="outline"
              size="default"
              formClassName="order-last"
              submitLabel="Send question"
              pendingLabel="Sending"
              prompt={`What should Eve ask ${c.personName.split(" ")[0]}?`}
              build={(r) => payloads.claimReview(c.id, "needs_info", r)}
            />
          ) : null}
        </>
      ) : null}
      <ActionButton
        grow
        size="default"
        variant="default"
        label="Approve"
        pendingLabel="Approving"
        permission={perm}
        call={payloads.claimReview(c.id, "approve", "Approved after review")}
      />
    </div>
  );
}
