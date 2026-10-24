import { getSessionUser, orgCookieHeader } from "@/lib/auth/session";
import { json, onboardingRoute, readJson, sameOrigin } from "@/lib/server/http";
import { acceptInvitation } from "@/lib/server/onboarding";

// POST /api/invitations/accept { token } -> { ok, orgId, memberId, role, alreadyAccepted }.
// The role comes from the invitation; the signed-in email must match the invited email.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const result = await acceptInvitation(await getSessionUser(request), await readJson(request));
    return json({ ok: true, ...result }, 200, { "Set-Cookie": orgCookieHeader(result.orgId) });
  });
}
