import type { Metadata } from "next";

import { PortalPrizes } from "@/components/app/portal/prizes";

export const metadata: Metadata = { title: "Your prizes · Eve" };

export default function Page() {
  return <PortalPrizes />;
}
