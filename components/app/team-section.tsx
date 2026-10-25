"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CopyLink } from "@/components/app/copy-link";
import { Field, NativeSelect } from "@/components/app/field";
import { ResultText } from "@/components/app/result-text";
import { ListSkeleton } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppSnapshot } from "@/lib/contracts";
import { ApiError } from "@/lib/client/api";
import { invitations, members, type CreatedInvite, type Invitation, type Member, type StaffRole } from "@/lib/client/account";
import { canManage } from "@/lib/client/derive";
import { fmtDate, ROLE_LABEL } from "@/lib/client/format";

const ROLE_HELP: Record<StaffRole, string> = {
  organizer: "Works the inbox, reviews claims, proposes payouts. Cannot release money.",
  controller: "Releases payouts and locks periods, never for payouts they requested.",
  auditor: "Reads every decision and its evidence. Cannot change anything.",
};

async function fetchTeam(): Promise<{ members: Member[]; invites: Invitation[] } | { error: string }> {
  try {
    const [m, i] = await Promise.all([members.list(), invitations.list().catch(() => ({ invitations: [] as Invitation[] }))]);
    return { members: m.members, invites: i.invitations.filter((x) => x.status === "pending") };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : "Could not load the team." };
  }
}

/** Who can sign in to this organization, and invitations for new staff. */
export function TeamSection({ snapshot: s }: { snapshot: AppSnapshot }) {
  // Sample personas are not accounts, so the sample org has no member list to show or invite into.
  if (s.demo) {
    return (
      <p className="max-w-[64ch] text-small text-muted-foreground">
        Sample personas aren&apos;t accounts, so invitations are off.
      </p>
    );
  }
  return <RealTeam snapshot={s} />;
}

function RealTeam({ snapshot: s }: { snapshot: AppSnapshot }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const manage = canManage(s.actor).allowed && s.actor.role === "organizer";

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchTeam>>) => {
    if ("error" in r) return setError(r.error);
    setList(r.members);
    setInvites(r.invites);
    setError(null);
  }, []);
  const load = useCallback(() => void fetchTeam().then(apply), [apply]);

  useEffect(() => {
    let live = true;
    fetchTeam().then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [apply]);

  return (
    <div className="flex flex-col gap-6">
      {error ? <ResultText result={{ ok: false, message: error }} /> : null}
      {!list && !error ? <ListSkeleton rows={3} label="Loading the team" /> : null}
      {list ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {list.filter((m) => m.role !== "attendee").map((m) => (
            <li key={m.memberId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {m.name}
                  {m.isYou ? <span className="font-normal text-muted-foreground"> · you</span> : null}
                </span>
                <span className="truncate text-small text-muted-foreground">{m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {m.demoPersona ? <Badge variant="secondary">Sample persona</Badge> : !m.hasAccount ? <Badge variant="outline">No account yet</Badge> : null}
                <span className="text-small">{ROLE_LABEL[m.role] ?? m.role}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {invites.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Waiting to accept</h3>
          <ul className="flex flex-col divide-y rounded-xl border">
            {invites.map((i) => (
              <PendingInvite key={i.id} invite={i} canRevoke={manage} onChanged={load} />
            ))}
          </ul>
        </div>
      ) : null}
      {manage ? <InviteStaffForm onCreated={load} /> : (
        <p className="text-small text-muted-foreground">Only organizers invite staff. Attendees join from People with a portal invite.</p>
      )}
    </div>
  );
}

function PendingInvite({ invite: i, canRevoke, onChanged }: { invite: Invitation; canRevoke: boolean; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="flex flex-col">
        <span className="font-medium">{i.email}</span>
        <span className="text-small text-muted-foreground">{ROLE_LABEL[i.role] ?? i.role} · expires {fmtDate(i.expiresAt)}</span>
      </span>
      {canRevoke ? (
        <span className="flex items-center gap-3">
          {failure ? <ResultText result={{ ok: false, message: failure }} /> : null}
          <Button
            size="sm"
            variant="ghost"
            aria-busy={pending || undefined}
            onClick={async () => {
              if (pending) return;
              setPending(true);
              try {
                await invitations.revoke(i.id);
                onChanged();
              } catch (e) {
                setFailure(e instanceof ApiError ? e.message : "Could not withdraw it.");
                setPending(false);
              }
            }}
          >
            {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
            {pending ? "Withdrawing" : "Withdraw"}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function InviteStaffForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("controller");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t pt-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email they will sign in with.");
        setError(null);
        setFailure(null);
        setPending(true);
        try {
          const r = await invitations.create(email.trim(), role);
          setCreated(r);
          setEmail("");
          onCreated();
        } catch (err) {
          setFailure(err instanceof ApiError ? err.message : "Eve could not be reached. No invitation was created.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h3 className="font-semibold">Invite staff</h3>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label="Email" error={error}>
          {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Role" help={ROLE_HELP[role]}>
          {(p) => (
            <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              <option value="controller">Controller</option>
              <option value="organizer">Organizer</option>
              <option value="auditor">Auditor</option>
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" aria-busy={pending || undefined}>
          {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
          {pending ? "Creating link" : "Create invite link"}
        </Button>
        <span role="status" aria-live="polite">{failure ? <ResultText result={{ ok: false, message: failure }} /> : null}</span>
      </div>
      {created ? <CopyLink url={created.acceptUrl} label={`Link for ${created.invitation.email} (${ROLE_LABEL[created.invitation.role] ?? created.invitation.role})`} /> : null}
    </form>
  );
}
