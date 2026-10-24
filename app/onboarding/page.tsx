import type { Metadata } from "next";

import { OnboardingView } from "@/components/app/onboarding-view";

export const metadata: Metadata = { title: "Set up your organization · Eve" };

export default function OnboardingPage() {
  return <OnboardingView />;
}
