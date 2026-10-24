import { PortalShell } from "@/components/app/portal-shell";
import { EveProvider } from "@/lib/client/use-eve";

// Attendee portal at /portal: profile and tax form, claims, travel, prizes,
// and payouts for the signed-in attendee only.
export default function AttendeeLayout({ children }: { children: React.ReactNode }) {
  return (
    <EveProvider>
      <PortalShell>{children}</PortalShell>
    </EveProvider>
  );
}
