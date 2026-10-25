import { resolveActor } from "@/lib/auth/session";
import { ActionError } from "@/lib/server/core";
import { authorizeUrl } from "@/lib/slack/install";

/** GET /api/slack/install: an organizer starts connecting the org's Slack workspace. */
export async function GET(request: Request): Promise<Response> {
  const back = (status: string) => Response.redirect(new URL(`/settings?slack=${status}`, request.url), 302);
  const actor = await resolveActor(request);
  if (!actor) return Response.redirect(new URL("/login", request.url), 302);
  try {
    return Response.redirect(authorizeUrl(actor), 302);
  } catch (error) {
    if (error instanceof ActionError) return back(error.status === 403 ? "forbidden" : "unconfigured");
    throw error;
  }
}
