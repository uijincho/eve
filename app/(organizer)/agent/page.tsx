import type { Metadata } from "next";

import { AgentView } from "@/components/app/views/agent-view";

export const metadata: Metadata = { title: "Agent · Eve" };

export default function Page() {
  return <AgentView />;
}
