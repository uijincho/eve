import type { Metadata } from "next";

import { SettingsView } from "@/components/app/views/settings-view";

export const metadata: Metadata = { title: "Settings · Eve" };

export default function Page() {
  return <SettingsView />;
}
