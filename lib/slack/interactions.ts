// Inbound Slack requests, after the route verified Slack's signature: buttons,
// modal submissions, the /eve command and App Home. Every decision runs as the
// linked Eve member through the same server functions as the web app
// (runAuthorizedAction, queueControllerRelease), so permissions, segregation of
// duties and decision_log rows are identical; the rows also record via: "slack".
// Slack wants an answer within 3 seconds, so work runs in `defer` (next/server
// after()) and reports back in the card's thread.

import { and, eq } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { money, recordDecision, usd } from "@/lib/server/core";

import { slackApi, SlackError } from "./api";
import { compareModal, holdModal, homeView, reviewModal, verifyModal, type Block, type ModalMeta, type ReviewDecision } from "./blocks";
import { DM_CATEGORIES, eveLink, isDmCategory } from "./config";
import { botToken, redeemLinkCode, setMuted, slackIdentity, unlinkMember, type Installation, type SlackIdentity } from "./identity";
import { loadOrgState } from "./load";
import { currentBatch, recommendedChoice, CHOICE_LABEL, type Choice } from "./model";
import { syncSlackSafe } from "./sync";
import { esc, scrub } from "./text";

export type Defer = (task: () => Promise<void>) => void;

const NOT_LINKED = "Your Slack account is not linked to Eve yet, so Eve cannot tell who you are. In Eve, open Settings → Slack, choose *Link Slack*, then type `/eve link CODE` here.";
const ack = () => new Response(null, { status: 200 });
const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });

interface Where { channelId?: string; messageTs?: string; userId: string }

/** Answers in the card's thread: a DM thread reply, or an ephemeral reply in a shared channel. */
async function reply(inst: Installation, where: Where, text: string) {
  const token = botToken(inst);
  try {
    if (!where.channelId) {
      const { channel } = await slackApi<{ channel: { id: string } }>(token, "conversations.open", { users: where.userId });
      await slackApi(token, "chat.postMessage", { channel: channel.id, text });
    } else if (where.channelId.startsWith("D")) {
      await slackApi(token, "chat.postMessage", { channel: where.channelId, text, thread_ts: where.messageTs });
    } else {
      await slackApi(token, "chat.postEphemeral", { channel: where.channelId, user: where.userId, text, thread_ts: where.messageTs });
    }
  } catch (error) {
    console.warn(`[slack] reply failed: ${error instanceof SlackError ? error.code : "error"}`);
  }
}

/** Slack allows 3 seconds from the click; a late or refused open is reported instead of failing the request. */
async function openModal(inst: Installation, triggerId: string, view: Block, where: Where, defer: Defer) {
  try {
    await slackApi(botToken(inst), "views.open", { trigger_id: triggerId, view });
  } catch (error) {
    console.warn(`[slack] modal not opened: ${error instanceof SlackError ? error.code : "error"}`);
    defer(() => reply(inst, where, "Slack could not open the form in time. Press the button again."));
  }
}

// ------------------------------------------------------------- payloads

interface BlockActionsPayload {
  type: "block_actions";
  team: { id: string }; user: { id: string }; trigger_id: string;
  actions: { action_id: string; value?: string; selected_options?: { value: string }[] }[];
  container?: { channel_id?: string; message_ts?: string; type?: string };
  channel?: { id: string }; message?: { ts: string };
}
interface ViewSubmissionPayload {
  type: "view_submission";
  team: { id: string }; user: { id: string };
  view: { callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string | null; selected_option?: { value: string } | null }>> } };
}
type InteractionPayload = BlockActionsPayload | ViewSubmissionPayload | { type: string; team?: { id: string }; user?: { id: string } };

export async function handleInteraction(raw: string, defer: Defer): Promise<Response> {
  let payload: InteractionPayload;
  try { payload = JSON.parse(raw) as InteractionPayload; } catch { return new Response("Bad payload", { status: 400 }); }
  if (!payload.team?.id || !payload.user?.id) return ack();
  const identity = await slackIdentity(payload.team.id, payload.user.id);
  if (!identity) return ack();
  if (payload.type === "block_actions") return blockActions(payload as BlockActionsPayload, identity, defer);
  if (payload.type === "view_submission") return viewSubmission(payload as ViewSubmissionPayload, identity, defer);
  return ack();
}

// --------------------------------------------------------- block actions

async function blockActions(p: BlockActionsPayload, id: SlackIdentity, defer: Defer): Promise<Response> {
  const action = p.actions[0];
  if (!action || action.action_id === "eve.open") return ack();
  const where: Where = { channelId: p.container?.channel_id ?? p.channel?.id, messageTs: p.container?.message_ts ?? p.message?.ts, userId: p.user.id };
  const { inst, actor } = id;
  if (action.action_id === "eve.home.mute") {
    if (!actor) return ack();
    const on = new Set((action.selected_options ?? []).map((o) => o.value));
    defer(async () => {
      await setMuted(actor.memberId, Object.keys(DM_CATEGORIES).filter((k) => !on.has(k)));
      await publishHome(inst.teamId, p.user.id);
    });
    return ack();
  }
  if (!actor) { defer(() => reply(inst, where, NOT_LINKED)); return ack(); }
  const value = action.value ?? "";
  const m = (extra: Partial<ModalMeta> & { id: string }): ModalMeta => ({ ch: where.channelId, ts: where.messageTs, ...extra });
  const open = (view: Block) => openModal(inst, p.trigger_id, view, where, defer);
  switch (action.action_id) {
    case "eve.release": {
      const [key, hash] = value.split("|");
      defer(() => releaseBatch(id, actor, key, hash, where));
      return ack();
    }
    case "eve.hold": {
      const [key, hash] = value.split("|");
      await open(holdModal(m({ id: hash, key }), "Hold this payout batch?"));
      return ack();
    }
    case "eve.claim.approve": case "eve.claim.reject": case "eve.claim.info": {
      const decision: ReviewDecision = action.action_id === "eve.claim.approve" ? "approve" : action.action_id === "eve.claim.reject" ? "reject" : "needs_info";
      const [claim] = await getDb().select({ c: s.claim, name: s.person.name }).from(s.claim).innerJoin(s.person, eq(s.person.id, s.claim.personId))
        .where(and(eq(s.claim.id, value), eq(s.claim.orgId, actor.orgId)));
      if (!claim) { defer(() => reply(inst, where, "That claim no longer exists in Eve.")); return ack(); }
      await open(reviewModal(decision, m({ id: value }), `${claim.name} · ${claim.c.merchant} · ${usd(claim.c.usdMinor)}`));
      return ack();
    }
    case "eve.freeze.keep":
      defer(() => keepFrozen(id, actor, value, where));
      return ack();
    case "eve.freeze.verify": {
      const [row] = await getDb().select({ last4: s.payoutMethod.last4, name: s.person.name }).from(s.payoutMethod).innerJoin(s.person, eq(s.person.id, s.payoutMethod.personId))
        .where(and(eq(s.payoutMethod.id, value), eq(s.payoutMethod.orgId, actor.orgId)));
      if (!row) { defer(() => reply(inst, where, "That bank change no longer exists in Eve.")); return ack(); }
      await open(verifyModal(m({ id: value }), `${row.name}: new account ••${row.last4}.`));
      return ack();
    }
    case "eve.prize.accept": {
      const [awardId, choice] = value.split("|");
      defer(() => choosePrize(id, actor, awardId, choice as Choice, where));
      return ack();
    }
    case "eve.prize.compare": {
      const [row] = await getDb().select({ a: s.award, name: s.person.name }).from(s.award).innerJoin(s.person, eq(s.person.id, s.award.personId))
        .where(and(eq(s.award.id, value), eq(s.award.orgId, actor.orgId)));
      if (!row) { defer(() => reply(inst, where, "That prize no longer exists in Eve.")); return ack(); }
      const a = row.a;
      const options = [
        { choice: "ship" as const, cost: `${usd(a.shippingMinor)} shipping and duty`, available: a.shippingMinor > 0n },
        { choice: "local" as const, cost: `${usd(a.localMinor)} local price`, available: a.localMinor > 0n },
        { choice: "cash" as const, cost: `${money(a.amountMinor, a.currency)} cash`, available: true },
      ];
      await open(compareModal(m({ id: a.id }), `${row.name} · ${a.title} (${money(a.amountMinor, a.currency)}). ${scrub(a.recommendation, 400)}`, options, recommendedChoice(a.recommendation)));
      return ack();
    }
    default:
      return ack();
  }
}

// ------------------------------------------------------ modal submissions

async function viewSubmission(p: ViewSubmissionPayload, id: SlackIdentity, defer: Defer): Promise<Response> {
  const { inst, actor } = id;
  let meta: ModalMeta;
  try { meta = JSON.parse(p.view.private_metadata) as ModalMeta; } catch { return ack(); }
  const where: Where = { channelId: meta.ch, messageTs: meta.ts, userId: p.user.id };
  if (!actor) { defer(() => reply(inst, where, NOT_LINKED)); return ack(); }
  const values = p.view.state.values;
  const text = (block: string) => (values[block]?.value?.value ?? "").trim();
  const errors = (block: string, message: string) => json({ response_action: "errors", errors: { [block]: message } });
  const cb = p.view.callback_id;
  if (cb.startsWith("eve.claim.")) {
    const decision = cb.slice("eve.claim.".length) as ReviewDecision;
    const reason = text("reason");
    if (!reason) return errors("reason", "Add a reason. It is recorded with the decision.");
    defer(() => runAs(id, actor, "claim.review", { id: meta.id, decision, reason }, where));
    return ack();
  }
  if (cb === "eve.freeze.verify") {
    const code = text("code");
    if (!/^\d{6}$/.test(code)) return errors("code", "Enter the 6 digits from the attendee's original email.");
    defer(() => runAs(id, actor, "payout.verify", { id: meta.id, confirmation: code, decision: "confirm" }, where));
    return ack();
  }
  if (cb === "eve.prize.compare") {
    const choice = values.choice?.value?.selected_option?.value;
    if (choice !== "ship" && choice !== "local" && choice !== "cash") return errors("choice", "Choose how to fulfill the prize.");
    defer(() => choosePrize(id, actor, meta.id, choice, where));
    return ack();
  }
  if (cb === "eve.hold") {
    const reason = text("reason");
    if (reason.length < 3) return errors("reason", "Say why, so the other controllers know.");
    defer(() => holdBatch(id, actor, meta.id, reason, where));
    return ack();
  }
  return ack();
}

// ------------------------------------------------------------- handlers

async function runAs(id: SlackIdentity, actor: ActorContext, action: string, payload: Record<string, unknown>, where: Where) {
  const { runAuthorizedAction } = await import("@/lib/server/services");
  const result = await runAuthorizedAction(actor, action, payload);
  await reply(id.inst, where, `${result.ok ? ":white_check_mark:" : ":no_entry:"} ${esc(scrub(result.message, 600))}`);
  await syncSlackSafe(actor.orgId);
}

async function choosePrize(id: SlackIdentity, actor: ActorContext, awardId: string, choice: Choice, where: Where) {
  if (!(choice in CHOICE_LABEL)) return;
  await runAs(id, actor, "award.choose", { id: awardId, fulfillment: choice }, where);
}

/**
 * Release goes through the same queueControllerRelease as the web button. It is
 * bound to the batch the controller saw: if any payout or its terms changed, the
 * card is refreshed and nothing is released.
 */
async function releaseBatch(id: SlackIdentity, actor: ActorContext, key: string, hash: string, where: Where) {
  const st = await loadOrgState(id.inst);
  const batch = currentBatch(st);
  if (!batch || batch.hash !== hash) {
    await reply(id.inst, where, "This batch changed after the card was drawn, so nothing was released. The card is refreshed; review it and press Release again.");
    await syncSlackSafe(actor.orgId);
    return;
  }
  const { queueControllerRelease } = await import("@/lib/agent/release");
  const result = await queueControllerRelease(actor, batch.payouts.map((p) => p.id));
  const data = (result.data ?? {}) as { queued?: unknown[]; completed?: unknown[]; failed?: { payoutId: string; reason: string }[] };
  const name = (payoutId: string) => {
    const p = batch.payouts.find((x) => x.id === payoutId);
    return p ? `${st.people.get(p.personId)?.name ?? "A recipient"} (${money(p.netMinor, p.currency)})` : "A payout";
  };
  const mine = (data.failed ?? []).filter((f) => /requester/i.test(f.reason));
  const other = (data.failed ?? []).filter((f) => !/requester/i.test(f.reason));
  const lines: string[] = [];
  if (data.queued?.length) lines.push(`:white_check_mark: Release requested for ${data.queued.length} payout${data.queued.length === 1 ? "" : "s"}. Eve is running the final checks; this card updates when they finish.`);
  if (mine.length) lines.push(`:no_entry: You requested ${mine.length === batch.payouts.length ? "this batch" : `${mine.length} of these payouts`}, so another controller must release ${mine.length === 1 ? "it" : "them"}: ${mine.map((f) => name(f.payoutId)).join(", ")}.`);
  for (const f of other) lines.push(`:no_entry: ${name(f.payoutId)}: ${scrub(f.reason)}`);
  if (!lines.length) lines.push(esc(scrub(result.message)));
  await reply(id.inst, where, lines.join("\n"));
  await syncSlackSafe(actor.orgId);
}

/** A recorded controller decision not to release this batch yet. No payout state changes; the batch hash scopes it. */
async function holdBatch(id: SlackIdentity, actor: ActorContext, hash: string, reason: string, where: Where) {
  if (actor.role !== "controller") { await reply(id.inst, where, ":no_entry: Only a controller can hold a release."); return; }
  const st = await loadOrgState(id.inst);
  const batch = currentBatch(st);
  if (!batch || batch.hash !== hash) { await reply(id.inst, where, "This batch changed after the card was drawn, so nothing was held. The card is refreshed."); await syncSlackSafe(actor.orgId); return; }
  const note = scrub(reason, 300);
  await getDb().transaction(async (tx) => {
    for (const p of batch.payouts) {
      await recordDecision(tx, {
        orgId: actor.orgId, objectType: "payout", objectId: p.id, personId: p.personId, personName: st.people.get(p.personId)?.name ?? "",
        action: "slack.hold", summary: `${actor.name} held the release in Slack: ${note}. Nothing was released or cancelled; any controller can still release it.`,
        actor, status: "waiting", tool: "slack", facts: { batchHash: hash, reason: note },
      });
    }
  });
  await reply(id.inst, where, `Held. Your reason is recorded on ${batch.payouts.length} payout${batch.payouts.length === 1 ? "" : "s"}.`);
  await syncSlackSafe(actor.orgId);
}

/** "Keep frozen": a recorded acknowledgement. The freeze itself lifts only through the original-contact code. */
async function keepFrozen(id: SlackIdentity, actor: ActorContext, methodId: string, where: Where) {
  if (actor.role !== "organizer" && actor.role !== "controller") { await reply(id.inst, where, ":no_entry: Only organizers and controllers can act on a frozen payout."); return; }
  const [m] = await getDb().select({ m: s.payoutMethod, name: s.person.name }).from(s.payoutMethod).innerJoin(s.person, eq(s.person.id, s.payoutMethod.personId))
    .where(and(eq(s.payoutMethod.id, methodId), eq(s.payoutMethod.orgId, actor.orgId)));
  if (!m || m.m.status !== "pending_verification") { await reply(id.inst, where, "This bank change is already resolved."); await syncSlackSafe(actor.orgId); return; }
  if (actor.personId === m.m.personId) { await reply(id.inst, where, ":no_entry: You cannot act on your own payout."); return; }
  await recordDecision(getDb(), {
    orgId: actor.orgId, objectType: "person", objectId: m.m.personId, personId: m.m.personId, personName: m.name, action: "slack.keepFrozen",
    summary: `${actor.name} kept ${m.name}'s payouts frozen until the change to ••${m.m.last4} is confirmed through the original contact.`,
    actor, status: "frozen", tool: "slack", facts: { methodId },
  });
  await reply(id.inst, where, "Kept frozen. The payouts stay frozen until the attendee confirms through their original email.");
  await syncSlackSafe(actor.orgId);
}

// ---------------------------------------------------------- /eve command

const HELP = [
  "`/eve link CODE`: link your Eve account (get the code in Eve → Settings → Slack)",
  "`/eve unlink`: unlink this Slack account",
  "`/eve mute CATEGORY` or `/eve unmute CATEGORY`: direct messages for " + Object.keys(DM_CATEGORIES).map((k) => `\`${k}\``).join(", "),
  "`/eve status`: who you are in Eve and what is waiting for you",
].join("\n");

export async function handleCommand(form: URLSearchParams): Promise<Response> {
  const teamId = form.get("team_id") ?? "";
  const userId = form.get("user_id") ?? "";
  const [verb = "", ...rest] = (form.get("text") ?? "").trim().split(/\s+/);
  const say = (text: string) => json({ response_type: "ephemeral", text });
  const v = verb.toLowerCase();
  if (v === "link") {
    const r = await redeemLinkCode(teamId, userId, rest.join(""));
    return say(r.ok ? `Linked. You are *${esc(r.name)}* (${r.role}) in ${esc(r.orgName)}. Approvals for you will arrive here as direct messages.` : r.message);
  }
  const identity = await slackIdentity(teamId, userId);
  if (!identity) return say("Eve is not connected to this Slack workspace. An organizer connects it in Eve → Settings → Slack.");
  if (v === "" || v === "help") return say(HELP);
  if (!identity.actor) return say(NOT_LINKED);
  const actor = identity.actor;
  if (v === "unlink") {
    await getDb().transaction((tx) => unlinkMember(tx, actor));
    return say("Unlinked. Slack buttons no longer act for you in Eve.");
  }
  if (v === "mute" || v === "unmute") {
    const category = (rest[0] ?? "").toLowerCase();
    if (!isDmCategory(category)) return say(`Choose one of ${Object.keys(DM_CATEGORIES).map((k) => `\`${k}\``).join(", ")}.`);
    const muted = await setMuted(actor.memberId, v === "mute" ? [...identity.muted, category] : identity.muted.filter((c) => c !== category));
    return say(muted.length ? `Muted: ${muted.map((c) => DM_CATEGORIES[c as keyof typeof DM_CATEGORIES]).join(", ")}. If everyone who can act mutes a category, it goes to the team channel.` : "Nothing is muted.");
  }
  if (v === "status") {
    const open = await getDb().select({ id: s.slackMessage.id }).from(s.slackMessage)
      .where(and(eq(s.slackMessage.orgId, actor.orgId), eq(s.slackMessage.audience, actor.memberId), eq(s.slackMessage.state, "open")));
    return say(`You are *${esc(actor.name)}* (${actor.role}). ${open.length ? `${open.length} card${open.length === 1 ? "" : "s"} waiting for you.` : "Nothing is waiting for you."}${identity.muted.length ? ` Muted: ${identity.muted.join(", ")}.` : ""}`);
  }
  return say(HELP);
}

// -------------------------------------------------------------- events

export async function handleEvent(body: { type?: string; challenge?: string; team_id?: string; event?: { type?: string; user?: string; tab?: string } }, defer: Defer): Promise<Response> {
  if (body.type === "url_verification" && typeof body.challenge === "string") return json({ challenge: body.challenge });
  if (body.type !== "event_callback" || !body.team_id || !body.event) return ack();
  const teamId = body.team_id;
  const event = body.event;
  if (event.type === "app_home_opened" && event.user && event.tab === "home") defer(() => publishHome(teamId, event.user!));
  if (event.type === "app_uninstalled" || event.type === "tokens_revoked") {
    defer(async () => { const { forgetTeam } = await import("./install"); await forgetTeam(teamId); });
  }
  return ack();
}

export async function publishHome(teamId: string, slackUserId: string): Promise<void> {
  const identity = await slackIdentity(teamId, slackUserId);
  if (!identity) return;
  const { inst } = identity;
  const [org] = await getDb().select({ name: s.organization.name, isDemo: s.organization.isDemo }).from(s.organization).where(eq(s.organization.id, inst.orgId));
  const view = homeView({
    teamName: inst.teamName, orgName: org?.name ?? "Eve", channelName: inst.channelName, demo: Boolean(org?.isDemo), url: eveLink("/overview"),
    linked: identity.actor ? { name: identity.actor.name, role: identity.actor.role, muted: identity.muted } : null,
  });
  await slackApi(botToken(inst), "views.publish", { user_id: slackUserId, view }).catch((error) => {
    console.warn(`[slack] home not published: ${error instanceof SlackError ? error.code : "error"}`);
  });
}
