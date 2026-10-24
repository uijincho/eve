import { z } from "zod";

import { createDemoToken, demoCookieHeader, demoModeEnabled, loadDemoPersona } from "@/lib/auth/session";
import { clearDemoCookie, json, sameOrigin } from "@/lib/server/http";

const body = z.strictObject({ personaId: z.string().min(1).max(80) });

// POST /api/demo/session { personaId } -> signed httpOnly demo session. Demo mode only.
export async function POST(request: Request) {
  if (!demoModeEnabled()) return json({ ok: false, message: "Demo sessions are disabled." }, 404);
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-site request rejected." }, 403);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, message: "personaId is required." }, 400);
  const persona = await loadDemoPersona(parsed.data.personaId);
  if (!persona) return json({ ok: false, message: "Unknown demo persona." }, 404);
  const actor = { id: persona.memberId, name: persona.name, email: persona.email, role: persona.role, personId: persona.personId ?? undefined };
  return json({ ok: true, actor }, 200, { "Set-Cookie": demoCookieHeader(createDemoToken(persona.memberId, persona.orgId)) });
}

export async function DELETE() {
  return json({ ok: true }, 200, { "Set-Cookie": clearDemoCookie() });
}
