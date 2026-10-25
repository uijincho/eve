// Minimal Slack Web API client. No SDK: every call is one POST with the bot
// token. Errors carry only Slack's error code, never the token or a body.

import { unsafeSlackText } from "./text";

const BASE = "https://slack.com/api/";

export class SlackError extends Error {
  constructor(public readonly code: string) {
    super(`Slack API error: ${code}`);
    this.name = "SlackError";
  }
}

type Args = Record<string, unknown>;

const WRITE_METHODS = new Set(["chat.postMessage", "chat.update", "chat.postEphemeral", "views.open", "views.update", "views.publish", "files.completeUploadExternal"]);

export async function slackApi<T extends Args = Args>(token: string, method: string, args: Args = {}, opts: { form?: boolean } = {}): Promise<T> {
  if (WRITE_METHODS.has(method) && unsafeSlackText(args) !== null) throw new SlackError("unsafe_content");
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  let response: Response;
  try {
    response = await fetch(`${BASE}${method}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": opts.form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
      body: opts.form
        ? new URLSearchParams(entries.map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]))
        : JSON.stringify(Object.fromEntries(entries)),
    });
  } catch {
    throw new SlackError("unreachable");
  }
  if (response.status === 429) throw new SlackError("ratelimited");
  const json = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & T) | null;
  if (!json?.ok) throw new SlackError(json?.error ?? `http_${response.status}`);
  return json;
}

/** OAuth code exchange (client credentials, not a bot token). */
export async function exchangeOAuthCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  let response: Response;
  try {
    response = await fetch(`${BASE}oauth.v2.access`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, redirect_uri: redirectUri }),
    });
  } catch {
    throw new SlackError("unreachable");
  }
  const json = await response.json().catch(() => null) as {
    ok?: boolean; error?: string; access_token?: string; bot_user_id?: string; token_type?: string;
    team?: { id?: string; name?: string }; incoming_webhook?: { channel?: string; channel_id?: string };
  } | null;
  if (!json?.ok || json.token_type !== "bot" || !json.access_token || !json.team?.id || !json.bot_user_id) throw new SlackError(json?.error ?? "invalid_oauth_response");
  return {
    token: json.access_token, botUserId: json.bot_user_id, teamId: json.team.id, teamName: json.team.name ?? json.team.id,
    channelId: json.incoming_webhook?.channel_id ?? null, channelName: json.incoming_webhook?.channel ?? null,
  };
}

/** Uploads one PNG into a message thread (files.getUploadURLExternal, then completeUploadExternal). */
export async function uploadToThread(token: string, input: { channelId: string; threadTs: string; filename: string; title: string; bytes: Buffer }): Promise<void> {
  const { upload_url, file_id } = await slackApi<{ upload_url: string; file_id: string }>(token, "files.getUploadURLExternal", { filename: input.filename, length: String(input.bytes.length) }, { form: true });
  const url = new URL(upload_url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".slack.com")) throw new SlackError("invalid_upload_url");
  let uploaded: Response;
  try {
    uploaded = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(input.bytes) });
  } catch {
    throw new SlackError("unreachable");
  }
  if (!uploaded.ok) throw new SlackError(`upload_http_${uploaded.status}`);
  await slackApi(token, "files.completeUploadExternal", { files: [{ id: file_id, title: input.title }], channel_id: input.channelId, thread_ts: input.threadTs }, { form: true });
}
