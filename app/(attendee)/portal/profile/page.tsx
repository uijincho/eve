import type { Metadata } from "next";

import { PortalProfile } from "@/components/app/portal/profile";

export const metadata: Metadata = { title: "Profile and tax form · Eve" };

export default function Page() {
  return <PortalProfile />;
}
