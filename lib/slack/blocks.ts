// Block Kit rendering for Eve's Slack messages, modals and App Home. Pure. Cards
// hold names, amounts and last 4 digits only; evidence stays behind "Open in Eve".

import { createHash } from "node:crypto";

import { DM_CATEGORIES, type DmCategory } from "./config";
import { CHOICE_LABEL, type Audience, type Choice, type InfoAlert, type Item, type Resolution } from "./model";
import { esc, slackDate } from "./text";

export type Block = Record<string, unknown>;
export interface SlackBody { text: string; blocks: Block[] }

const mrkdwn = (text: string) => ({ type: "mrkdwn", text });
const plain = (text: string) => ({ type: "plain_text", text: text.slice(0, 150), emoji: true });
const section = (text: string): Block => ({ type: "section", text: mrkdwn(text.slice(0, 3000)) });
const context = (...texts: string[]): Block => ({ type: "context", elements: texts.map(mrkdwn) });
const divider: Block = { type: "divider" };
const button = (actionId: string, text: string, value: string, style?: "primary" | "danger"): Block =>
  ({ type: "button", action_id: actionId, text: plain(text), value, ...(style ? { style } : {}) });
const linkButton = (text: string, url: string): Block => ({ type: "button", action_id: "eve.open", text: plain(text), url });
const actions = (blockId: string, elements: Block[]): Block => ({ type: "actions", block_id: blockId, elements });

const SAMPLE = "Sample data.";

export function fingerprint(body: SlackBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

function footer(item: Item, audience: Audience): Block[] {
  const notes: string[] = [];
  if (audience.kind === "member" && audience.backup) notes.push("You are the backup approver: this has waited past its review time. Your Eve permissions apply as usual.");
  if (audience.kind === "channel" && audience.why) notes.push(audience.why);
  if (item.demo) notes.push(SAMPLE);
  return notes.length ? [context(...notes.map(esc))] : [];
}

/** The open, actionable card for one item and audience. */
export function renderCard(item: Item, audience: Audience): SlackBody {
  const c = item.card;
  const open = linkButton("Open in Eve", item.url);
  switch (c.kind) {
    case "release": {
      const shown = c.lines.slice(0, 8).map((l) => `• ${esc(l.name)} · ${esc(l.source)} · *${l.net}*${l.destination ? ` ${esc(l.destination)}` : ""}`);
      if (c.lines.length > shown.length) shown.push(`…and ${c.lines.length - shown.length} more in Eve`);
      return {
        text: `Payout batch ready for release: ${c.count} payout(s), ${c.net} net`,
        blocks: [
          section(`*Payout batch ready for release*\n${c.count} payout${c.count === 1 ? "" : "s"} · *${c.net}* net · ${c.withheld} withheld · oldest since ${slackDate(c.oldestAt)}`),
          section(shown.join("\n")),
          ...(c.hold ? [context(`:double_vertical_bar: Held by ${esc(c.hold.by)}: ${esc(c.hold.reason)}`)] : []),
          context("Release runs Eve's final checks on the server: segregation of duties, the exact quoted terms, tax form, bank version and budget. Money moves only if they pass."),
          actions("eve.release", [button("eve.release", "Release", `${item.key}|${c.batchHash}`, "primary"), button("eve.hold", "Hold", `${item.key}|${c.batchHash}`), open]),
          ...footer(item, audience),
        ],
      };
    }
    case "freeze":
      return {
        text: `Payout frozen: ${c.personName}'s bank details changed`,
        blocks: [
          section(`*Payout frozen: bank details changed*\n${esc(c.personName)}'s payout account changed ${c.fromLast4 ? `from ••${c.fromLast4} ` : ""}to *••${c.toLast4}* (requested via ${esc(c.requestedVia)}, ${slackDate(c.requestedAt)}). ${c.payoutCount} payout${c.payoutCount === 1 ? "" : "s"}, *${c.net}* net, stay frozen until the change is confirmed through the original email on file.`),
          ...(c.kept ? [context(`Kept frozen by ${esc(c.kept.by)}.`)] : []),
          context("Mark verified asks for the 6-digit code that went to the attendee's original email. A confirmed change still needs a fresh controller release."),
          actions("eve.freeze", [button("eve.freeze.keep", "Keep frozen", c.methodId), button("eve.freeze.verify", "Mark verified", c.methodId, "primary"), linkButton("View evidence", item.url)]),
          ...footer(item, audience),
        ],
      };
    case "claim": {
      const checks = c.failed.map((f) => `• ${esc(f.label)}: ${esc(f.detail)}`).join("\n");
      return {
        text: `Escalated claim: ${c.personName}, ${c.amount}`,
        blocks: [
          section(`*Escalated claim*\n${esc(c.personName)} · ${esc(c.title)} · *${c.amount}*`),
          ...(checks ? [section(`*Checks that did not pass*\n${checks}`)] : []),
          ...(c.reason ? [section(`*Eve's reason*\n${esc(c.reason)}`)] : []),
          context(`${c.toController ? "Over the organizer approval limit, so a controller decides. " : ""}Review by ${slackDate(c.dueAt, "{date_short_pretty}")}.`),
          actions("eve.claim", [
            button("eve.claim.approve", "Approve", c.claimId, "primary"), button("eve.claim.reject", "Reject", c.claimId, "danger"),
            button("eve.claim.info", "Ask for info", c.claimId), open,
          ]),
          ...footer(item, audience),
        ],
      };
    }
    case "prize": {
      const options = c.options.filter((o) => o.available).map((o) => `• ${CHOICE_LABEL[o.choice]}: ${o.cost}${o.choice === c.recommended ? " (recommended)" : ""}`).join("\n");
      return {
        text: `Prize decision needed: ${c.personName}, ${c.title}`,
        blocks: [
          section(`*Prize decision needed*\n${esc(c.personName)} won *${esc(c.title)}* (${c.value}${c.country ? `, ${c.country}` : ""}). Ship it, buy it locally, or pay cash?`),
          section(`*Eve recommends: ${CHOICE_LABEL[c.recommended]}.* ${esc(c.why)}`),
          section(options),
          context(`Decide by ${slackDate(c.dueAt, "{date_short_pretty}")}. Costs are estimates. Fair market value is reportable either way.`),
          actions("eve.prize", [
            button("eve.prize.accept", `Accept: ${CHOICE_LABEL[c.recommended]}`, `${c.awardId}|${c.recommended}`, "primary"),
            button("eve.prize.compare", "Compare options", c.awardId), open,
          ]),
          ...footer(item, audience),
        ],
      };
    }
    case "winners": {
      const forms = c.needForms.slice(0, 12).map((p) => `• ${esc(p.name)} (${p.form})`);
      if (c.needForms.length > forms.length) forms.push(`…and ${c.needForms.length - forms.length} more`);
      const w8 = c.needForms.filter((p) => p.form.startsWith("W-8BEN")).length;
      return {
        text: `Winners entered: ${c.count}. ${c.needForms.length} need a tax form.`,
        blocks: [
          section(`*Winners entered: ${c.count}*\n${c.needForms.length ? `*${c.needForms.length}* need a tax form${w8 ? ` (${w8} W-8BEN)` : ""} before the closing ceremony, ${slackDate(c.closingAt)}.` : "Every adult winner has a valid tax form."}${c.closed ? " The closing ceremony has started." : ""}`),
          ...(forms.length ? [section(forms.join("\n"))] : []),
          ...(c.minors.length ? [context(`Under 18, so Eve cannot pay them: ${c.minors.map(esc).join(", ")}.`)] : []),
          actions("eve.winners", [linkButton("Open Prizes", item.url)]),
          ...footer(item, audience),
        ],
      };
    }
    case "countdown":
      return {
        text: `${c.left} to payout release: ${c.blockers.length} item(s) blocking`,
        blocks: [
          section(`*Payout release countdown*\n${c.left[0].toUpperCase()}${c.left.slice(1)} until the closing ceremony (${slackDate(c.closingAt, "{time}")}). Still blocking release:`),
          section(c.blockers.map((b) => `• ${esc(b)}`).join("\n")),
          actions("eve.countdown", [linkButton("Open Eve", item.url)]),
          ...footer(item, audience),
        ],
      };
  }
}

/** The edited original once nobody needs to act: no buttons, the outcome, and a link. */
export function renderResolved(res: Resolution, demo: boolean): SlackBody {
  return {
    text: `${res.title}: ${res.text}`,
    blocks: [
      section(`:white_check_mark: *${esc(res.title)}*\n${esc(res.text)}`),
      actions("eve.resolved", [linkButton("Open in Eve", res.url)]),
      ...(demo ? [context(SAMPLE)] : []),
    ],
  };
}

// -------------------------------------------------------------- batches

const ALERT_TITLE: Record<InfoAlert["category"], string> = {
  payouts: "Payouts", sponsor: "Sponsor", budget: "Budget", computer_use: "Computer use", tax_rules: "Tax rules",
};

/** One team-channel post for every informational alert queued in the last 15 minutes. */
export function renderAlertBatch(alerts: { category: string; text: string }[], demo: boolean, url: string): SlackBody {
  const blocks: Block[] = [section(`*Eve: ${alerts.length} update${alerts.length === 1 ? "" : "s"}*`)];
  for (const a of alerts.slice(0, 40)) blocks.push(context((ALERT_TITLE as Record<string, string>)[a.category] ?? "Eve"), section(a.text));
  blocks.push(actions("eve.alerts", [linkButton("Open Eve", url)]));
  if (demo) blocks.push(context(SAMPLE));
  return { text: `Eve: ${alerts.length} update(s). ${alerts[0]?.text.replace(/\*/g, "") ?? ""}`.slice(0, 300), blocks };
}

export interface DigestFacts {
  kind: "daily" | "weekend";
  title: string;
  since: Date;
  autoApproved: { count: number; total: string };
  payoutsSent: { count: number; net: string; withheld: string };
  missingForms: { name: string; form: string; reminders: number }[];
  inbox: { underDay: number; oneToThree: number; overThree: number };
  budgets: { name: string; spent: string; committed: string; remaining: string; over: boolean }[];
  url: string;
  demo: boolean;
}

export function renderDigest(d: DigestFacts): SlackBody {
  const chased = d.missingForms.slice(0, 8).map((p) => `• ${esc(p.name)} (${p.form})${p.reminders ? `: reminder ${Math.min(p.reminders, 4)} of 4 sent` : ": no reminder yet"}`);
  if (d.missingForms.length > chased.length) chased.push(`…and ${d.missingForms.length - chased.length} more`);
  const budget = d.budgets.map((b) => `• ${esc(b.name)}: ${b.spent} spent · ${b.committed} committed · ${b.over ? "*over by* " : ""}${b.remaining}${b.over ? "" : " left"}`);
  const inboxTotal = d.inbox.underDay + d.inbox.oneToThree + d.inbox.overThree;
  return {
    text: `${d.title}: ${d.autoApproved.count} claims auto-approved, ${d.payoutsSent.count} payouts sent, ${d.missingForms.length} tax forms missing, ${inboxTotal} inbox items`,
    blocks: [
      section(`*${esc(d.title)}*\nSince ${slackDate(d.since)}.`),
      { type: "section", fields: [
        mrkdwn(`*Auto-approved claims*\n${d.autoApproved.count} · ${d.autoApproved.total}`),
        mrkdwn(`*Payouts sent*\n${d.payoutsSent.count} · ${d.payoutsSent.net} net\n${d.payoutsSent.withheld} withheld`),
        mrkdwn(`*Inbox by age*\n${d.inbox.underDay} under a day · ${d.inbox.oneToThree} 1–3 days · ${d.inbox.overThree} older`),
        mrkdwn(`*Tax forms missing*\n${d.missingForms.length} payee${d.missingForms.length === 1 ? "" : "s"}`),
      ] },
      ...(chased.length ? [section(`*Who is being chased*\n${chased.join("\n")}`)] : []),
      ...(budget.length ? [section(`*Budget: spent, committed, remaining*\n${budget.join("\n")}`)] : []),
      divider,
      context("A summary, not an approval. Eve cannot release money."),
      actions("eve.digest", [linkButton("Open Eve", d.url)]),
      ...(d.demo ? [context(SAMPLE)] : []),
    ],
  };
}

// --------------------------------------------------------------- modals

export interface ModalMeta { ch?: string; ts?: string; key?: string; id: string; extra?: string }
const meta = (m: ModalMeta) => JSON.stringify(m);
const modal = (callbackId: string, title: string, submit: string, m: ModalMeta, blocks: Block[]): Block =>
  ({ type: "modal", callback_id: callbackId, title: plain(title.slice(0, 24)), submit: plain(submit), close: plain("Cancel"), private_metadata: meta(m), blocks });
const input = (blockId: string, label: string, el: Block, hint?: string): Block =>
  ({ type: "input", block_id: blockId, label: plain(label), element: el, ...(hint ? { hint: plain(hint) } : {}) });
const textInput = (multiline: boolean, initial?: string, maxLength = 500): Block =>
  ({ type: "plain_text_input", action_id: "value", multiline, max_length: maxLength, ...(initial ? { initial_value: initial } : {}) });

export type ReviewDecision = "approve" | "reject" | "needs_info";
const REVIEW = {
  approve: { title: "Approve claim", submit: "Approve", label: "Note for the record", initial: "Reviewed the receipt and checks in Slack; approved." },
  reject: { title: "Reject claim", submit: "Reject", label: "Reason the attendee will see", initial: undefined },
  needs_info: { title: "Ask for info", submit: "Send question", label: "What do you need from the attendee?", initial: undefined },
} as const;

export function reviewModal(decision: ReviewDecision, m: ModalMeta, summary: string): Block {
  const r = REVIEW[decision];
  return modal(`eve.claim.${decision}`, r.title, r.submit, m, [section(esc(summary)), input("reason", r.label, textInput(true, r.initial))]);
}

export function holdModal(m: ModalMeta, summary: string): Block {
  return modal("eve.hold", "Hold release", "Hold", m, [
    section(`${esc(summary)}\nHolding records your reason on each payout and pauses Slack nudges for this batch. It does not release or cancel anything.`),
    input("reason", "Why hold?", textInput(true, undefined, 300)),
  ]);
}

export function verifyModal(m: ModalMeta, summary: string): Block {
  return modal("eve.freeze.verify", "Confirm bank change", "Confirm", m, [
    section(`${esc(summary)}\nEnter the 6-digit code the attendee received at their original email. Never accept a code sent anywhere else.`),
    input("code", "Confirmation code", { type: "plain_text_input", action_id: "value", min_length: 6, max_length: 6 }, "Five attempts; codes expire after 30 minutes."),
  ]);
}

export function compareModal(m: ModalMeta, summary: string, options: { choice: Choice; cost: string; available: boolean }[], recommended: Choice): Block {
  const opts = options.filter((o) => o.available).map((o) => ({
    text: plain(`${CHOICE_LABEL[o.choice]}${o.choice === recommended ? " (recommended)" : ""}`), description: plain(o.cost), value: o.choice,
  }));
  const initial = opts.find((o) => o.value === recommended) ?? opts[0];
  return modal("eve.prize.compare", "Prize options", "Choose", m, [
    section(esc(summary)),
    input("choice", "Fulfillment", { type: "radio_buttons", action_id: "value", options: opts, ...(initial ? { initial_option: initial } : {}) }),
    context("Costs are estimates. Once a payout exists for this prize, the choice is locked."),
  ]);
}

// ------------------------------------------------------------- App Home

export interface HomeState {
  teamName: string; orgName: string; channelName: string | null;
  linked: { name: string; role: string; muted: string[] } | null; demo: boolean; url: string;
}

export function homeView(h: HomeState): Block {
  const blocks: Block[] = [section(`*Eve for ${esc(h.orgName)}*\nApprovals arrive here as direct messages for the person who must act. Informational alerts post in ${h.channelName ? esc(h.channelName) : "the team channel"} every 15 minutes, with a daily digest.`)];
  if (!h.linked) {
    blocks.push(section("*Link your Eve account*\n1. Open Eve → Settings → Slack and choose *Link Slack*.\n2. Type `/eve link CODE` here with the code Eve shows. Codes expire in 10 minutes."));
  } else {
    const all = Object.entries(DM_CATEGORIES) as [DmCategory, string][];
    const on = all.filter(([k]) => !h.linked!.muted.includes(k));
    const option = ([k, label]: [DmCategory, string]) => ({ text: plain(label), value: k });
    blocks.push(
      section(`Linked to *${esc(h.linked.name)}* (${h.linked.role}). Buttons use your Eve permissions, checked on the server, and every decision is logged "via Slack".`),
      divider,
      section("*Direct messages*\nUntick a category to mute it. If everyone who can act mutes something, it goes to the team channel instead."),
      { type: "actions", block_id: "eve.home", elements: [{ type: "checkboxes", action_id: "eve.home.mute", options: all.map(option), ...(on.length ? { initial_options: on.map(option) } : {}) }] },
    );
  }
  blocks.push(actions("eve.home.open", [linkButton("Open Eve", h.url)]), context(`Workspace: ${esc(h.teamName)}. Slack shows names, amounts and last 4 digits only.${h.demo ? ` ${SAMPLE}` : ""}`));
  return { type: "home", blocks };
}
