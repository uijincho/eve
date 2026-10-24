import type { Metadata } from "next";

import { PortalClaims } from "@/components/app/portal/claims";

export const metadata: Metadata = { title: "Your claims · Eve" };

export default function Page() {
  return <PortalClaims />;
}
