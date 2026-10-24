import type { Metadata } from "next";

import { PayoutsView } from "@/components/app/views/payouts-view";

export const metadata: Metadata = { title: "Payouts · Eve" };

export default function PayoutsPage() {
  return <PayoutsView />;
}
