import type { Metadata } from "next";

import { PortalPayouts } from "@/components/app/portal/payouts";

export const metadata: Metadata = { title: "Your payouts · Eve" };

export default function Page() {
  return <PortalPayouts />;
}
