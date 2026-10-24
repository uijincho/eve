import { z } from "zod";

import { activeSession, approve, getSession, labConfigured, pause, publicState, reject, run, screenshot, startSession, stopSession } from "@/lib/computer-use/lab";
import { SCENARIOS } from "@/lib/computer-use/packet";
import { json, sameOrigin } from "@/lib/server/http";

export const maxDuration = 60;

/**
 * The lab spends E2B and Claude credits on every click and has no sign-in, so it is on
 * for local development and off in production unless EVE_COMPUTER_USE_LAB=true.
 */
function labEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.EVE_COMPUTER_USE_LAB === "true";
}

const inputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), scenario: z.enum(["w8ben-retry", "strict-ssn"]) }).strict(),
  z.object({ op: z.literal("run"), id: z.string().uuid(), goal: z.enum(["action", "page", "review"]) }).strict(),
  z.object({ op: z.enum(["pause", "approve", "reject", "stop"]), id: z.string().uuid() }).strict(),
]);

export async function GET(request: Request) {
  if (!labEnabled()) return json({ ok: false, message: "The computer use lab is turned off." }, 404);
  const url = new URL(request.url);
  const session = activeSession();
  const shot = url.searchParams.get("shot");
  if (shot !== null) {
    const image = session && session.id === url.searchParams.get("id") ? screenshot(session, Number(shot)) : null;
    if (!image) return json({ ok: false, message: "No such screenshot." }, 404);
    return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  }
  const configured = labConfigured();
  return json({
    ok: true,
    configured: configured.ok,
    message: configured.ok ? null : configured.message,
    scenarios: Object.values(SCENARIOS),
    state: session ? publicState(session) : null,
  });
}

export async function POST(request: Request) {
  if (!labEnabled()) return json({ ok: false, message: "The computer use lab is turned off." }, 404);
  if (!sameOrigin(request)) return json({ ok: false, message: "Origin not allowed." }, 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, message: "That lab action is not recognized." }, 400);
  const input = parsed.data;

  if (input.op === "start") {
    const configured = labConfigured();
    if (!configured.ok) return json({ ok: false, message: configured.message }, 503);
    const session = await startSession(input.scenario);
    return json({ ok: true, state: publicState(session) });
  }

  const session = getSession(input.id);
  if (!session || session.id !== activeSession()?.id) return json({ ok: false, message: "That run is no longer active. Start a new one." }, 409);
  const result =
    input.op === "run" ? run(session, input.goal)
    : input.op === "approve" ? approve(session)
    : input.op === "reject" ? reject(session)
    : input.op === "pause" ? (pause(session), { ok: true, message: "Pausing after the current turn." })
    : (await stopSession(session), { ok: true, message: "Desktop deleted." });
  return json({ ...result, state: publicState(session) }, result.ok ? 200 : 409);
}
