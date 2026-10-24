import type { Metadata } from "next";

import { SetupView } from "@/components/app/views/setup-view";

export const metadata: Metadata = { title: "Organization setup · Eve" };

export default function Page() {
  return <SetupView />;
}
