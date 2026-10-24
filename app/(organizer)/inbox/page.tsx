import type { Metadata } from "next";

import { InboxView } from "@/components/app/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox · Eve" };

// Overview is the organizer's home; the inbox is where decisions get made.
export default function InboxPage() {
  return <InboxView />;
}
