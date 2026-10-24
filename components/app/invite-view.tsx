"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";

import { AuthForm } from "@/components/app/auth-form";
import { LinkButton } from "@/components/app/link-button";
import { ResultText } from "@/components/app/result-text";
import { ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/client/api";
import { auth, homeFor, invitations, onboarding, type InviteLookup, type Onboarding } from "@/lib/client/account";
import { fmtDate, ROLE_LABEL } from "@/lib/client/format";

const STATUS_COPY: Record<string, string> = {
  accepted: "This invitation was already used. Sign in with the account that accepted it.",
  revoked: "This invitation was withdrawn. Ask the organizer for a new link.",
  expired: "This invitation expired. Invitations last 7 days; ask the organizer for a new link.",
};

const ACCEPT_ERRORS: Record<string, string> = {
  email_mismatch: "You are signed in with a different email than the one invited. Sign out and use the invited address.",
  already_member: "You are already a member of this organization.",
  expired: STATUS_COPY.expired,
  revoked: STATUS_COPY.revoked,
  used: STATUS_COPY.accepted,
  minor: "Eve only pays adults. The organizer has a date of birth on file under 18; contact them to correct it.",
  person_changed: "Your attendee record changed since the invite was sent. Ask the organizer for a new link.",
};

export function InviteRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <InviteView token={token} />;
}

/** Accept an invitation: check it, sign in or create the account, then join. */
export function InviteView({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [me, setMe] = useState<Onboarding | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loadMe = useCallback(() => onboarding.get().then(setMe).catch(() => setMe(null)), []);

  useEffect(() => {
    invitations
      .lookup(token)
      .then(setInvite)
      .catch((e: unknown) => setLookupError(e instanceof ApiError && e.status === 404 ? "This invitation link is not valid. Check that you copied all of it." : e instanceof ApiError ? e.message : "Eve could not be reached."));
    void loadMe();
  }, [token, loadMe]);

  const accept = async () => {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const r = await invitations.accept(token);
      router.replace(homeFor(r.role));
    } catch (e) {
      setFailure(e instanceof ApiError ? (ACCEPT_ERRORS[e.code ?? ""] ?? e.message) : "Eve could not be reached. Try again.");
      setPending(false);
    }
  };

  const role = invite ? (ROLE_LABEL[invite.role] ?? invite.role).toLowerCase() : "";
  const open = invite?.status === "pending";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <span className="text-heading">Eve</span>
      {lookupError ? (
        <div className="flex flex-col gap-2">
          <h1 className="text-title">Invitation not found</h1>
          <p className="text-small text-muted-foreground">{lookupError}</p>
          <LinkButton href="/login" variant="secondary" className="self-start">Go to sign in</LinkButton>
        </div>
      ) : !invite || me === undefined ? (
        <ListSkeleton rows={2} label="Checking the invitation" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-title">Join {invite.orgName}</h1>
            <p className="max-w-[56ch] text-small text-muted-foreground">
              {invite.role === "attendee"
                ? `Your organizer invited ${invite.emailMasked} to the attendee portal, where you sign tax forms, submit receipts, and see what you will be paid.`
                : `You are invited as ${role === "organizer" || role === "auditor" ? `an ${role}` : `a ${role}`} with ${invite.emailMasked}.`}{" "}
              {open ? `The link works once and expires ${fmtDate(invite.expiresAt, true)}.` : null}
            </p>
          </div>

          {!open ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-3 text-small">{STATUS_COPY[invite.status] ?? `This invitation is ${invite.status}.`}</p>
          ) : me ? (
            <div className="flex flex-col gap-3">
              <p className="text-small">
                Signed in as <span className="font-medium">{me.user.email}</span>.
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button onClick={accept} aria-busy={pending || undefined}>
                  {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
                  {pending ? "Joining" : `Join as ${role}`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await auth.signOut().catch(() => null);
                    setMe(null);
                  }}
                >
                  Use a different account
                </Button>
              </div>
              <span role="status" aria-live="polite">{failure ? <ResultText result={{ ok: false, message: failure }} /> : null}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-small text-muted-foreground">Create an account with the invited email, or sign in if you already have one.</p>
              <AuthForm initialMode="sign-up" emailHint={`Use the invited address, ${invite.emailMasked}.`} onSignedIn={loadMe} />
            </div>
          )}
        </>
      )}
    </main>
  );
}
