// Route-handler helpers: session resolution with the documented demo bootstrap.

import { DEMO_COOKIE, createDemoToken, demoCookieHeader, demoModeEnabled, loadDemoPersona, resolveSession, type ActorContext } from "@/lib/auth/session";

import { isOnboardingError } from "./onboarding";

export const DEMO_ORG_ID = "org_demo_bluehour";
export const DEFAULT_DEMO_PERSONA = "mem_demo_dana";

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Resolves the actor. In demo mode only, an ANONYMOUS request is given the
 * seeded organizer persona (Dana Whitfield) and a signed cookie, seeding the
 * demo org on first use. A signed-in Better Auth user without a membership
 * never falls back to the demo: `setupRequired` tells the UI to send them to
 * onboarding. Outside demo mode there is no fallback at all.
 */
export async function actorOrBootstrap(request: Request): Promise<{ actor: ActorContext | null; setCookie?: string; setupRequired?: boolean }> {
  const { actor, user } = await resolveSession(request);
  if (actor) return { actor };
  if (user) return { actor: null, setupRequired: true };
  if (!demoModeEnabled()) return { actor: null };
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

/** Shared error mapping for onboarding/invitation routes. */
export async function onboardingRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (isOnboardingError(e)) return json({ ok: false, code: e.code, message: e.message }, e.status);
    throw e;
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
