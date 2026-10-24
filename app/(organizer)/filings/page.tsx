import type { Metadata } from "next";

import { FilingsView } from "@/components/app/views/filings-view";

export const metadata: Metadata = { title: "Filings · Eve" };

export default function Page() {
  return <FilingsView />;
}
