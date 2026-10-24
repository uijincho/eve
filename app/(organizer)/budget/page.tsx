import type { Metadata } from "next";

import { BudgetView } from "@/components/app/views/budget-view";

export const metadata: Metadata = { title: "Budget · Eve" };

export default function Page() {
  return <BudgetView />;
}
