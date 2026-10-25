// Slack app configuration, categories and links back into Eve.

export interface SlackAppConfig { clientId: string; clientSecret: string; signingSecret: string }

/** Null until the three Slack app credentials are set (see slack/manifest.yml). */
export function slackAppConfig(): SlackAppConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  return clientId && clientSecret && signingSecret ? { clientId, clientSecret, signingSecret } : null;
}

/** Bot scopes requested at install. Kept in sync with slack/manifest.yml. */
export const SLACK_SCOPES = [
  "chat:write", "chat:write.public", "channels:join", "commands", "im:write", "files:write", "incoming-webhook",
] as const;

/** Public base URL for "Open in Eve" buttons and the OAuth redirect. */
export function appUrl(): string {
  const explicit = process.env.EVE_APP_URL ?? process.env.BETTER_AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

export function eveLink(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Direct-message categories a person may mute. Channel posts (failures, sponsor
 * exceptions, budget, computer use, tax rules, digests, event weekend) go to the
 * team channel and are not muted per person.
 */
export const DM_CATEGORIES = {
  release: "Payout batches ready for release",
  freeze: "Payouts frozen after a bank change",
  claims: "Escalated claims",
  prizes: "Prize decisions",
  overdue: "Approvals waiting too long (backup approver)",
} as const;
export type DmCategory = keyof typeof DM_CATEGORIES;

export const CHANNEL_CATEGORIES = {
  payouts: "Payout failures and returns",
  sponsor: "Sponsor reconciliation exceptions",
  budget: "Budget lines at 80% and 100%",
  computer_use: "Computer use runs",
  tax_rules: "Unverified tax rules in live decisions",
} as const;
export type ChannelCategory = keyof typeof CHANNEL_CATEGORIES;

export function isDmCategory(value: string): value is DmCategory {
  return Object.hasOwn(DM_CATEGORIES, value);
}

/** Informational alerts are posted together, at most once per window. */
export const ALERT_BATCH_MS = 15 * 60_000;
/** An approval waiting this long also goes to the backup approver. */
export const OVERDUE_RELEASE_MS = 48 * 60 * 60_000;
