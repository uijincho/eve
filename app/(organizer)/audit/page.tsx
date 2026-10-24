import type { Metadata } from "next";

import { AuditView } from "@/components/app/views/audit-view";

export const metadata: Metadata = { title: "Audit trail · Eve" };

export default function Page() {
  return <AuditView />;
}
