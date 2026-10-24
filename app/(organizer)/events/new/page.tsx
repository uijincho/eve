import type { Metadata } from "next";

import { EventSetupView } from "@/components/app/views/event-setup-view";

export const metadata: Metadata = { title: "Event setup · Eve" };

export default function Page() {
  return <EventSetupView />;
}
