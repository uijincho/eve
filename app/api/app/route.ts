import { buildSnapshot } from "@/lib/server/snapshot";
import { actorOrBootstrap, json } from "@/lib/server/http";

// GET /api/app -> AppSnapshot, filtered for the session's role.
export async function GET(request: Request) {
  const { actor, setCookie } = await actorOrBootstrap(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  const snapshot = await buildSnapshot(actor);
  return json(snapshot, 200, setCookie ? { "Set-Cookie": setCookie } : {});
}
