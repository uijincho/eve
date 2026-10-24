import type { Metadata } from "next";

import { PersonaPicker } from "@/components/app/persona-picker";
import { EveProvider } from "@/lib/client/use-eve";

export const metadata: Metadata = { title: "Sign in · Eve" };

export default function LoginPage() {
  return (
    <EveProvider guard={false}>
      <PersonaPicker />
    </EveProvider>
  );
}
