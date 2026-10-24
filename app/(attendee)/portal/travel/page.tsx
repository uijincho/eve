import type { Metadata } from "next";

import { PortalTravel } from "@/components/app/portal/travel";

export const metadata: Metadata = { title: "Travel · Eve" };

export default function Page() {
  return <PortalTravel />;
}
