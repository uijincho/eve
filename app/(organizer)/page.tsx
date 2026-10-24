import type { Metadata } from "next";

import { InboxView } from "@/components/app/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox · Eve" };

// The PRD makes the inbox the organizer's home page.
export default function InboxPage() {
  return <InboxView />;
}
