"use client";

import { cn } from "cn";

import { ActionButton } from "@/components/app/action-button";
import { FulfillAction } from "@/components/app/fulfill-action";
import { LinkButton } from "@/components/app/link-button";
import { ReasonAction } from "@/components/app/reason-action";
import { VerifyCode } from "@/components/app/verify-code";
import { Button } from "@/components/ui/button";
import type { AppSnapshot } from "@/lib/contracts";
import {
  canControl,
  canManage,
  canRelease,
  canReview,
  prizeOptions,
  FULFILLMENT_LABEL,
  type InboxItem,
  type Permission,
} from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

/**
 * The actions for one inbox item. In a row, the first is secondary and the
 * rest ghost; in the detail pane, the first is the view's one primary and
 * spans the pane.
 */
export function ItemActions({
  item,
  snapshot,
  layout,
  onEvidence,
}: {
  item: InboxItem;
  snapshot: AppSnapshot;
  layout: "row" | "pane";
  onEvidence: () => void;
}) {
  const { actor } = snapshot;
  const pane = layout === "pane";
  const first = pane ? ("default" as const) : ("secondary" as const);
  const wrap = cn("flex flex-wrap items-center gap-2", pane && "flex-col items-start");
  const evidence = (
    <Button size="sm" variant="ghost" onClick={onEvidence}>
      View evidence
    </Button>
  );
  const ref = item.ref;

  switch (ref.kind) {
    case "payouts": {
      const perms = ref.payouts.map((p) => canRelease(actor, p, snapshot));
      const allowed = ref.payouts.filter((_, i) => perms[i].allowed);
      const blocked = perms.find((p) => !p.allowed) as Extract<Permission, { allowed: false }> | undefined;
      const permission: Permission = allowed.length ? { allowed: true } : (blocked ?? { allowed: true });
      return (
        <div className={wrap}>
          <ActionButton
            variant={first}
            size={pane ? "default" : "sm"}
            wide={pane}
            label={allowed.length > 1 ? `Release ${allowed.length} payouts` : "Release payout"}
            pendingLabel="Releasing"
            permission={permission}
            call={payloads.payoutRelease(allowed.map((p) => p.id))}
          />
          {allowed.length && allowed.length < ref.payouts.length ? (
            <p className="text-small text-muted-foreground">
              {ref.payouts.length - allowed.length} not included: {blocked?.reason}
            </p>
          ) : null}
          <LinkButton href="/payouts" size="sm" variant="ghost">
            Open payouts
          </LinkButton>
        </div>
      );
    }
    case "payout": {
      const p = ref.payout;
      const manage = canManage(actor);
      if (p.status === "frozen") {
        return (
          <div className={wrap}>
            <VerifyCode personId={p.personId} personName={p.personName} permission={manage} primary={pane} />
            {evidence}
          </div>
        );
      }
      if (p.status === "failed" || p.status === "returned") {
        return (
          <div className={wrap}>
            <ActionButton variant={first} size={pane ? "default" : "sm"} wide={pane} label="Retry payout" pendingLabel="Retrying" permission={canControl(actor, snapshot)} call={payloads.payoutRetry(p.id)} />
            {evidence}
          </div>
        );
      }
      return (
        <div className={wrap}>
          <LinkButton href={`/people?person=${encodeURIComponent(p.personId)}`} size="sm" variant={pane ? "secondary" : "secondary"}>
            Open {p.personName.split(" ")[0]}&rsquo;s profile
          </LinkButton>
          {evidence}
        </div>
      );
    }
    case "claim": {
      const c = ref.claim;
      const perm = canReview(actor, c);
      return (
        <div className={wrap}>
          <ActionButton
            variant={first}
            size={pane ? "default" : "sm"}
            wide={pane}
            label="Approve"
            pendingLabel="Approving"
            permission={perm}
            call={payloads.claimReview(c.id, "approve", "Approved after review")}
          />
          {perm.allowed ? (
            <>
              <ReasonAction label="Reject" pendingLabel="Rejecting" prompt="Why is this claim rejected? The attendee sees this." build={(r) => payloads.claimReview(c.id, "reject", r)} />
              {c.status !== "needs_info" ? (
                <ReasonAction label="Ask for info" submitLabel="Send question" pendingLabel="Sending" prompt={`What should Eve ask ${c.personName.split(" ")[0]}?`} build={(r) => payloads.claimReview(c.id, "needs_info", r)} />
              ) : null}
            </>
          ) : null}
          {evidence}
        </div>
      );
    }
    case "award": {
      const a = ref.award;
      const manage = canManage(actor);
      const opts = prizeOptions(snapshot, a, ref.person, ref.payout);
      if (a.kind === "item" && a.fulfillment === "undecided" && opts.recommended !== "undecided") {
        return (
          <div className={wrap}>
            <ActionButton
              variant={first}
              size={pane ? "default" : "sm"}
              wide={pane}
              label="Accept recommendation"
              pendingLabel="Saving"
              permission={manage}
              call={payloads.awardChoose(a.id, opts.recommended)}
            />
            <LinkButton href={`/prizes?award=${encodeURIComponent(a.id)}`} size="sm" variant="ghost">
              Compare options
            </LinkButton>
            {evidence}
          </div>
        );
      }
      if (a.kind === "item" && (a.fulfillment === "ship" || a.fulfillment === "local") && a.status !== "paid") {
        return (
          <div className={wrap}>
            <FulfillAction award={a} snapshot={snapshot} layout={pane ? "pane" : "row"} />
            <LinkButton href={`/prizes?award=${encodeURIComponent(a.id)}`} size="sm" variant="ghost">
              Open prize
            </LinkButton>
            {evidence}
          </div>
        );
      }
      if (a.status === "ready" && !(a.teamId && !a.splitConfirmed) && (a.kind === "cash" || a.fulfillment === "cash")) {
        return (
          <div className={wrap}>
            <ActionButton
              variant={first}
              size={pane ? "default" : "sm"}
              wide={pane}
              label="Propose payout"
              pendingLabel="Proposing"
              permission={manage}
              call={payloads.payoutPropose(a.id, "award")}
            />
            {evidence}
          </div>
        );
      }
      return (
        <div className={wrap}>
          <LinkButton href={`/prizes?award=${encodeURIComponent(a.id)}`} size="sm" variant="secondary">
            Open prize{a.fulfillment !== "undecided" ? ` · ${FULFILLMENT_LABEL[a.fulfillment]}` : ""}
          </LinkButton>
          {evidence}
        </div>
      );
    }
    case "packet": {
      const k = ref.packet;
      const control = canControl(actor, snapshot);
      return (
        <div className={wrap}>
          {control.allowed ? (
            <ReasonAction
              label="Accept shortfall as a fee"
              variant="secondary"
              submitLabel="Accept and close"
              pendingLabel="Reconciling"
              prompt="Why is the short payment acceptable? This note stays on the ledger entry."
              build={(r) => payloads.sponsorReconcile(k.id, { acceptShortfall: true, note: r })}
            />
          ) : (
            <ActionButton variant={first} size={pane ? "default" : "sm"} wide={pane} label="Accept shortfall as a fee" permission={control} call={() => null} />
          )}
          <LinkButton href={`/sponsor?packet=${encodeURIComponent(k.id)}`} size="sm" variant="ghost">
            Open packet
          </LinkButton>
        </div>
      );
    }
    case "person": {
      return (
        <div className={wrap}>
          <LinkButton href={`/people?person=${encodeURIComponent(ref.person.id)}`} size="sm" variant="secondary">
            View chase log
          </LinkButton>
        </div>
      );
    }
  }
}
