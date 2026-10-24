import type { Metadata } from "next";
import { Suspense } from "react";

import { InviteRoute } from "@/components/app/invite-view";

export const metadata: Metadata = { title: "Invitation · Eve", robots: { index: false } };

// Not async: the token is runtime data, so it resolves behind Suspense and the
// page shell stays static.
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <InviteRoute params={params} />
    </Suspense>
  );
}
