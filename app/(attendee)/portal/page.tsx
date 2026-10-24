import type { Metadata } from "next";

import { PortalOverview } from "@/components/app/portal/overview";

export const metadata: Metadata = { title: "Portal · Eve" };

export default function Page() {
  return <PortalOverview />;
}
