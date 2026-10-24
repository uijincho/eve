import { resolveActor } from "@/lib/auth/session";
import { json, sameOrigin } from "@/lib/server/http";
import { runAuthorizedAction } from "@/lib/server/services";
import { buildSnapshot } from "@/lib/server/snapshot";

// POST /api/actions { action, payload } -> ActionResult (+ data.snapshot on success).
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-site request rejected." }, 403);
  const actor = await resolveActor(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Body must be JSON: { action, payload }." }, 400);
  }
  const { action, payload } = (body ?? {}) as { action?: unknown; payload?: unknown };
  if (typeof action !== "string") return json({ ok: false, message: "Missing action." }, 400);
  const { status, ...result } = await runAuthorizedAction(actor, action, payload ?? {});
  if (result.ok && action !== "flight.search") {
    // demo.reset may have replaced the actor's org data; persona ids are stable.
    const snapshot = await buildSnapshot(actor);
    return json({ ...result, data: { ...(result.data ?? {}), snapshot } }, status);
  }
  return json(result, status);
}
