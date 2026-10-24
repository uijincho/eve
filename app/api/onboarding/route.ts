import { getSessionUser } from "@/lib/auth/session";
import { onboardingRoute, json } from "@/lib/server/http";
import { onboardingStatus } from "@/lib/server/onboarding";

// GET /api/onboarding -> the signed-in user's memberships, owned org and pending invitations.
export async function GET(request: Request) {
  return onboardingRoute(async () => json({ ok: true, ...(await onboardingStatus(await getSessionUser(request))) }));
}
