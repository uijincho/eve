// Text rules for everything Eve shows in Slack: names, amounts and last 4 digits,
// never a taxpayer ID, bank number or tax form. Free text (claim reasons, check
// details, controller notes) is scrubbed before it is placed on a card, and the
// API client refuses any message that still looks unsafe.

import { looksLikeTaxId } from "@/lib/computer-use/guards";

const TAX_ID = /(?<!\d)(\d{3}[-\s.]?\d{2}[-\s.]?\d{4}|\d{2}-\d{7})(?!\d)/g;
const LONG_DIGITS = /\d{7,}/g;

/** Masks anything shaped like a taxpayer ID or an account number in free text. */
export function scrub(text: string, max = 300): string {
  const one = text.replace(TAX_ID, "•••").replace(LONG_DIGITS, "•••").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Slack mrkdwn needs only these three escaped. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack renders this in each reader's own time zone; the fallback is UTC. */
export function slackDate(d: Date, format = "{date_short_pretty} at {time}"): string {
  return `<!date^${Math.floor(d.getTime() / 1000)}^${format}|${d.toISOString().slice(0, 16).replace("T", " ")} UTC>`;
}

const DISPLAY_KEYS = new Set(["text", "alt_text", "fallback", "initial_value", "title"]);
const SKIP_KEYS = new Set(["private_metadata", "value", "url", "action_id", "block_id", "callback_id"]);
const TOKENS = /<!date\^\d+\^[^>]*>|<[@#!][^>]*>|<https?:[^>|]*\|([^>]*)>|<https?:[^>]*>/g;

function displayText(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) displayText(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      if (typeof v === "string") {
        if (DISPLAY_KEYS.has(k)) out.push(v);
      } else displayText(v, out);
    }
  }
  return out;
}

/**
 * The first display string shaped like a taxpayer ID (SSN, ITIN, EIN) or a run
 * of 7+ digits (an account number), or null when the message is safe. Amounts
 * are grouped with commas and dates are Slack tokens, so neither matches.
 */
export function unsafeSlackText(args: Record<string, unknown>): string | null {
  for (const text of displayText(args)) {
    const visible = text.replace(TOKENS, (_, label: string | undefined) => label ?? "");
    if (looksLikeTaxId(visible) || /\d{7,}/.test(visible)) return visible;
  }
  return null;
}
