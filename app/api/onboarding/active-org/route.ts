import { getSessionUser, orgCookieHeader } from "@/lib/auth/session";
import { json, onboardingRoute, readJson, sameOrigin } from "@/lib/server/http";
import { selectOrganization } from "@/lib/server/onboarding";

// POST /api/onboarding/active-org { orgId } -> sets the active organization (membership required).
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, code: "cross_site", message: "Cross-site request rejected." }, 403);
  return onboardingRoute(async () => {
    const result = await selectOrganization(await getSessionUser(request), await readJson(request));
    return json({ ok: true, ...result }, 200, { "Set-Cookie": orgCookieHeader(result.orgId) });
  });
}
