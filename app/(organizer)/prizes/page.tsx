import type { Metadata } from "next";

import { PrizesView } from "@/components/app/views/prizes-view";

export const metadata: Metadata = { title: "Prizes · Eve" };

export default function PrizesPage() {
  return <PrizesView />;
}
