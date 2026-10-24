import { resolveSession } from "@/lib/auth/session";
import { json, onboardingRoute, readJson, sameOrigin } from "@/lib/server/http";
import { createAttendeeInvitation, OnboardingError } from "@/lib/server/onboarding";

// POST /api/invitations/attendee { personId } -> portal invite for an imported adult attendee (organizers).
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const { actor, user } = await resolveSession(request);
    if (!user) throw new OnboardingError(401, "unauthenticated", "Sign in with your account to manage invitations.");
    if (!actor) throw new OnboardingError(403, "setup_required", "Create an organization first.");
    return json({ ok: true, ...(await createAttendeeInvitation(user, actor.orgId, await readJson(request))) }, 201);
  });
}
