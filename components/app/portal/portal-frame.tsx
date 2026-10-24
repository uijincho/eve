"use client";

import { ErrorState, ListSkeleton } from "@/components/app/states";
import { LinkButton } from "@/components/app/link-button";
import type { AppSnapshot, Person } from "@/lib/contracts";
import { useEve } from "@/lib/client/use-eve";

/** Resolves the signed-in attendee's own person record for a portal page. */
export function PortalFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: (s: AppSnapshot, me: Person) => React.ReactNode;
}) {
  const { snapshot, error, loading, refresh } = useEve();
  const me = snapshot?.actor.personId ? snapshot.people.find((p) => p.id === snapshot.actor.personId) : undefined;
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title">{title}</h1>
        {lede ? <p className="max-w-[64ch] text-small text-muted-foreground">{lede}</p> : null}
      </div>
      {!snapshot ? (
        error ? <ErrorState error={error} onRetry={refresh} /> : loading ? <ListSkeleton rows={3} /> : null
      ) : !me ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-input px-5 py-6">
          <p className="font-semibold">This portal belongs to an attendee</p>
          <p className="max-w-[56ch] text-small text-muted-foreground">
            You are signed in as {snapshot.actor.name}, {snapshot.actor.role}. Switch to an attendee persona from the menu at the top right to see their portal, or go back to the organizer inbox.
          </p>
          <LinkButton href="/" size="sm" variant="secondary">Open the inbox</LinkButton>
        </div>
      ) : (
        children(snapshot, me)
      )}
    </main>
  );
}
