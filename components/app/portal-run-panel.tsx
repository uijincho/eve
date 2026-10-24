"use client";

import { cn } from "cn";
import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { ActionButton } from "@/components/app/action-button";
import { TruthLabel } from "@/components/eve/truth-label";
import { Badge } from "@/components/ui/badge";
import type { AppSnapshot, PortalRun, SponsorPacket } from "@/lib/contracts";
import { canControl, canManage, isPortalActive, PORTAL_STATUS, portalStatusLine } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

const TRAIL = [
  ["login", "Sign in"], ["payee", "Payee"], ["payment", "Payment"], ["documents", "Documents"], ["review", "Review"], ["submitted", "Submitted"],
] as const;

/**
 * Eve on the sponsor's portal for one packet: where it is, the live desktop while it works,
 * and the controller's decision at the Review page. Used on the packet sheet, in the inbox
 * detail pane and in the agent feed.
 */
export function PortalRunPanel({ run, packet, snapshot, live = true, actions = true }: {
  run: PortalRun;
  packet: SponsorPacket;
  snapshot: AppSnapshot;
  /** Embed the live desktop while the run is active. */
  live?: boolean;
  /** Show approve, reject and stop here. Off where the surrounding view has its own actions (the inbox pane). */
  actions?: boolean;
}) {
  const status = PORTAL_STATUS[run.status];
  const control = canControl(snapshot.actor, snapshot);
  const checks = run.reviewCheck ?? [];
  const differ = checks.filter((c) => !c.ok).length;
  return (
    <section aria-label="Eve on the sponsor portal" className="flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-subheading">Eve on the sponsor portal</h3>
        <span className="flex items-center gap-2">
          <TruthLabel kind="simulated" />
          <Badge variant={status.variant}>{status.label}</Badge>
        </span>
      </div>
      <p aria-live="polite" className="text-small text-muted-foreground">{portalStatusLine(run)}</p>

      <ol aria-label="Portal pages" className="flex flex-wrap items-center gap-1 text-caption">
        {TRAIL.map(([page, label], i) => {
          const current = run.page === page && isPortalActive(run);
          const visited = run.pagesVisited.includes(page);
          return (
            <li key={page} className="flex items-center gap-1">
              {i > 0 ? <ChevronRightIcon aria-hidden className="size-3 text-faint" /> : null}
              <span aria-current={current ? "step" : undefined} className={cn("inline-flex h-6 items-center gap-1 rounded-md px-1.5", current ? "bg-surface-hover font-medium text-foreground" : visited ? "text-foreground" : "text-muted-foreground")}>
                {visited && !current ? <CheckIcon aria-hidden className="size-3 text-positive" /> : null}
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {live && run.streamUrl ? (
        <div className="flex flex-col gap-1.5">
          <div className="overflow-hidden rounded-lg border bg-rail">
            <iframe src={run.streamUrl} title={`Live view of Eve filling the sponsor portal for ${packet.personName}, view only`} className="block aspect-[4/3] w-full" />
          </div>
          <p className="text-caption text-muted-foreground">Live view only. The desktop has no internet, and Chrome opens the portal and nothing else.</p>
        </div>
      ) : null}

      {run.status === "awaiting_approval" ? (
        <>
          {checks.length ? (
            <ul aria-label="Review page compared with the packet" className="flex flex-col text-small">
              {checks.map((c) => (
                <li key={c.label} className="flex flex-col border-b py-1.5 last:border-b-0">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="flex items-center gap-1.5 text-right">
                      {c.portal || "Not read"}
                      {c.ok ? <CheckIcon className="size-4 shrink-0 text-positive" aria-label="Matches the packet" /> : <XIcon className="size-4 shrink-0 text-critical" aria-label="Differs from the packet" />}
                    </span>
                  </span>
                  {!c.ok ? <span className="text-right text-caption text-critical">Packet: {c.packet}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-critical">Eve could not read the Review page back. Check the live view before approving.</p>
          )}
          {differ ? <p className="text-small text-critical">{differ} {differ === 1 ? "value differs" : "values differ"} from the packet. Reject unless you have checked the live view.</p> : null}
          {actions ? <div className="flex flex-col gap-2">
            <ActionButton wide size="default" variant="default" label="Approve and submit on the portal" pendingLabel="Approving" permission={control} call={payloads.portalDecide(run.id, "approve")} />
            <ActionButton wide size="default" variant="destructive" label="Reject" pendingLabel="Rejecting" permission={control} call={payloads.portalDecide(run.id, "reject")} />
          </div> : null}
          <p className="text-caption text-muted-foreground">Approving lets Eve press Submit once. Eve then marks the packet submitted as you, only after the portal&apos;s own records confirm it.</p>
        </>
      ) : null}

      {run.escalation ? (
        <dl className="flex flex-col gap-1.5 text-small">
          <div><dt className="text-muted-foreground">Portal field</dt><dd>{run.escalation.field}</dd></div>
          <div><dt className="text-muted-foreground">Eve&apos;s reason</dt><dd>{run.escalation.reason}</dd></div>
        </dl>
      ) : null}

      {run.confirmation ? (
        <p className="flex flex-col">
          <span className="text-small text-muted-foreground">Portal confirmation</span>
          <span className="font-semibold tabular-nums">{run.confirmation}</span>
        </p>
      ) : null}

      {actions && isPortalActive(run) && run.status !== "awaiting_approval" ? (
        <ActionButton variant="ghost" label="Stop Eve" pendingLabel="Stopping" permission={canManage(snapshot.actor)} call={payloads.portalStop(run.id)} className="self-start" />
      ) : null}
    </section>
  );
}
