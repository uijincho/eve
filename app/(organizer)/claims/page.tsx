import type { Metadata } from "next";

import { ClaimsView } from "@/components/app/views/claims-view";

export const metadata: Metadata = { title: "Claims · Eve" };

export default function ClaimsPage() {
  return <ClaimsView />;
}
