import { z } from "zod";
import { resolveActor } from "@/lib/auth/session";
import { queueControllerRelease } from "@/lib/agent/release";

export const maxDuration = 120;
const inputSchema = z.object({ payoutId: z.string().min(1).max(100) }).strict();

/** Hook tokens and arbitrary payloads are never accepted from the browser. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, message: "Origin not allowed." }, { status: 403 });
  const actor = await resolveActor(request);
  if (!actor) return Response.json({ ok: false, message: "Sign in to release a payout." }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, message: "Provide a payout id." }, { status: 400 });
  const result = await queueControllerRelease(actor, [input.data.payoutId]);
  return Response.json(result, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
