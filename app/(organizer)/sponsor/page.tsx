import type { Metadata } from "next";

import { SponsorView } from "@/components/app/views/sponsor-view";

export const metadata: Metadata = { title: "Sponsor · Eve" };

export default function Page() {
  return <SponsorView />;
}
