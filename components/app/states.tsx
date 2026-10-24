"use client";

import { RotateCwIcon } from "lucide-react";

import { LinkButton } from "@/components/app/link-button";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/client/api";

/** Row skeletons at the geometry of a real list row. */
export function ListSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-xl border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="grid grid-cols-[minmax(0,1fr)_6rem] gap-6 border-b px-4 py-4 last:border-b-0">
          <div className="flex flex-col gap-2 py-0.5">
            <span className="h-3.5 w-2/5 animate-pulse rounded-sm bg-surface-hover" />
            <span className="h-3 w-3/5 animate-pulse rounded-sm bg-surface" />
          </div>
          <span className="h-3.5 w-16 animate-pulse justify-self-end rounded-sm bg-surface-hover" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void | Promise<void> }) {
  const signedOut = error.status === 401;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-input px-5 py-6">
      <p className="font-semibold">{signedOut ? "Sign in to continue" : error.status === 403 ? "You do not have access to this page" : "Eve could not load this page"}</p>
      <p className="max-w-[56ch] text-small text-muted-foreground">
        {signedOut
          ? "Your session ended. Sign in again, or pick a sample persona in the demo."
          : error.status === 403
            ? `${error.message.replace(/\.$/, "")}. Ask an organizer for an invitation if you need access.`
            : `${error.message.replace(/\.$/, "")}. Your data is unchanged; try again in a moment.`}
      </p>
      <div className="flex gap-2">
        {signedOut ? (
          <LinkButton size="sm" variant="secondary" href="/login">
            Sign in
          </LinkButton>
        ) : null}
        {onRetry ? (
          <Button size="sm" variant="ghost" onClick={async (event) => {
            const button = event.currentTarget;
            const main = button.closest("main");
            await onRetry();
            requestAnimationFrame(() => {
              // A successful reload removes this button. Keep keyboard users
              // at the recovered page instead of leaving focus on the body.
              if (button.isConnected) return;
              const heading = main?.querySelector("h1");
              if (heading) { heading.tabIndex = -1; heading.focus(); }
            });
          }}>
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-input px-5 py-8">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-[60ch] text-small text-muted-foreground">{children}</p>
    </div>
  );
}
