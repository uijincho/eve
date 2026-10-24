import { z } from "zod";
import { resolveActor } from "@/lib/auth/session";
import { startTaxChases } from "@/lib/agent/triggers";

export const maxDuration = 120;
const schema = z.object({ personId: z.string().min(1).max(100).optional(), acceleratedDemo: z.boolean().optional() }).strict();

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Origin not allowed." }, { status: 403 });
  const actor = await resolveActor(request);
  if (!actor || !["organizer", "controller"].includes(actor.role)) return Response.json({ error: "Organizer or controller access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid chase request." }, { status: 400 });
  if (parsed.data.acceleratedDemo && !actor.demo) return Response.json({ error: "Accelerated schedules are only available in the demo." }, { status: 403 });
  try {
    const runIds = await startTaxChases(actor.orgId, parsed.data);
    return Response.json({ ok: true, runIds, message: runIds.length ? "Scheduled form reminders started." : "No tax forms need a reminder." });
  } catch {
    return Response.json({ error: "The workflow service is unavailable. Existing reminders remain recorded." }, { status: 503 });
  }
}
