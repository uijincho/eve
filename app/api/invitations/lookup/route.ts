import { json, onboardingRoute } from "@/lib/server/http";
import { lookupInvitation } from "@/lib/server/onboarding";

// GET /api/invitations/lookup?token=... -> { ok, orgName, role, emailMasked, status, expiresAt }. No session needed.
export async function GET(request: Request) {
  return onboardingRoute(async () => json({ ok: true, ...(await lookupInvitation(new URL(request.url).searchParams.get("token") ?? "")) }));
}
