import type { Metadata } from "next";

import { OverviewView } from "@/components/app/views/overview-view";

export const metadata: Metadata = { title: "Overview · Eve" };

export default function Page() {
  return <OverviewView />;
}
