import { and, eq } from "drizzle-orm";

import { resolveActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { document } from "@/lib/db/schema";
import { json } from "@/lib/server/http";

// GET /api/documents/:id -> the stored file, if the session may see it.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveActor(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  const { id } = await ctx.params;
  const [doc] = await getDb().select().from(document).where(and(eq(document.id, id), eq(document.orgId, actor.orgId)));
  // Attendees only see documents about themselves or that they uploaded; same 404 either way.
  if (!doc || (actor.role === "attendee" && doc.personId !== actor.personId && doc.uploadedBy !== actor.memberId)) {
    return json({ ok: false, message: "Not found." }, 404);
  }
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(doc.sizeBytes),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
