import { resolveSession } from "@/lib/auth/session";
import { json, onboardingRoute, readJson, sameOrigin } from "@/lib/server/http";
import { createInvitation, listInvitations, OnboardingError } from "@/lib/server/onboarding";

/** Invitations act on the caller's active organization, and only for real accounts. */
async function realActor(request: Request) {
  const { actor, user } = await resolveSession(request);
  if (!user) throw new OnboardingError(401, "unauthenticated", "Sign in with your account to manage invitations.");
  if (!actor) throw new OnboardingError(403, "setup_required", "Create an organization first.");
  return { actor, user };
}

// GET /api/invitations -> { ok, invitations } for the active organization (staff only; never includes tokens).
export async function GET(request: Request) {
  return onboardingRoute(async () => {
    const { actor, user } = await realActor(request);
    return json({ ok: true, orgId: actor.orgId, invitations: await listInvitations(user, actor.orgId) });
  });
}

// POST /api/invitations { email, role: "organizer"|"controller"|"auditor" } -> invitation + one-time copy link.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const { actor, user } = await realActor(request);
    return json({ ok: true, ...(await createInvitation(user, actor.orgId, await readJson(request))) }, 201);
  });
}
