"use client";

import { PageHeader } from "@/components/app/page-header";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import type { AppSnapshot } from "@/lib/contracts";
import { useEve } from "@/lib/client/use-eve";

/** Header plus loading and error handling around a page's snapshot view. */
export function PageFrame({
  title,
  lede,
  actions,
  toolbar,
  children,
}: {
  title: string;
  lede?: (s: AppSnapshot) => React.ReactNode;
  actions?: (s: AppSnapshot) => React.ReactNode;
  toolbar?: (s: AppSnapshot) => React.ReactNode;
  children: (s: AppSnapshot) => React.ReactNode;
}) {
  const { snapshot, error, loading, refresh } = useEve();
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={title}
        lede={snapshot && lede ? lede(snapshot) : undefined}
        actions={snapshot && actions ? actions(snapshot) : undefined}
      >
        {snapshot && toolbar ? toolbar(snapshot) : null}
      </PageHeader>
      <div className="flex flex-1 flex-col gap-8 px-4 py-5 sm:px-6">
        {snapshot ? children(snapshot) : error ? <ErrorState error={error} onRetry={refresh} /> : loading ? <ListSkeleton /> : null}
      </div>
    </main>
  );
}
