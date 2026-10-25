// What Slack should show, computed from Eve's current state. Pure: no database,
// no network. lib/slack/load.ts builds OrgState; lib/slack/sync.ts renders and
// posts. Every card carries names, amounts and last 4 digits only.

import { createHash } from "node:crypto";

import { payoutQuoteFingerprint } from "@/lib/agent/payout-approval";
import type * as C from "@/lib/contracts";
import type * as s from "@/lib/db/schema";
import { money, usd } from "@/lib/server/core";

import { eveLink, OVERDUE_RELEASE_MS, type DmCategory } from "./config";
import { scrub, slackDate } from "./text";

type ClaimRow = typeof s.claim.$inferSelect;
type AwardRow = typeof s.award.$inferSelect;
type PayoutRow = typeof s.payout.$inferSelect;
type MethodRow = typeof s.payoutMethod.$inferSelect;
type PacketRow = typeof s.sponsorPacket.$inferSelect;
type Role = C.Role;

export interface MemberState { id: string; name: string; role: Role; personId: string | null; slackUserId: string | null; muted: string[] }
export interface PersonState {
  id: string; name: string; country: string; role: string; adult: boolean;
  /** A current, matching tax form for this payer. */
  taxOk: boolean; form: string; taxAttention: "missing" | "expired" | "review" | "expiring" | null; chaseCount: number;
}
export interface PortalRunState {
  id: string; packetId: string; status: string; page: string; turns: number; error: string | null; confirmation: string | null;
  createdAt: Date; updatedAt: Date; personName: string; screenshots: string[];
}
export interface OverrideState { id: string; personName: string; ruleId: string; ruleVersion: number; approvedBy: string; reason: string; createdAt: Date }
export interface LatestDecision { action: string; actor: string; via: boolean; summary: string; facts: Record<string, unknown>; at: Date }

export interface OrgState {
  now: Date;
  org: { id: string; name: string; isDemo: boolean; mode: "direct" | "sponsor" | "hybrid"; sponsorName: string; organizerLimitMinor: bigint };
  event: { id: string; name: string; startsAt: Date; endsAt: Date; closingAt: Date } | null;
  onDutyMemberId: string | null;
  backupMemberId: string | null;
  members: MemberState[];
  people: Map<string, PersonState>;
  claims: ClaimRow[];
  awards: AwardRow[];
  payouts: PayoutRow[];
  methods: MethodRow[];
  packets: PacketRow[];
  /** Book-currency (USD) cap, spent and committed per budget line; used = spent + committed. */
  budgets: { id: string; name: string; capMinor: bigint; spentMinor: bigint; committedMinor: bigint; usedMinor: bigint }[];
  portalRuns: PortalRunState[];
  overrides: OverrideState[];
  /** Latest human decision per object id (claim review, prize choice, bank verification, Slack hold or keep-frozen). */
  latest: Map<string, LatestDecision>;
  /** Slack holds by batch hash. A changed batch has a new hash, so a hold lapses with it. */
  holds: Map<string, { by: string; reason: string }>;
  /** "Keep frozen" acknowledgements by pending payout method id. */
  keptFrozen: Map<string, { by: string }>;
}

export type Audience =
  | { kind: "member"; memberId: string; slackUserId: string; backup: boolean }
  | { kind: "channel"; why?: string };
export const audienceKey = (a: Audience) => (a.kind === "member" ? a.memberId : "channel");

export type Choice = "ship" | "local" | "cash";
export const CHOICE_LABEL: Record<Choice, string> = { ship: "Ship the item", local: "Buy it locally", cash: "Cash equivalent" };

export interface BatchLine { payoutId: string; name: string; source: string; net: string; withheld: string; destination: string }

export type Card =
  | { kind: "release"; batchHash: string; lines: BatchLine[]; count: number; net: string; withheld: string; oldestAt: Date; hold?: { by: string; reason: string } }
  | { kind: "freeze"; methodId: string; personName: string; fromLast4: string | null; toLast4: string; requestedVia: string; requestedAt: Date; payoutCount: number; net: string; kept?: { by: string } }
  | { kind: "claim"; claimId: string; personName: string; title: string; amount: string; failed: { label: string; detail: string }[]; reason: string; toController: boolean; dueAt: Date }
  | { kind: "prize"; awardId: string; personName: string; title: string; value: string; country: string; recommended: Choice; why: string; options: { choice: Choice; cost: string; available: boolean }[]; dueAt: Date }
  | { kind: "winners"; count: number; needForms: { name: string; form: string }[]; minors: string[]; closingAt: Date; closed: boolean }
  | { kind: "countdown"; closingAt: Date; left: string; blockers: string[] };

export interface Item {
  key: string;
  category: DmCategory | "weekend";
  audiences: Audience[];
  card: Card;
  url: string;
  demo: boolean;
  /** Status line for the thread; posted once each time it changes. */
  note?: string;
}

export interface Resolution { title: string; text: string; url: string }

export interface InfoAlert { key: string; category: "payouts" | "sponsor" | "budget" | "computer_use" | "tax_rules"; text: string; documentIds: string[] }

const DAY = 86_400_000;
const LIVE_UNPAID = ["held", "proposed", "approved", "frozen", "processing", "paid"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameOf = (st: OrgState, personId: string) => st.people.get(personId)?.name ?? "A recipient";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ------------------------------------------------------------- routing

type Skip = (m: MemberState) => boolean;

function linked(st: OrgState, roles: Role[], exclude: Skip): MemberState[] {
  return st.members.filter((m) => m.slackUserId && roles.includes(m.role) && !exclude(m));
}

/**
 * DMs to the people who can act. Muted people are skipped; when everyone who can
 * act muted the category (or nobody linked Slack), the card goes to the team
 * channel so it is never lost. An overdue item also goes to the backup approver.
 */
export function route(st: OrgState, category: DmCategory, candidates: MemberState[], overdue?: { roles: Role[]; exclude: Skip }): Audience[] {
  const out: Audience[] = candidates.filter((m) => !m.muted.includes(category))
    .map((m) => ({ kind: "member", memberId: m.id, slackUserId: m.slackUserId!, backup: false }));
  if (overdue) {
    const already = new Set(candidates.map((m) => m.id));
    const pool = linked(st, overdue.roles, (m) => already.has(m.id) || overdue.exclude(m) || m.muted.includes("overdue"));
    const named = pool.filter((m) => m.id === st.backupMemberId);
    for (const m of named.length ? named : pool) out.push({ kind: "member", memberId: m.id, slackUserId: m.slackUserId!, backup: true });
  }
  if (out.length) return out;
  return [{ kind: "channel", why: candidates.length ? "Everyone who can act muted this category, so it is posted here." : "Nobody who can act has linked Slack yet, so it is posted here." }];
}

// --------------------------------------------------------- release batch

/** Payouts a controller can release directly right now. Sponsor-owned payouts are released by sponsor.submit instead. */
export function currentBatch(st: OrgState): { hash: string; payouts: PayoutRow[] } | null {
  if (st.org.mode === "sponsor") return null;
  const owned = new Set(st.packets.map((p) => p.payoutId));
  const payouts = st.payouts.filter((p) => (p.status === "proposed" || p.status === "approved") && !owned.has(p.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  if (!payouts.length) return null;
  return { hash: hash(payouts.map((p) => [p.id, payoutQuoteFingerprint(p)]).sort()).slice(0, 32), payouts };
}

function sourceLabel(st: OrgState, p: PayoutRow): string {
  if (p.claimId) {
    const c = st.claims.find((x) => x.id === p.claimId);
    return c ? `${c.type === "travel" ? "Travel" : "Expense"}: ${c.merchant}` : "Claim";
  }
  return st.awards.find((x) => x.id === p.awardId)?.title ?? "Prize";
}

function last4For(st: OrgState, p: Pick<PayoutRow, "payoutMethodId">): string | null {
  return st.methods.find((m) => m.id === p.payoutMethodId)?.last4 ?? null;
}

function releaseItem(st: OrgState, openKey: string | undefined): Item | null {
  const batch = currentBatch(st);
  if (!batch) return null;
  const lines = batch.payouts.map((p) => {
    const l4 = last4For(st, p);
    return {
      payoutId: p.id, name: nameOf(st, p.personId), source: sourceLabel(st, p), net: money(p.netMinor, p.currency), withheld: money(p.withholdingMinor, p.currency),
      destination: `${p.destinationCurrency !== p.currency ? `${money(p.destinationNetMinor, p.destinationCurrency)} ` : ""}${l4 ? `to ••${l4}` : ""}`.trim(),
    };
  });
  const sum = (f: (p: PayoutRow) => bigint) => batch.payouts.reduce((a, p) => a + f(p), 0n);
  const oldestAt = batch.payouts[0].createdAt;
  const overdue = st.now.getTime() - oldestAt.getTime() > OVERDUE_RELEASE_MS;
  const controllers = linked(st, ["controller"], () => false);
  const hold = st.holds.get(batch.hash);
  const card: Card = { kind: "release", batchHash: batch.hash, lines, count: lines.length, net: usd(sum((p) => p.netMinor)), withheld: usd(sum((p) => p.withholdingMinor)), oldestAt, hold };
  return {
    key: openKey ?? `release:${batch.hash.slice(0, 12)}`, category: "release", card, url: eveLink("/payouts"), demo: st.org.isDemo,
    audiences: route(st, "release", controllers, overdue ? { roles: ["controller"], exclude: () => false } : undefined),
    note: hold ? `Held by ${hold.by}: ${hold.reason}` : `${plural(card.count, "payout")} · ${card.net} net waiting for release.`,
  };
}

// ---------------------------------------------------------------- freeze

function freezeItems(st: OrgState): Item[] {
  return st.methods.filter((m) => m.status === "pending_verification").flatMap((m) => {
    const frozen = st.payouts.filter((p) => p.personId === m.personId && p.status === "frozen");
    if (!frozen.length) return [];
    const from = st.methods.find((x) => x.personId === m.personId && x.status === "active");
    const kept = st.keptFrozen.get(m.id);
    const notBeneficiary: Skip = (x) => x.personId === m.personId;
    const card: Card = {
      kind: "freeze", methodId: m.id, personName: nameOf(st, m.personId), fromLast4: from?.last4 ?? null, toLast4: m.last4,
      requestedVia: m.requestedVia, requestedAt: m.createdAt, payoutCount: frozen.length, net: usd(frozen.reduce((a, p) => a + p.netMinor, 0n)), kept,
    };
    return [{
      key: `freeze:${m.id}`, category: "freeze" as const, card, url: eveLink(`/payouts?payout=${frozen[0].id}`), demo: st.org.isDemo,
      audiences: route(st, "freeze", linked(st, ["controller", "organizer"], notBeneficiary)),
      note: kept ? `Kept frozen by ${kept.by}. Waiting for confirmation through the original contact.` : undefined,
    }];
  });
}

// ---------------------------------------------------------------- claims

function claimItems(st: OrgState): Item[] {
  return st.claims.filter((c) => c.status === "escalated").map((c) => {
    const conflicted: Skip = (m) => m.id === c.requestedBy || m.personId === c.personId;
    const toController = c.usdMinor > st.org.organizerLimitMinor;
    let candidates: MemberState[];
    if (toController) candidates = linked(st, ["controller"], conflicted);
    else {
      const organizers = linked(st, ["organizer"], conflicted);
      const onDuty = organizers.filter((m) => m.id === st.onDutyMemberId);
      candidates = onDuty.length ? onDuty : organizers.length ? organizers : linked(st, ["controller"], conflicted);
    }
    const overdue = st.now > c.dueAt;
    const amount = c.currency === "USD" ? usd(c.usdMinor) : `${money(c.amountMinor, c.currency)} (${usd(c.usdMinor)})`;
    const card: Card = {
      kind: "claim", claimId: c.id, personName: nameOf(st, c.personId), title: `${c.type === "travel" ? "Travel" : "Expense"}: ${c.merchant}`, amount,
      failed: c.checks.filter((k) => !k.passed).slice(0, 4).map((k) => ({ label: scrub(k.label), detail: scrub(k.detail) })),
      reason: scrub(c.reason), toController, dueAt: c.dueAt,
    };
    return {
      key: `claim:${c.id}`, category: "claims" as const, card, url: eveLink(`/claims?claim=${c.id}`), demo: st.org.isDemo,
      audiences: route(st, "claims", candidates, overdue ? { roles: toController ? ["controller"] : ["organizer", "controller"], exclude: conflicted } : undefined),
      note: overdue ? `Past its review date (${slackDate(c.dueAt, "{date_short_pretty}")}); also sent to the backup approver.` : undefined,
    };
  });
}

// ---------------------------------------------------------------- prizes

export function recommendedChoice(recommendation: string): Choice {
  if (recommendation.startsWith("Ship")) return "ship";
  if (recommendation.startsWith("Buy")) return "local";
  return "cash";
}

/** An item prize still waiting on ship, buy local or cash, with nothing that locks the choice. */
export function prizeNeedsDecision(st: OrgState, a: AwardRow): boolean {
  if (a.kind !== "item" || a.fulfillment !== "undecided" || a.status === "paid") return false;
  return !st.payouts.some((p) => p.awardId === a.id && LIVE_UNPAID.includes(p.status));
}

function prizeItems(st: OrgState): Item[] {
  return st.awards.filter((a) => prizeNeedsDecision(st, a)).map((a) => {
    const winner: Skip = (m) => m.personId === a.personId;
    const organizers = linked(st, ["organizer"], winner);
    const onDuty = organizers.filter((m) => m.id === st.onDutyMemberId);
    const value = money(a.amountMinor, a.currency);
    const card: Card = {
      kind: "prize", awardId: a.id, personName: nameOf(st, a.personId), title: a.title, value, country: st.people.get(a.personId)?.country ?? "",
      recommended: recommendedChoice(a.recommendation), why: scrub(a.recommendation.split(". ").slice(1, 3).join(". ")),
      options: [
        { choice: "ship", cost: `${usd(a.shippingMinor)} shipping and duty`, available: a.shippingMinor > 0n },
        { choice: "local", cost: `${usd(a.localMinor)} local price`, available: a.localMinor > 0n },
        { choice: "cash", cost: `${value} cash`, available: true },
      ],
      dueAt: a.dueAt,
    };
    return {
      key: `prize:${a.id}`, category: "prizes" as const, card, url: eveLink(`/prizes?award=${a.id}`), demo: st.org.isDemo,
      audiences: route(st, "prizes", onDuty.length ? onDuty : organizers, st.now > a.dueAt ? { roles: ["organizer"], exclude: winner } : undefined),
    };
  });
}

// --------------------------------------------------------- event weekend

function winnersOf(st: OrgState) {
  if (!st.event) return [];
  const ids = [...new Set(st.awards.filter((a) => a.eventId === st.event!.id).map((a) => a.personId))];
  return ids.map((id) => st.people.get(id)).filter((p): p is PersonState => Boolean(p));
}

/** What still stands between the winners and payment at the closing ceremony. */
export function releaseBlockers(st: OrgState): string[] {
  if (!st.event) return [];
  const awards = st.awards.filter((a) => a.eventId === st.event!.id && a.status !== "paid");
  const awardIds = new Set(awards.map((a) => a.id));
  const winners = winnersOf(st);
  const out: string[] = [];
  const names = (list: string[]) => `${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`;
  const forms = winners.filter((p) => p.adult && !p.taxOk && awards.some((a) => a.personId === p.id));
  if (forms.length) out.push(`${plural(forms.length, "winner")} still need a tax form: ${names(forms.map((p) => `${p.name} (${p.form})`))}`);
  const prizePayouts = st.payouts.filter((p) => p.awardId && awardIds.has(p.awardId));
  const held = prizePayouts.filter((p) => p.status === "held");
  if (held.length) out.push(`${plural(held.length, "prize payout")} held: ${names(held.map((p) => nameOf(st, p.personId)))}`);
  const frozen = prizePayouts.filter((p) => p.status === "frozen");
  if (frozen.length) out.push(`${plural(frozen.length, "prize payout")} frozen after a bank change: ${names(frozen.map((p) => nameOf(st, p.personId)))}`);
  const waiting = prizePayouts.filter((p) => p.status === "proposed" || p.status === "approved");
  if (waiting.length) out.push(`${plural(waiting.length, "prize payout")} waiting for a controller to release`);
  const undecided = awards.filter((a) => prizeNeedsDecision(st, a));
  if (undecided.length) out.push(`${plural(undecided.length, "item prize")} still need ship, buy local or cash`);
  const splits = new Set(awards.filter((a) => a.teamId && !a.splitConfirmed).map((a) => a.teamId));
  if (splits.size) out.push(`${plural(splits.size, "team split")} not confirmed by every member`);
  return out;
}

export function timeLeft(ms: number): string {
  if (ms > 2 * 3_600_000) return `about ${Math.floor(ms / 3_600_000)} hours`;
  if (ms > 3_600_000) return "under 2 hours";
  if (ms > 30 * 60_000) return "under an hour";
  if (ms > 10 * 60_000) return "under 30 minutes";
  return "under 10 minutes";
}

/** Countdown checkpoints before the closing ceremony (ms before). */
export const COUNTDOWN_MARKS = [6, 3, 2, 1].map((h) => h * 3_600_000).concat([30 * 60_000, 10 * 60_000, 0]);
const COUNTDOWN_WINDOW_MS = COUNTDOWN_MARKS[0];

function weekendItems(st: OrgState): Item[] {
  if (!st.event) return [];
  const { event, now } = st;
  const items: Item[] = [];
  const eventAwards = st.awards.filter((a) => a.eventId === event.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const channel: Audience[] = [{ kind: "channel" }];
  if (eventAwards.length && now.getTime() < event.closingAt.getTime() + 12 * 3_600_000) {
    const winners = winnersOf(st);
    const latest = eventAwards[0];
    const sameBatch = eventAwards.filter((a) => Math.abs(a.createdAt.getTime() - latest.createdAt.getTime()) < 60_000);
    items.push({
      key: `winners:${event.id}`, category: "weekend", audiences: channel, url: eveLink("/prizes"), demo: st.org.isDemo,
      card: {
        kind: "winners", count: winners.length, closingAt: event.closingAt, closed: now >= event.closingAt,
        needForms: winners.filter((p) => p.adult && !p.taxOk).map((p) => ({ name: p.name, form: p.form })),
        minors: winners.filter((p) => !p.adult).map((p) => p.name),
      },
      note: `Winner entered: ${sameBatch.map((a) => `${nameOf(st, a.personId)} · ${a.title}`).join("; ")}`,
    });
  }
  const left = event.closingAt.getTime() - now.getTime();
  const blockers = releaseBlockers(st);
  if (left > 0 && left <= COUNTDOWN_WINDOW_MS && blockers.length) {
    const label = timeLeft(left);
    items.push({
      key: `countdown:${event.id}`, category: "weekend", audiences: channel, url: eveLink("/overview"), demo: st.org.isDemo,
      card: { kind: "countdown", closingAt: event.closingAt, left: label, blockers },
      note: `${label[0].toUpperCase()}${label.slice(1)} to the closing ceremony: ${plural(blockers.length, "item")} still blocking payout release.`,
    });
  }
  return items;
}

/** Every card Slack should show now. `openBatchKey` keeps one batch card updating in place. */
export function desiredItems(st: OrgState, openBatchKey?: string): Item[] {
  const release = releaseItem(st, openBatchKey);
  return [...(release ? [release] : []), ...freezeItems(st), ...claimItems(st), ...prizeItems(st), ...weekendItems(st)];
}

// ------------------------------------------------------------ resolution

function decidedBy(d: LatestDecision | undefined): string {
  return d ? ` by ${d.actor}${d.via ? " via Slack" : ""}` : "";
}

/** How a card reads once its item no longer needs anyone. */
export function resolutionFor(key: string, st: OrgState): Resolution {
  const [kind, id] = key.split(":");
  const gone = (title: string, url = eveLink("/overview")) => ({ title, text: "This item is no longer open in Eve.", url });
  if (kind === "release") return { title: "Payout batch", text: "Nothing is waiting for release now. Released, re-quoted and held payouts are in Payouts.", url: eveLink("/payouts") };
  if (kind === "freeze") {
    const m = st.methods.find((x) => x.id === id);
    if (!m) return gone("Payout frozen: bank details changed", eveLink("/payouts"));
    const name = nameOf(st, m.personId);
    const d = st.latest.get(m.personId);
    const by = d?.action === "payout.verify" ? decidedBy(d) : "";
    const text = m.status === "active" ? `${name}'s new account ••${m.last4} was confirmed through the original contact${by}. The payouts were re-quoted and each needs a fresh controller release.`
      : m.status === "rejected" ? `${name}'s change to ••${m.last4} was rejected${by}. The payouts returned to the original account.`
        : m.status === "superseded" ? `A newer bank change for ${name} replaced this one.`
          : `${name}'s payouts are no longer frozen.`;
    return { title: `Payout frozen: ${name}`, text, url: eveLink("/payouts") };
  }
  if (kind === "claim") {
    const c = st.claims.find((x) => x.id === id);
    if (!c) return gone("Escalated claim", eveLink("/claims"));
    const d = st.latest.get(c.id);
    const by = d?.action === "claim.review" ? decidedBy(d) : "";
    const reason = c.reason ? `: ${scrub(c.reason)}` : ".";
    const text = c.status === "approved" || c.status === "paid" ? `Approved${by}${reason}`
      : c.status === "rejected" ? `Rejected${by}${reason}`
        : c.status === "needs_info" ? `Asked for more information${by}${reason} Waiting on ${nameOf(st, c.personId)}.`
          : `Now ${c.status}.`;
    return { title: `Claim: ${nameOf(st, c.personId)} · ${c.merchant}`, text, url: eveLink(`/claims?claim=${c.id}`) };
  }
  if (kind === "prize") {
    const a = st.awards.find((x) => x.id === id);
    if (!a) return gone("Prize decision", eveLink("/prizes"));
    const d = st.latest.get(a.id);
    const by = d?.action === "award.choose" ? decidedBy(d) : "";
    const choice = a.fulfillment === "undecided" ? null : CHOICE_LABEL[a.fulfillment];
    return { title: `Prize: ${nameOf(st, a.personId)} · ${a.title}`, text: choice ? `Decided: ${choice}${by}.` : "The payout terms are locked, so the choice is final.", url: eveLink(`/prizes?award=${a.id}`) };
  }
  if (kind === "winners") {
    const winners = winnersOf(st);
    const missing = winners.filter((p) => p.adult && !p.taxOk).length;
    return { title: "Winners", text: `The closing ceremony is done: ${plural(winners.length, "winner")}${missing ? `, ${missing} still without a valid tax form` : ", every adult winner has a valid tax form"}.`, url: eveLink("/prizes") };
  }
  if (kind === "countdown") {
    const done = !st.event || st.now >= st.event.closingAt;
    const blockers = releaseBlockers(st);
    return {
      title: "Payout release countdown",
      text: done ? (blockers.length ? `The closing ceremony started with ${plural(blockers.length, "item")} still blocking release. Each is in the Eve inbox.` : "The closing ceremony started with nothing blocking release.") : "Nothing blocks payout release now.",
      url: eveLink("/overview"),
    };
  }
  return gone("Eve");
}

// ------------------------------------------------------------ info alerts

const portalVerb: Record<string, string> = {
  submitted: "finished: the portal accepted the request", rejected: "stopped: a controller rejected the Review page", stopped: "was stopped on request",
  escalated: "got stuck and asked a controller to decide", failed: "stopped without submitting",
};

/** Informational team-channel alerts that should exist now. Each key is queued once. */
export function infoAlerts(st: OrgState): InfoAlert[] {
  const out: InfoAlert[] = [];
  const recent = (d: Date | null | undefined, days: number) => Boolean(d && st.now.getTime() - d.getTime() < days * DAY);
  for (const p of st.payouts) {
    if (p.status !== "failed" && p.status !== "returned") continue;
    const l4 = last4For(st, p);
    const next = p.status === "failed"
      ? "Next: a controller presses Retry. Eve re-quotes it against the current tax form, bank details and rules, and it needs a fresh release."
      : "Next: Eve counts it as unpaid. Confirm the recipient's bank details, then re-propose it for a controller.";
    out.push({ key: `payout:${p.id}:${p.status}:${p.attempts}`, category: "payouts", documentIds: [], text: `*Payout ${p.status}:* ${nameOf(st, p.personId)} · ${money(p.netMinor, p.currency)}${l4 ? ` to ••${l4}` : ""}. ${p.reason ? `Reason: ${scrub(p.reason)} ` : ""}${next}` });
  }
  for (const pk of st.packets) {
    if (pk.status !== "exception") continue;
    const payout = st.payouts.find((p) => p.id === pk.payoutId);
    out.push({
      key: `packet:${pk.id}:exception:${pk.paidMinor}`, category: "sponsor", documentIds: [],
      text: `*Sponsor reconciliation exception:* ${st.org.sponsorName || "The sponsor"} paid ${usd(pk.paidMinor)} on a ${usd(pk.requestedMinor)} request${payout ? ` for ${nameOf(st, payout.personId)}` : ""}. Next: nothing posts and the payout stays processing until the sponsor sends the difference, or a controller accepts a recipient-borne shortfall.`,
    });
  }
  for (const b of st.budgets) {
    if (b.capMinor <= 0n) continue;
    const pct = Number((b.usedMinor * 100n) / b.capMinor);
    const level = pct >= 100 ? 100 : pct >= 80 ? 80 : null;
    if (!level) continue;
    const left = b.capMinor - b.usedMinor;
    out.push({
      key: `budget:${b.id}:${b.capMinor}:${level}`, category: "budget", documentIds: [],
      text: `*Budget ${level === 100 ? "at or over its cap" : "past 80%"}:* ${b.name} is at ${pct}% (${usd(b.usedMinor)} spent or committed of ${usd(b.capMinor)}; ${left > 0n ? `${usd(left)} left` : "nothing left"}).${level === 100 ? " Eve refuses approvals and releases that would exceed it." : ""}`,
    });
  }
  for (const r of st.portalRuns) {
    const stuck = ["starting", "filling", "submitting"].includes(r.status) && st.now.getTime() - r.updatedAt.getTime() > 10 * 60_000;
    if (!portalVerb[r.status] && !stuck) continue;
    if (!recent(r.updatedAt, 1)) continue;
    const what = stuck ? `has not moved for 10 minutes on the ${r.page} page` : portalVerb[r.status];
    const detail = r.status === "submitted" && r.confirmation ? ` Confirmation ${r.confirmation}.` : r.error ? ` ${scrub(r.error)}` : "";
    out.push({
      key: `portal:${r.id}:${stuck ? `stuck:${r.turns}` : r.status}`, category: "computer_use", documentIds: r.screenshots.slice(0, 2),
      text: `*Computer use:* Eve ${what} on the ${st.org.sponsorName || "sponsor"} portal for ${r.personName}.${detail} Screenshots are in the thread.`,
    });
  }
  for (const p of st.payouts) {
    if (p.ruleVerified || !["processing", "paid"].includes(p.status) || !recent(p.paidAt ?? p.createdAt, 7)) continue;
    out.push({
      key: `taxrule:${p.id}`, category: "tax_rules", documentIds: [],
      text: `*Unverified tax rule used:* ${nameOf(st, p.personId)}'s ${usd(p.grossMinor)} payment was ${p.status === "paid" ? "paid" : "submitted"} under ${p.ruleId} v${p.ruleVersion}, which is not verified (${usd(p.withholdingMinor)} withheld). Check the rule's source before filing drafts are reviewed.`,
    });
  }
  for (const o of st.overrides) {
    if (!recent(o.createdAt, 7)) continue;
    out.push({
      key: `override:${o.id}`, category: "tax_rules", documentIds: [],
      text: `*Unverified tax rule accepted:* ${o.approvedBy} accepted ${o.ruleId} v${o.ruleVersion} as stated for ${o.personName}: "${scrub(o.reason)}". The payout still needs a separate release.`,
    });
  }
  return out;
}
