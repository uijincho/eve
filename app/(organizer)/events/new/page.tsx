import type { Metadata } from "next";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/app/states";
import { EventSetupView } from "@/components/app/views/event-setup-view";

export const metadata: Metadata = { title: "Event setup · Eve" };

export default function Page() {
  // The view reads ?tab= with useSearchParams, so it renders on the client below this boundary.
  return (
    <Suspense fallback={<ListSkeleton label="Loading event setup" />}>
      <EventSetupView />
    </Suspense>
  );
}
