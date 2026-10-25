import { after } from "next/server";

import { resolveActor } from "@/lib/auth/session";
import { completeInstall } from "@/lib/slack/install";

export const maxDuration = 60;

/** GET /api/slack/oauth: Slack's redirect after consent. Must land in the same organizer's session that started it. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const back = (status: string) => Response.redirect(new URL(`/settings?slack=${status}`, request.url), 302);
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("error");
  const actor = await resolveActor(request);
  if (!actor) return Response.redirect(new URL("/login", request.url), 302);
  const result = await completeInstall(actor, code, url.searchParams.get("state"));
  if (!result.ok) return back(/another Eve organization/.test(result.message) ? "taken" : "error");
  after(async () => {
    const { kickSlack } = await import("@/lib/slack/kick");
    await kickSlack(actor.orgId);
  });
  return back("connected");
}
