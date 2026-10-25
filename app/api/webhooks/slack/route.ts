import { after } from "next/server";

import { readWebhookBody, verifySlackSignature } from "@/lib/agent/webhook-auth";
import { slackAppConfig } from "@/lib/slack/config";
import { handleCommand, handleEvent, handleInteraction } from "@/lib/slack/interactions";

export const maxDuration = 60;

/**
 * Every inbound Slack request: interactivity (buttons, modals), the /eve slash
 * command and the Events API. Slack's v0 signature is verified over the raw
 * body before anything is parsed. Work that can outlast Slack's 3-second limit
 * runs after the response and reports back in Slack.
 */
export async function POST(request: Request): Promise<Response> {
  const config = slackAppConfig();
  if (!config) return Response.json({ error: "The Slack app is not configured." }, { status: 503 });
  let raw: string;
  try { raw = await readWebhookBody(request); }
  catch { return Response.json({ error: "Body too large." }, { status: 413 }); }
  if (!verifySlackSignature(raw, request.headers.get("x-slack-signature"), request.headers.get("x-slack-request-timestamp"), config.signingSecret)) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  const defer = (task: () => Promise<void>) => after(async () => {
    try { await task(); } catch (error) { console.warn(`[slack] deferred work failed: ${error instanceof Error ? error.name : "error"}`); }
  });
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    // Events API. A retry means the first delivery already reached us; the work is idempotent, so acknowledge it.
    if (request.headers.get("x-slack-retry-num")) return new Response(null, { status: 200 });
    let body: Parameters<typeof handleEvent>[0];
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
    return handleEvent(body, defer);
  }
  const form = new URLSearchParams(raw);
  const payload = form.get("payload");
  if (payload) return handleInteraction(payload, defer);
  if (form.get("command")) return handleCommand(form);
  return new Response(null, { status: 200 });
}
