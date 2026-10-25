"use client";

import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { CopyLink } from "@/components/app/copy-link";
import { Field, NativeSelect } from "@/components/app/field";
import { LinkButton } from "@/components/app/link-button";
import type { AppSnapshot, SlackStatus } from "@/lib/contracts";
import { canOrganize } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";
import { initialParam } from "@/lib/client/url-param";

const RETURN_NOTE: Record<string, string> = {
  connected: "Slack is connected. Each organizer and controller now links their own account below.",
  cancelled: "Slack connection cancelled. Nothing changed.",
  taken: "That Slack workspace is already connected to another Eve organization.",
  forbidden: "Only an organizer can connect Slack.",
  unconfigured: "The Slack app is not configured on this server.",
  error: "Slack did not finish connecting. Try again.",
};

/** Settings → Slack: connect the workspace, link your own account, and route escalations. */
export function SlackSection({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [returned] = useState(() => initialParam("slack"));
  const slack = s.slack;
  if (!slack) return null;
  const note = returned ? RETURN_NOTE[returned] : null;
  return (
    <div className="flex max-w-xl flex-col gap-5">
      {note ? <p role="status" className="text-small">{note}</p> : null}
      {!slack.configured ? (
        <p className="text-small text-muted-foreground">
          The Slack app is not set up on this server. Add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET from the app created with slack/manifest.yml.
        </p>
      ) : !slack.installed ? (
        <NotConnected snapshot={s} />
      ) : (
        <Connected snapshot={s} slack={slack} />
      )}
    </div>
  );
}

function NotConnected({ snapshot: s }: { snapshot: AppSnapshot }) {
  const permission = canOrganize(s.actor);
  return (
    <>
      <p className="text-small text-muted-foreground">
        Approvals go by direct message to the person who must act, with Release, Approve and Hold buttons that use that person&apos;s Eve permissions. Informational alerts, the daily digest and event-weekend updates go to one team channel. Slack shows names, amounts and last 4 digits only.
      </p>
      {permission.allowed ? (
        <LinkButton external href="/api/slack/install" variant="default" size="sm" className="self-start">Connect Slack</LinkButton>
      ) : (
        <p className="text-small text-muted-foreground">{permission.reason}</p>
      )}
    </>
  );
}

function Connected({ snapshot: s, slack }: { snapshot: AppSnapshot; slack: SlackStatus }) {
  const [code, setCode] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const canLink = s.actor.role === "organizer" || s.actor.role === "controller";
  return (
    <>
      <p className="text-small">
        Connected to <span className="font-medium">{slack.teamName}</span>. Team channel: {slack.channelName ?? "none chosen; reconnect to pick one"}.
      </p>

      <div className="flex flex-col gap-3">
        <h3 className="text-small font-medium">Your Slack account</h3>
        {slack.me.linked ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-small text-muted-foreground">
              Linked. {slack.me.muted.length ? `Muted direct messages: ${slack.me.muted.join(", ")}.` : "No categories muted."} Mute categories in Eve&apos;s Home tab in Slack or with /eve mute.
            </span>
            <ActionButton label="Unlink" variant="ghost" call={payloads.slackUnlink()} />
          </div>
        ) : canLink ? (
          <>
            <p className="text-small text-muted-foreground">Linking proves the Slack account is yours: Eve shows a one-time code here, and you type it in Slack.</p>
            <ActionButton
              className="self-start"
              label={code ? "New code" : "Link Slack"}
              pendingLabel="Creating code"
              quietSuccess
              onDone={(r) => setCode(r.ok && typeof r.data?.code === "string" ? r.data.code : null)}
              call={payloads.slackLinkCode()}
            />
            {code ? <CopyLink label="Type this in Slack" url={`/eve link ${code}`} help="Works once, for your account only, and expires in 10 minutes." /> : null}
          </>
        ) : (
          <p className="text-small text-muted-foreground">Slack alerts are for organizers and controllers.</p>
        )}
      </div>

      <RoutingForm snapshot={s} slack={slack} />

      <ul className="flex flex-col divide-y rounded-xl border">
        {slack.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-small"><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">· {m.role}</span></span>
            <span className="text-small text-muted-foreground">{m.linked ? "Linked" : "Not linked"}</span>
          </li>
        ))}
      </ul>

      {disconnecting ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="destructive" label="Confirm disconnect" pendingLabel="Disconnecting" onDone={() => setDisconnecting(false)} call={payloads.slackDisconnect()} />
          <ActionButton variant="ghost" label="Keep Slack connected" call={() => { setDisconnecting(false); return null; }} />
        </div>
      ) : (
        <ActionButton className="self-start" variant="ghost" label="Disconnect Slack" permission={canOrganize(s.actor)} call={() => { setDisconnecting(true); return null; }} />
      )}
    </>
  );
}

function RoutingForm({ snapshot: s, slack }: { snapshot: AppSnapshot; slack: SlackStatus }) {
  const [onDuty, setOnDuty] = useState(slack.onDutyMemberId ?? "");
  const [backup, setBackup] = useState(slack.backupMemberId ?? "");
  const organizers = slack.members.filter((m) => m.role === "organizer");
  const label = (m: SlackStatus["members"][number]) => `${m.name} (${m.role})${m.linked ? "" : ", not linked"}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organizer on duty" help="Gets escalated claims and prize decisions.">
          {(p) => (
            <NativeSelect {...p} value={onDuty} onChange={(e) => setOnDuty(e.target.value)} disabled={!canOrganize(s.actor).allowed}>
              <option value="">Every linked organizer</option>
              {organizers.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Backup approver" help="Gets approvals that have waited too long.">
          {(p) => (
            <NativeSelect {...p} value={backup} onChange={(e) => setBackup(e.target.value)} disabled={!canOrganize(s.actor).allowed}>
              <option value="">Everyone else who can approve</option>
              {slack.members.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}
            </NativeSelect>
          )}
        </Field>
      </div>
      <ActionButton
        className="self-start"
        label="Save routing"
        pendingLabel="Saving"
        permission={canOrganize(s.actor)}
        call={payloads.slackSettings({ onDutyMemberId: onDuty || null, backupMemberId: backup || null })}
      />
    </div>
  );
}
