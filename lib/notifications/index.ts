export type NotificationChannel = "portal" | "email" | "slack" | "discord";
export interface NotificationInput {
  channel: NotificationChannel;
  title: string;
  body: string;
  /** Internal idempotency key; no personal data. */
  key: string;
  recipientEmail?: string;
  /** Seeded events are always dry runs, even with real provider credentials. */
  synthetic: boolean;
}
export interface NotificationDelivery {
  status: "sent" | "simulated" | "queued";
  detail: string;
  providerRef?: string;
}

function webhookUrl(channel: "slack" | "discord"): URL | null {
  const value = channel === "slack" ? process.env.SLACK_WEBHOOK_URL : process.env.DISCORD_WEBHOOK_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = channel === "slack"
      ? url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/")
      : ["discord.com", "discordapp.com"].includes(url.hostname) && url.pathname.startsWith("/api/webhooks/");
    return allowed && url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

/** Adapter only. The caller persists the notice and owns durable retries/deduplication. */
export async function deliverNotification(input: NotificationInput): Promise<NotificationDelivery> {
  if (input.channel === "portal") return { status: "sent", detail: "Available in the attendee portal." };
  if (input.synthetic || process.env.EVE_NOTIFICATIONS_LIVE !== "true") {
    return { status: "simulated", detail: "Demo notification recorded; no external message sent." };
  }
  if (!input.title || input.title.length > 200 || input.body.length > 4000 || !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.key)) {
    return { status: "queued", detail: "Notification content needs review." };
  }
  try {
    if (input.channel === "email") {
      const email = input.recipientEmail;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /\.(?:test|invalid|example)$/i.test(email) || /@example\.(?:com|org|net)$/i.test(email)) {
        return { status: "simulated", detail: "No deliverable recipient is configured." };
      }
      const key = process.env.RESEND_API_KEY;
      const from = process.env.EVE_EMAIL_FROM;
      if (!key || !from) return { status: "simulated", detail: "Email provider not configured; portal notice is available." };
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": input.key },
        body: JSON.stringify({ from, to: [email], subject: input.title, text: input.body }),
      });
      if (!response.ok) return { status: "queued", detail: "Email delivery failed; the portal notice remains available." };
      const result = await response.json() as { id?: string };
      return { status: "sent", detail: "Email accepted by the provider.", providerRef: result.id };
    }
    const url = webhookUrl(input.channel);
    if (!url) return { status: "simulated", detail: `${input.channel === "slack" ? "Slack" : "Discord"} webhook not configured; notice recorded.` };
    const text = `${input.title}\n${input.body}`;
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.channel === "slack"
        ? { text, unfurl_links: false, unfurl_media: false }
        : { content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
    });
    return response.ok
      ? { status: "sent", detail: `${input.channel === "slack" ? "Slack" : "Discord"} notification delivered.` }
      : { status: "queued", detail: "Notification delivery failed; the portal notice remains available." };
  } catch {
    // Provider errors can include webhook URLs and API keys. Never persist raw errors.
    return { status: "queued", detail: "Notification provider is unavailable; the portal notice remains available." };
  }
}
