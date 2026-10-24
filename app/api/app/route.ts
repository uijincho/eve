import { buildSnapshot } from "@/lib/server/snapshot";
import { actorOrBootstrap, json } from "@/lib/server/http";

// GET /api/app -> AppSnapshot, filtered for the session's role.
export async function GET(request: Request) {
  const { actor, setCookie, setupRequired } = await actorOrBootstrap(request);
  if (setupRequired) return json({ ok: false, code: "setup_required", message: "Create an organization or accept an invitation to continue.", next: "/api/onboarding" }, 403);
  if (!actor) return json({ ok: false, code: "unauthenticated", message: "Sign in to continue." }, 401);
  const snapshot = await buildSnapshot(actor);
  return json(snapshot, 200, setCookie ? { "Set-Cookie": setCookie } : {});
}
