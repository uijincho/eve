// Route-handler helpers: session resolution with the documented demo bootstrap.

import { DEMO_COOKIE, createDemoToken, demoCookieHeader, demoModeEnabled, loadDemoPersona, resolveActor, type ActorContext } from "@/lib/auth/session";

export const DEMO_ORG_ID = "org_demo_bluehour";
export const DEFAULT_DEMO_PERSONA = "mem_demo_dana";

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Resolves the actor. In demo mode only, a request with no session is given the
 * seeded organizer persona (Dana Whitfield) and a signed cookie, seeding the
 * demo org on first use. Outside demo mode there is no fallback.
 */
export async function actorOrBootstrap(request: Request): Promise<{ actor: ActorContext | null; setCookie?: string }> {
  const actor = await resolveActor(request);
  if (actor || !demoModeEnabled()) return { actor };
  const { ensureDemoOrg } = await import("./seed");
  await ensureDemoOrg();
  const persona = await loadDemoPersona(DEFAULT_DEMO_PERSONA, DEMO_ORG_ID);
  if (!persona) return { actor: null };
  return { actor: persona, setCookie: demoCookieHeader(createDemoToken(persona.memberId, persona.orgId)) };
}

export function clearDemoCookie() {
  return `${DEMO_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Rejects cross-site form posts for cookie-authenticated mutations. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; cookies are SameSite=Lax
  try {
    return new URL(origin).host === new URL(request.url).host || origin === process.env.BETTER_AUTH_URL;
  } catch {
    return false;
  }
}
