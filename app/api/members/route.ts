import { resolveSession } from "@/lib/auth/session";
import { json, onboardingRoute } from "@/lib/server/http";
import { listMembers, OnboardingError } from "@/lib/server/onboarding";

// GET /api/members -> { ok, orgId, members } for the active organization (organizer/controller/auditor; read-only).
export async function GET(request: Request) {
  return onboardingRoute(async () => {
    const { actor, user } = await resolveSession(request);
    if (!user) throw new OnboardingError(401, "unauthenticated", "Sign in with your account to view members.");
    if (!actor) throw new OnboardingError(403, "setup_required", "Create an organization first.");
    return json({ ok: true, orgId: actor.orgId, members: await listMembers(user, actor.orgId) });
  });
}
