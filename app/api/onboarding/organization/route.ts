import { getSessionUser, orgCookieHeader } from "@/lib/auth/session";
import { json, onboardingRoute, readJson, sameOrigin } from "@/lib/server/http";
import { createOrganization } from "@/lib/server/onboarding";

// POST /api/onboarding/organization { org, event, budgets? } -> { ok, created, orgId, eventId, memberId }.
// Idempotent per user: a second call returns the organization they already created.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const result = await createOrganization(await getSessionUser(request), await readJson(request));
    return json({ ok: true, ...result }, result.created ? 201 : 200, { "Set-Cookie": orgCookieHeader(result.orgId) });
  });
}
