import { OrganizerShell } from "@/components/app/organizer-shell";
import { EveProvider } from "@/lib/client/use-eve";

// Organizer workspace: inbox, claims, prizes, payouts, people, budget,
// sponsor, audit, filings, agent, settings, and setup.
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <EveProvider>
      <OrganizerShell>{children}</OrganizerShell>
    </EveProvider>
  );
}
