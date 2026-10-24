import { resolveSession } from "@/lib/auth/session";
import { json, onboardingRoute, sameOrigin } from "@/lib/server/http";
import { OnboardingError, revokeInvitation } from "@/lib/server/onboarding";

// POST /api/invitations/:id/revoke -> { ok, id, status: "revoked" } (organizers of the active org).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const { actor, user } = await resolveSession(request);
    if (!user) throw new OnboardingError(401, "unauthenticated", "Sign in with your account to manage invitations.");
    if (!actor) throw new OnboardingError(403, "setup_required", "Create an organization first.");
    const { id } = await ctx.params;
    return json({ ok: true, ...(await revokeInvitation(user, actor.orgId, id)) });
  });
}
