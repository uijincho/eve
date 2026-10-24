import type { Metadata } from "next";

import { PersonaPicker } from "@/components/app/persona-picker";
import { EveProvider } from "@/lib/client/use-eve";

export const metadata: Metadata = { title: "Choose a sample persona · Eve" };

export default function LoginPage() {
  return (
    <EveProvider>
      <PersonaPicker />
    </EveProvider>
  );
}
