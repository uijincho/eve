// Pure view-model derivations over an AppSnapshot. No fetching, no React, so
// they are unit-tested in tests/client-derive.test.ts.
import type {
  Actor,
  AppSnapshot,
  Award,
  Check,
  Claim,
  Decision,
  DisbursementBatch,
  Payout,
  Person,
  PortalRun,
  SponsorPacket,
} from "@/lib/contracts";
import { checkProjectSubmission } from "@/lib/engines/project-submission";

export const big = (minor: string | undefined | null): bigint => {
  try {
    return BigInt(minor ?? "0");
  } catch {
    return 0n;
  }
};

export const sumMinor = (values: (string | undefined)[]): bigint =>
  values.reduce((acc, v) => acc + big(v), 0n);

// ── Authority, mirrored for explanation only. The server decides. ─────────

export type Permission = { allowed: true } | { allowed: false; reason: string };

const ok: Permission = { allowed: true };
const no = (reason: string): Permission => ({ allowed: false, reason });

export function controllerName(s: Pick<AppSnapshot, "personas">): string {
  return s.personas.find((p) => p.role === "controller")?.name ?? "the controller";
}

/** " Ari Novak is the controller." when known (sample personas), else nothing. */
function controllerNote(s: Pick<AppSnapshot, "personas">): string {
  const name = s.personas.find((p) => p.role === "controller")?.name;
  return name ? ` ${name} is the controller.` : "";
}

/** "Best Hardware Hack: 2nd place", or just "Judge stipend" when the track and title match. */
export function awardName(a: Pick<Award, "track" | "title">, sep = ": "): string {
  return !a.title || a.title.trim().toLowerCase() === a.track.trim().toLowerCase() ? a.track : `${a.track}${sep}${a.title}`;
}

const PROVIDER_LABEL: Record<string, string> = {
  mock_wire: "Wire", in_kind: "In-kind delivery", mock: "Bank transfer", simulated: "Bank transfer", stripe_test: "Stripe", stripe: "Stripe",
};

/** "mock_wire" -> "Wire". */
export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** What a payout pays for, in words: "Best Hardware Hack: 2nd place" or "Air Canada claim". */
export function payoutSource(s: Pick<AppSnapshot, "awards" | "claims">, p: Pick<Payout, "sourceId" | "sourceType">): string {
  if (p.sourceType === "award") {
    const a = s.awards.find((x) => x.id === p.sourceId);
    return a ? awardName(a) : "Prize";
  }
  const c = s.claims.find((x) => x.id === p.sourceId);
  return c ? `${c.merchant || (c.type === "travel" ? "Travel" : "Expense")} claim` : "Claim";
}

const OBJECT_LABEL: Record<string, string> = {
  payout: "Payout", claim: "Claim", award: "Prize", packet: "Sponsor packet", sponsor_packet: "Sponsor packet",
  person: "Person", period: "Period", filing: "Filing", org: "Settings", event: "Event", budget: "Budget",
  invitation: "Invitation", people: "People import", filings: "Filing drafts", member: "Team", tax_profile: "Tax form", payout_method: "Payout account",
};

/** "Priya Raman · Payout" for an agent run or decision, instead of its database id. */
export function objectLabel(d: { objectType: string; personName?: string; objectId: string }): string {
  const type = OBJECT_LABEL[d.objectType] ?? d.objectType.replace(/[_-]+/g, " ");
  if (d.objectType === "person") return d.personName || type;
  if (d.objectType === "period") return `Period ${d.objectId}`;
  return d.personName ? `${d.personName} · ${type}` : type;
}

/** A flight the organization books for the attendee: never paid out to them. */
/** A cash award on such a track is paid and taxed as a stipend. Mirrors paymentTypeFor on the server. */
export function isStipendTrack(track: string): boolean {
  return /stipend|judge|mentor|speaker/i.test(track);
}

export function isOrgBookedFlight(c: Pick<Claim, "category">): boolean {
  return c.category === "org_booked_flight";
}

/** Status wording for a claim: an org-booked flight that settled reads "Booked", not "Paid". */
export function claimStatusLabel(c: Pick<Claim, "category" | "status">): string | undefined {
  return isOrgBookedFlight(c) && c.status === "paid" ? "Booked" : undefined;
}

/** The currency Eve keeps its books in: payouts, budgets, claim totals and person totals. */
export function booksCurrency(s: Pick<AppSnapshot, "org">): string {
  return s.org.booksCurrency ?? "USD";
}

/** A persona's name for an actor id ("mem_demo_ari" -> "Ari Novak"); the id itself if unknown. */
export function actorName(s: Pick<AppSnapshot, "personas">, id?: string): string {
  if (!id) return "";
  if (id === "agent") return "Eve";
  return s.personas.find((p) => p.id === id)?.name ?? id;
}

/**
 * True only while a controller's release has been accepted and queued but has
 * not settled. The durable approval wait also writes a waiting decision
 * before anyone approves; that means "awaiting approval", not in flight, so it
 * must never lock the Release button.
 *
 * Pending = a queueControllerRelease record for this payout whose run has no
 * terminal step yet (executePayout done/escalated/waiting, or waitForController
 * done/escalated), with no later re-quote of the payout, while the payout is
 * still proposed or approved. A processing payout is always in flight.
 */
export function releaseInFlight(s: Pick<AppSnapshot, "decisions">, payout: Pick<Payout, "id" | "status">): boolean {
  if (payout.status === "processing") return true;
  if (payout.status !== "proposed" && payout.status !== "approved") return false;
  const mine = s.decisions.filter((d) => d.objectId === payout.id);
  return mine.some((q) => {
    if (q.tool !== "queueControllerRelease") return false;
    const settled = mine.some(
      (d) =>
        d.runId === q.runId &&
        ((d.tool === "executePayout" && (d.status === "done" || d.status === "escalated" || d.status === "waiting")) ||
          (d.tool === "waitForController" && (d.status === "done" || d.status === "escalated"))),
    );
    if (settled) return false;
    const fingerprint = q.facts?.quoteFingerprint;
    const requoted = mine.some(
      (d) =>
        d.runId !== q.runId &&
        d.createdAt > q.createdAt &&
        (/propose|quote|verify|bankchange|freeze/i.test(`${d.action} ${d.tool}`) ||
          (fingerprint !== undefined && d.facts?.quoteFingerprint !== undefined && d.facts.quoteFingerprint !== fingerprint)),
    );
    return !requoted;
  });
}

/**
 * Why the last queued release for this payout stopped, if it stopped after
 * the current terms were quoted (a sponsor-mode org, a changed quote, a
 * failed check). Undefined when there is nothing newer to report.
 */
export function releaseStopped(s: Pick<AppSnapshot, "decisions">, payout: Pick<Payout, "id" | "status">): Decision | undefined {
  if (payout.status !== "proposed" && payout.status !== "approved") return undefined;
  const mine = s.decisions.filter((d) => d.objectId === payout.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lastQuote = mine.find((d) => /propose|quote/i.test(`${d.action} ${d.tool}`))?.createdAt ?? "";
  return mine.find(
    (d) => d.status === "escalated" && (d.tool === "waitForController" || d.tool === "executePayout") && d.createdAt > lastQuote,
  );
}

const normEmail = (e?: string) => (e ?? "").trim().toLowerCase();

/**
 * Whether the signed-in person is the recipient. Real staff memberships often
 * have no personId, so the server also matches the person's email; mirror it.
 */
export function isBeneficiary(actor: Actor, personId: string | undefined, s?: Partial<Pick<AppSnapshot, "people">>): boolean {
  if (!personId) return false;
  if (actor.personId && actor.personId === personId) return true;
  const person = s?.people?.find((p) => p.id === personId);
  return Boolean(person && normEmail(person.email) && normEmail(person.email) === normEmail(actor.email));
}

export function projectStatusLabel(status: Person["projectStatus"] | undefined): string {
  if (status === "submitted") return "Submitted";
  if (status === "none") return "No project";
  return "Not recorded";
}

const BATCH_STATUS: Record<DisbursementBatch["status"], string> = {
  preparing: "being prepared", filling: "being submitted", submitting: "being submitted",
  submitted: "submitted", failed: "stopped and waiting for retry or cancel", cancelled: "cancelled",
};

/**
 * The sponsor batch or packet that owns a payout. While one does, the sponsor
 * pays it, so it cannot also be released directly (server: assertNotInBatch).
 */
export function sponsorOwner(s: Partial<Pick<AppSnapshot, "batches" | "packets">>, payout: Pick<Payout, "id">): { batch?: DisbursementBatch; packet?: SponsorPacket } | undefined {
  const batch = s.batches?.find((b) => b.status !== "cancelled" && b.payoutIds.includes(payout.id));
  const packet = s.packets?.find((k) => k.payoutId === payout.id);
  return batch || packet ? { batch, packet } : undefined;
}

/** Why a sponsor-owned payout cannot be released directly, or undefined. */
export function sponsorOwnerNote(s: Partial<Pick<AppSnapshot, "batches" | "packets">>, payout: Pick<Payout, "id">): string | undefined {
  const owner = sponsorOwner(s, payout);
  if (owner?.batch) return `Already in a sponsor batch released by ${owner.batch.approvedByName}, ${BATCH_STATUS[owner.batch.status]}. Follow it on Disburse, or cancel that batch to release this payout here.`;
  if (owner?.packet) return `The sponsor pays this through its packet (${owner.packet.status}). Follow it on Disburse.`;
  return undefined;
}

export function canRelease(actor: Actor, payout: Payout, s: Pick<AppSnapshot, "personas"> & Partial<Pick<AppSnapshot, "decisions" | "org" | "people" | "claims" | "event" | "now" | "batches" | "packets">>): Permission {
  if (s.org?.mode === "sponsor") return no(`${s.org.sponsorName || "The fiscal sponsor"} pays for this organization. Open Disburse to release a batch through the sponsor.`);
  if (s.decisions && releaseInFlight({ decisions: s.decisions }, payout)) return no("Release accepted. Eve is sending it now; this updates on its own.");
  const owned = sponsorOwnerNote(s, payout);
  if (owned && (payout.status === "proposed" || payout.status === "approved")) return no(owned);
  if (payout.status === "frozen") return no("Frozen until the bank change is confirmed through the original contact channel.");
  if (payout.status === "held") return no(payout.reason || "Held until the recipient's tax form is valid.");
  if (!["proposed", "approved"].includes(payout.status)) return no(`This payout is ${payout.status}.`);
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role !== "controller")
    return no(`Only a controller releases money.${controllerNote(s)}`);
  if (payout.requestedBy === actor.id || payout.requestedBy === actor.name)
    return no("You requested this payout. A different controller must release it.");
  if (isBeneficiary(actor, payout.personId, s)) return no("This payout is to you. A different controller must release it.");
  if (s.people && s.claims && s.event && payout.sourceType === "claim") {
    const person = s.people.find((p) => p.id === payout.personId);
    const claim = s.claims.find((c) => c.id === payout.sourceId);
    if (person && claim?.type === "travel") {
      const project = checkProjectSubmission({
        role: person.role, name: person.name, projectStatus: person.projectStatus, projectUrl: person.projectUrl,
        claimType: "travel", closingAt: s.event.closingAt, asOf: s.now ?? new Date().toISOString(),
      });
      if (project.applies && !project.check.passed) return no(project.check.detail);
    }
  }
  return ok;
}

/**
 * Whether the current persona may confirm an item prize was shipped or bought
 * locally (award.fulfill). Mirrors the server's checks so the reason shows
 * before the click; the server still decides.
 */
export function canFulfill(actor: Actor, award: Award, s: Pick<AppSnapshot, "personas" | "people" | "payouts" | "awards">): Permission {
  if (award.kind !== "item" || (award.fulfillment !== "ship" && award.fulfillment !== "local")) return no("Choose ship or buy locally first.");
  if (award.status === "paid") return no("Already delivered.");
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role !== "controller") return no(`A controller confirms delivery.${controllerNote(s)}`);
  if (award.requestedBy === actor.id || award.requestedBy === actor.name) return no("You entered this prize, so another controller must confirm its delivery.");
  const person = s.people.find((p) => p.id === award.personId);
  if (isBeneficiary(actor, award.personId, s)) return no("This prize is yours. A different controller must confirm its delivery.");
  if (person && !person.adult) return no("Eve does not deliver prizes to anyone under 18.");
  if (person && person.taxStatus !== "valid") return no(`Held until ${person.name.split(" ")[0]} signs a valid ${person.taxForm}. The item's value is reportable income.`);
  if (s.payouts.some((p) => p.sourceType === "award" && p.sourceId === award.id && !["failed", "returned"].includes(p.status))) return no("A payout already exists for this prize, so its terms are locked.");
  if (award.teamId && s.awards.some((a) => a.teamId === award.teamId && !a.splitConfirmed)) return no("Every team member must confirm the split first.");
  // Which tax rule applies (and whether it is verified) is the server's call; it answers with the reason.
  return ok;
}

export function canReview(actor: Actor, item: { requestedBy: string; personId?: string }, s?: Partial<Pick<AppSnapshot, "people">>): Permission {
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role === "attendee") return no("Organizers review claims. Attendees can only see their own.");
  if (item.requestedBy === actor.id || item.requestedBy === actor.name || isBeneficiary(actor, item.personId, s))
    return no("You cannot approve your own request. Another organizer or the controller must decide.");
  return ok;
}

export function canManage(actor: Actor): Permission {
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role === "attendee") return no("Only organizers and controllers change event finances.");
  return ok;
}

/**
 * Organizer-only actions: org and event settings, budget, people import, award
 * entry and choices, payout proposals. The server's role map gives controllers
 * none of these, so the button explains that instead of failing with a 403.
 */
export function canOrganize(actor: Actor): Permission {
  if (actor.role === "organizer") return ok;
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  return no("Only an organizer can do this.");
}

export function canControl(actor: Actor, s: Pick<AppSnapshot, "personas">): Permission {
  if (actor.role === "controller") return ok;
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  return no(`Only a controller can do this.${controllerNote(s)}`);
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export type InboxCategory = "approvals" | "holds" | "exceptions";

export type Tone = "critical" | "pending" | "positive" | "neutral";

/** A short state chip. `title` carries the full sentence for hover and screen readers. */
export type Tag = { label: string; tone: Tone; title?: string };

export type InboxItem = {
  id: string;
  category: InboxCategory;
  /** Who or what: a person's name, or the batch or packet. */
  title: string;
  mark: string;
  meta: string;
  /** The longer explanation, shown only in the detail pane. */
  detail: string;
  tags: Tag[];
  amountMinor: bigint;
  currency: string;
  dueAt: string;
  dueContext: string;
  ref:
    | { kind: "payouts"; payouts: Payout[] }
    | { kind: "payout"; payout: Payout }
    | { kind: "claim"; claim: Claim }
    | { kind: "award"; award: Award; person?: Person; payout?: Payout }
    | { kind: "packet"; packet: SponsorPacket }
    | { kind: "portal"; run: PortalRun; packet: SponsorPacket }
    | { kind: "person"; person: Person };
};

// ── Sponsor portal runs (computer use) ────────────────────────────────────

export const PORTAL_ACTIVE: PortalRun["status"][] = ["starting", "filling", "awaiting_approval", "submitting"];

export function isPortalActive(run: Pick<PortalRun, "status">): boolean {
  return PORTAL_ACTIVE.includes(run.status);
}

/** The newest portal run for a packet, if Eve has been asked to fill the sponsor portal for it. */
export function portalRunFor(s: Pick<AppSnapshot, "portalRuns">, packetId: string): PortalRun | undefined {
  return (s.portalRuns ?? []).filter((r) => r.packetId === packetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export const PORTAL_STATUS: Record<PortalRun["status"], { label: string; variant: "outline" | "secondary" | "positive" | "critical" }> = {
  starting: { label: "Starting", variant: "outline" },
  filling: { label: "Filling", variant: "outline" },
  awaiting_approval: { label: "Needs approval", variant: "outline" },
  submitting: { label: "Submitting", variant: "outline" },
  submitted: { label: "Submitted", variant: "positive" },
  escalated: { label: "Escalated", variant: "outline" },
  rejected: { label: "Rejected", variant: "critical" },
  failed: { label: "Failed", variant: "critical" },
  stopped: { label: "Stopped", variant: "secondary" },
};

export function portalStatusLine(run: PortalRun): string {
  switch (run.status) {
    case "starting": return "Creating a desktop with no internet and opening the sponsor portal.";
    case "filling": return `Filling the ${run.pageLabel} page (turn ${run.turns}).`;
    case "awaiting_approval": return "Stopped on the portal's Review page before Submit. Nothing is submitted until a controller approves.";
    case "submitting": return `Approved by ${run.approvedByName ?? "a controller"}. Eve is pressing Submit once.`;
    case "submitted": return `Submitted. Portal confirmation ${run.confirmation}.`;
    case "escalated": return "Eve stopped and asked the controller to decide. Nothing was submitted.";
    case "rejected": return "Rejected at Review. Nothing was submitted.";
    case "failed": return run.error ?? "The run failed. Nothing was submitted.";
    case "stopped": return "Stopped. Nothing was submitted.";
  }
}

const CATEGORY_RANK: Record<InboxCategory, number> = { exceptions: 0, approvals: 1, holds: 2 };

const stripDot = (t: string) => t.trim().replace(/\.$/, "");

/**
 * A failed check said as a failure. Check labels are written for the passing
 * case ("Within the agent's auto-approve limit"); printing one beside a failing
 * detail states the opposite of the truth, so every failure is rephrased here.
 */
export function failedCheckText(c: Pick<Check, "code" | "label" | "detail">): string {
  const d = stripDot(c.detail);
  const against = /^(.+?) against a (.+?) (limit|cap)/.exec(d);
  switch (c.code) {
    case "agent_limit":
      return against ? `Over the ${against[2]} auto-approve limit: ${against[1]}` : d;
    case "cap":
      return against ? `Over the ${against[2]} travel cap: ${against[1]}${/after conversion/.test(d) ? " after conversion" : ""}` : d;
    case "cap_hugging":
      return `Close to the travel cap: ${d.replace(/^Within/, "within")}`;
    case "fare_peer":
      return `High for the route: ${stripDot(d.split(". Flag for review")[0])}`;
    case "fare_market":
      return `High for the market: ${stripDot(d.split(". Flag for review")[0])}`;
    case "adult": {
      const age = /^Age (\d+)/.exec(d);
      return age ? `Under 18 at event start: age ${age[1]}` : d;
    }
    case "cabin": {
      const cabin = /^Cabin: (.+)$/.exec(d);
      return cabin ? `${cabin[1].charAt(0).toUpperCase()}${cabin[1].slice(1)} cabin, economy only` : d;
    }
    case "travel_dates":
      return `Travel outside the event dates: ${d}`;
    case "name_match":
      return `Name mismatch: ${d}`;
    case "evidence":
      return `Receipt facts not verified: ${d}`;
    case "budget":
    case "booking_deadline":
    case "duplicate":
    case "receipt":
    case "purchase_date":
    case "amount_valid":
    case "fx_converted":
    case "project_submission":
      return d;
    default:
      return `${c.label} failed: ${d}`;
  }
}

/** Most decisive failures first, so a row title leads with what matters most. */
const CHECK_PRIORITY = ["project_submission", "adult", "duplicate", "name_match", "evidence", "cap", "cabin", "booking_deadline", "travel_dates", "budget", "agent_limit", "fare_peer", "fare_market", "cap_hugging", "receipt"];

export function failedChecks(c: Pick<Claim, "checks">): Check[] {
  const rank = (k: Check) => { const i = CHECK_PRIORITY.indexOf(k.code); return i === -1 ? CHECK_PRIORITY.length : i; };
  return c.checks.filter((k) => !k.passed).sort((a, b) => rank(a) - rank(b));
}

/** Two-word names for failed checks. Hard policy failures are critical; soft flags only ask for a look. */
const CHECK_TAG: Record<string, Omit<Tag, "title">> = {
  project_submission: { label: "No project", tone: "critical" },
  adult: { label: "Under 18", tone: "critical" },
  duplicate: { label: "Duplicate", tone: "critical" },
  name_match: { label: "Name mismatch", tone: "critical" },
  evidence: { label: "Unverified receipt", tone: "critical" },
  cap: { label: "Over cap", tone: "critical" },
  cabin: { label: "Premium cabin", tone: "critical" },
  budget: { label: "Over budget", tone: "critical" },
  receipt: { label: "No receipt", tone: "critical" },
  purchase_date: { label: "Bad date", tone: "critical" },
  amount_valid: { label: "Bad amount", tone: "critical" },
  fx_converted: { label: "No FX rate", tone: "critical" },
  booking_deadline: { label: "Late booking", tone: "pending" },
  travel_dates: { label: "Off dates", tone: "pending" },
  fare_peer: { label: "High fare", tone: "pending" },
  fare_market: { label: "Above market", tone: "pending" },
  cap_hugging: { label: "Near cap", tone: "pending" },
  agent_limit: { label: "Over limit", tone: "neutral" },
};

/** A failed check as a chip: "Over limit", with "Over the $300.00 auto-approve limit: $316.58" as its title. */
export function checkTag(c: Pick<Check, "code" | "label" | "detail">): Tag {
  return { ...(CHECK_TAG[c.code] ?? { label: c.label, tone: "critical" }), title: failedCheckText(c) };
}

/** Why a payout is held, as chips: the tax form first, then an unverified rule. */
function holdTags(p: Payout, person?: Person): Tag[] {
  const tags: Tag[] = [];
  if (person?.taxStatus === "missing" || person?.taxStatus === "expired") tags.push({ label: `${person.taxForm} ${person.taxStatus}`, tone: "critical" });
  else if (person?.taxStatus === "review") tags.push({ label: `${person.taxForm} review`, tone: "pending" });
  if (!p.ruleVerified) tags.push({ label: "Unverified rule", tone: "pending" });
  return tags;
}

/** Why a claim is waiting, in failed form; once decided, the reviewer's or server's reason. */
/**
 * A claim's state as the attendee sees it. Eve's review stages all read as
 * "Submitted"; the checks and why a claim was escalated stay with organizers.
 */
export function attendeeClaimStatus(c: Pick<Claim, "category" | "status">): { status: string; label?: string } {
  if (c.status === "submitted" || c.status === "processing" || c.status === "escalated") return { status: "submitted", label: "Submitted" };
  return { status: c.status, label: claimStatusLabel(c) };
}

/** The only claim text an attendee sees: Eve's fare question, or a person's question or rejection reason. */
export function attendeeClaimNote(c: Pick<Claim, "status" | "reason" | "fareReview">): string {
  if (c.status === "needs_info") return c.fareReview?.question ?? c.reason;
  return c.status === "rejected" ? c.reason : "";
}

export function claimReasonText(c: Pick<Claim, "checks" | "status" | "reason">): string {
  const failed = failedChecks(c).map(failedCheckText);
  return (c.status === "escalated" || c.status === "needs_info") && failed.length ? `${failed.join("; ")}.` : c.reason;
}

export function buildInbox(s: AppSnapshot): InboxItem[] {
  const items: InboxItem[] = [];
  const people = new Map(s.people.map((p) => [p.id, p]));
  const awardPayout = new Map(
    s.payouts.filter((p) => p.sourceType === "award").map((p) => [p.sourceId, p]),
  );
  const heldPeople = new Set<string>();
  const source = (p: Payout) => (p.sourceType === "award" ? "Prize payout" : "Claim payout");

  // A sponsor batch or packet already owns some ready payouts; those are followed on Disburse, not released here.
  const ready = s.payouts.filter((p) => (p.status === "proposed" || p.status === "approved") && !sponsorOwner(s, p));
  if (ready.length) {
    const gross = sumMinor(ready.map((p) => p.grossMinor));
    const withheld = sumMinor(ready.map((p) => p.withholdingMinor));
    const due = ready.map((p) => p.dueAt).sort()[0];
    items.push({
      id: "batch",
      category: "approvals",
      title: ready.length === 1 ? ready[0].personName : "Payout batch",
      mark: "Release",
      meta: `${ready.length} ${ready.length === 1 ? "payout" : "payouts"}${s.personas.some((p) => p.role === "controller") ? ` · controller ${controllerName(s)}` : ""}`,
      detail: `${fmtPlain(withheld, "USD")} withheld, ${fmtPlain(sumMinor(ready.map((p) => p.feeMinor)), "USD")} in fees.`,
      tags: [{ label: "Ready to release", tone: "positive" }],
      amountMinor: gross,
      currency: ready[0].currency,
      dueAt: due,
      dueContext: "release",
      ref: { kind: "payouts", payouts: ready },
    });
  }

  for (const p of s.payouts) {
    if (p.status === "frozen" || p.status === "failed" || p.status === "returned") {
      items.push({
        id: `payout:${p.id}`,
        category: "exceptions",
        title: p.personName,
        mark: p.personName.split(" ")[0],
        meta: p.status === "frozen" ? `Bank details changed · ${source(p)}` : source(p),
        detail: p.reason,
        tags: [{ label: p.status === "frozen" ? "Frozen" : p.status === "failed" ? "Failed" : "Returned", tone: "critical" }],
        amountMinor: big(p.grossMinor),
        currency: p.currency,
        dueAt: p.dueAt,
        dueContext: "release",
        ref: { kind: "payout", payout: p },
      });
    } else if (p.status === "held") {
      heldPeople.add(p.personId);
      items.push({
        id: `payout:${p.id}`,
        category: "holds",
        title: p.personName,
        mark: p.personName.split(" ")[0],
        meta: `${source(p)} on hold`,
        detail: p.reason,
        tags: holdTags(p, people.get(p.personId)),
        amountMinor: big(p.grossMinor),
        currency: p.currency,
        dueAt: p.dueAt,
        dueContext: "payout",
        ref: { kind: "payout", payout: p },
      });
    }
  }

  for (const c of s.claims) {
    if (c.status !== "escalated" && c.status !== "needs_info") continue;
    const failed = failedChecks(c);
    const kind = c.type === "travel" ? "Travel claim" : "Expense";
    items.push({
      id: `claim:${c.id}`,
      category: c.status === "escalated" ? "approvals" : "holds",
      title: c.personName,
      mark: c.personName.split(" ")[0],
      meta: [kind, c.origin ? `from ${c.origin}` : "", c.merchant].filter(Boolean).join(" · "),
      // The pane lists every check, so only a reviewer's question needs words here.
      detail: c.status === "needs_info" ? c.reason || "Waiting for more information." : "",
      tags:
        c.status === "needs_info"
          ? [{ label: "Needs info", tone: "neutral" }]
          : failed.length
            ? failed.map(checkTag)
            : [{ label: "Needs review", tone: "pending" }],
      amountMinor: big(c.usdMinor),
      currency: "USD",
      dueAt: c.dueAt,
      dueContext: "review",
      ref: { kind: "claim", claim: c },
    });
  }

  for (const a of s.awards) {
    const person = people.get(a.personId);
    const payout = awardPayout.get(a.id);
    if (a.status === "paid" || a.status === "proposed" || payout) continue;
    const meta = [awardName(a), person?.country].filter(Boolean).join(" · ");
    if (a.status === "needs_form") {
      items.push({
        id: `award:${a.id}`,
        category: "holds",
        title: a.personName,
        mark: a.personName.split(" ")[0],
        meta,
        detail: a.recommendation || "Eve is chasing the winner for their tax form.",
        tags: [{ label: `${person?.taxForm ?? "Tax form"} not signed`, tone: "pending" }],
        amountMinor: big(a.amountMinor),
        currency: a.currency,
        dueAt: a.dueAt,
        dueContext: "ceremony",
        ref: { kind: "award", award: a, person, payout },
      });
    } else {
      const undecided = a.kind === "item" && a.fulfillment === "undecided";
      const splitPending = Boolean(a.teamId) && !a.splitConfirmed;
      items.push({
        id: `award:${a.id}`,
        category: splitPending ? "holds" : "approvals",
        title: a.personName,
        mark: a.personName.split(" ")[0],
        meta,
        detail: a.recommendation,
        tags: [
          undecided
            ? { label: "Choose delivery", tone: "pending" }
            : splitPending
              ? { label: "Split unconfirmed", tone: "pending" }
              : { label: "Ready to propose", tone: "positive" },
        ],
        amountMinor: big(a.amountMinor),
        currency: a.currency,
        dueAt: a.dueAt,
        dueContext: "ceremony",
        ref: { kind: "award", award: a, person, payout },
      });
    }
  }

  for (const k of s.packets) {
    if (k.status !== "questioned" && k.status !== "exception") continue;
    items.push({
      id: `packet:${k.id}`,
      category: "exceptions",
      title: `Sponsor packet ${k.id}`,
      mark: "Sponsor",
      meta: `${k.personName} · ${s.org.sponsorName}`,
      detail: k.reason,
      tags: [
        k.status === "exception"
          ? { label: `Short ${fmtPlain(big(k.requestedMinor) - big(k.paidMinor), "USD")}`, tone: "critical" }
          : { label: "Questioned", tone: "pending" },
      ],
      amountMinor: big(k.paidMinor),
      currency: "USD",
      dueAt: k.dueAt,
      dueContext: "reconcile",
      ref: { kind: "packet", packet: k },
    });
  }

  // Eve on the sponsor portal: a Review page waiting for a controller, or a run that needs a person.
  for (const k of s.packets) {
    const run = portalRunFor(s, k.id);
    if (!run) continue;
    const unreconciled = run.status === "failed" && !!run.confirmation;
    if (run.status !== "awaiting_approval" && !(run.status === "escalated" && k.status === "draft") && !unreconciled) continue;
    const checks = run.reviewCheck ?? [];
    const differ = checks.filter((c) => !c.ok).length;
    items.push({
      id: `portal:${run.id}`,
      category: run.status === "awaiting_approval" ? "approvals" : "exceptions",
      title: k.personName,
      mark: "Portal",
      meta: run.status === "awaiting_approval"
        ? `Sponsor portal submission · packet ${k.id}`
        : unreconciled ? `Portal accepted ${run.confirmation} · packet ${k.id}`
          : `Sponsor portal: ${run.escalation?.field ?? "Eve stopped"}`,
      detail: run.status === "awaiting_approval"
        ? checks.length ? `Eve stopped on Review before Submit. ${checks.length - differ} of ${checks.length} values match the packet${differ ? `; ${differ} differ` : ""}.` : "Eve stopped on Review before Submit. Check the screenshot before approving."
        : unreconciled ? `The portal accepted it, but the packet is not submitted in Eve. ${run.error ?? ""}`.trim()
          : run.escalation?.reason ?? portalStatusLine(run),
      tags: [
        run.status === "awaiting_approval"
          ? { label: "Ready to submit", tone: "positive" }
          : unreconciled
            ? { label: "Not reconciled", tone: "critical" }
            : { label: "Needs a person", tone: "pending" },
        ...(differ ? [{ label: `${differ} ${differ === 1 ? "value differs" : "values differ"}`, tone: "critical" as const }] : []),
      ],
      amountMinor: big(k.requestedMinor),
      currency: "USD",
      dueAt: run.status === "awaiting_approval" ? new Date(Date.parse(run.updatedAt) + 25 * 60_000).toISOString() : k.dueAt,
      dueContext: run.status === "awaiting_approval" ? "desktop closes" : "packet",
      ref: { kind: "portal", run, packet: k },
    });
  }

  for (const p of s.people) {
    if (heldPeople.has(p.id)) continue;
    if ((p.taxStatus === "expired" || p.taxStatus === "review") && big(p.outstandingMinor) > 0n) {
      items.push({
        id: `person:${p.id}`,
        category: "holds",
        title: p.name,
        mark: p.name.split(" ")[0],
        meta: `${p.role.charAt(0).toUpperCase()}${p.role.slice(1)} · ${p.country} · chased ${p.chaseCount}×`,
        detail: "",
        tags: [p.taxStatus === "expired" ? { label: `${p.taxForm} expired`, tone: "critical" } : { label: `${p.taxForm} review`, tone: "pending" }],
        amountMinor: big(p.outstandingMinor),
        currency: "USD",
        dueAt: p.taxExpiresAt ?? s.event.closingAt,
        dueContext: "form",
        ref: { kind: "person", person: p },
      });
    }
  }

  return items.sort(
    (a, b) =>
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
  );
}

export function fmtPlain(minor: bigint, currency: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}` as Intl.StringNumericLiteral,
  );
  return neg ? `−${s}` : s;
}

// ── Agent runs ────────────────────────────────────────────────────────────

export type Run = {
  runId: string;
  objectId: string;
  objectType: string;
  personName: string;
  status: Decision["status"];
  startedAt: string;
  updatedAt: string;
  steps: Decision[];
};

const firstSentence = (t: string) => (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();

/**
 * The agent rail's subject for a run, split so the amount never truncates:
 * who or what it is about, and the figure that goes with it.
 */
export function runHeading(run: Run, s: Pick<AppSnapshot, "payouts" | "packets">): { name: string; amount?: string } {
  if (run.objectType === "filings") {
    const year = run.steps.map((d) => d.facts?.year).find(Boolean);
    return { name: `Filing drafts${year ? ` ${String(year)}` : ""}` };
  }
  if (run.objectType === "payout") {
    const p = s.payouts.find((x) => x.id === run.objectId);
    return { name: run.personName || p?.personName || "Payout", amount: p ? fmtPlain(payoutValue(p), p.currency) : undefined };
  }
  if (run.objectType === "packet" || run.objectType === "sponsor_packet") {
    const k = s.packets.find((x) => x.id === run.objectId);
    return { name: k ? k.personName : "Sponsor packet", amount: k ? fmtPlain(big(k.requestedMinor), "USD") : undefined };
  }
  return { name: objectLabel(run) };
}

/** Heading as one string ("Quinn Davis · $600.00"), for labels and tests. */
export function runSubject(run: Run, s: Pick<AppSnapshot, "payouts" | "packets">): string {
  const h = runHeading(run, s);
  return h.amount ? `${h.name} · ${h.amount}` : h.name;
}

/** A short line that survives truncation: what happened last, not the full explanation. */
export function runLine(run: Run, s: Pick<AppSnapshot, "payouts">): string {
  const last = run.steps[run.steps.length - 1];
  const p = run.objectType === "payout" ? s.payouts.find((x) => x.id === run.objectId) : undefined;
  const amount = p ? ` ${fmtPlain(payoutValue(p), p.currency)}` : "";
  if (run.objectType === "packet" || run.objectType === "sponsor_packet") {
    // "Sponsor paid $970.00 on a $1,000.00 request (short $30.00)." -> "Short $30.00"; the rest is in the expanded steps.
    const short = /\(short (\S+?)\)/.exec(last.summary);
    if (short) return `Short ${short[1]}`;
  }
  if (run.objectType === "filings") {
    const count = Number(last.facts?.count ?? NaN);
    if (Number.isFinite(count)) return count === 0 ? "No new filings to draft" : `Drafted ${count} ${count === 1 ? "filing" : "filings"}`;
  }
  switch (last.tool) {
    case "waitForController":
      return last.status === "waiting" ? "Awaiting controller" : last.status === "escalated" ? `Release stopped: ${firstSentence(last.summary)}` : "Quote changed; closed";
    case "queueControllerRelease":
      return `Release queued${amount}`;
    case "executePayout": {
      if (last.status !== "done") return firstSentence(last.summary);
      // "Released $600.00 to ••9625 by wire (sim_…)." -> "Paid $600.00 · ••9625"
      const paid = /^Released (\S+) to (\S+)/.exec(last.summary);
      return paid ? `Paid ${paid[1]} · ${paid[2]}` : `Approved${amount}`;
    }
    default:
      return firstSentence(last.summary).replace(/(\d+) filing\(s\)/, (_, n) => `${n} ${n === "1" ? "filing" : "filings"}`);
  }
}

export function groupRuns(decisions: Decision[]): Run[] {
  const runs = new Map<string, Decision[]>();
  for (const d of decisions) {
    const list = runs.get(d.runId) ?? [];
    list.push(d);
    runs.set(d.runId, list);
  }
  return [...runs.entries()]
    .map(([runId, steps]) => {
      const sorted = [...steps].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = sorted[sorted.length - 1];
      return {
        runId,
        objectId: last.objectId,
        objectType: last.objectType,
        // The newest step can lack a person (a workflow resume); use any step that names one.
        personName: last.personName || [...sorted].reverse().find((d) => d.personName)?.personName || "",
        status: last.status,
        startedAt: sorted[0].createdAt,
        updatedAt: last.createdAt,
        steps: sorted,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function runCounters(runs: Run[], now: string) {
  const day = new Date(now).toDateString();
  return {
    running: runs.filter((r) => r.status === "running").length,
    waiting: runs.filter((r) => r.status === "waiting").length,
    doneToday: runs.filter((r) => r.status === "done" && new Date(r.updatedAt).toDateString() === day).length,
    escalated: runs.filter((r) => r.status === "escalated" || r.status === "frozen").length,
  };
}

/** Poll fast only while something is visibly moving. */
export function hasLiveWork(s: AppSnapshot | null): boolean {
  if (!s) return false;
  return (
    (s.portalRuns ?? []).some(isPortalActive) ||
    (s.batches ?? []).some((b) => ["preparing", "filling", "submitting"].includes(b.status)) ||
    s.decisions.some((d) => d.status === "running") ||
    s.payouts.some((p) => p.status === "processing") ||
    s.claims.some((c) => c.status === "processing" || c.status === "submitted")
  );
}

// ── Budget ────────────────────────────────────────────────────────────────

export function budgetTotals(s: AppSnapshot) {
  return {
    cap: sumMinor(s.budgets.map((b) => b.capMinor)),
    spent: sumMinor(s.budgets.map((b) => b.spentMinor)),
    committed: sumMinor(s.budgets.map((b) => b.committedMinor)),
  };
}

export function isAdultOn(dateOfBirth: string, on: string): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const at = new Date(on);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime())) return false;
  const eighteen = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
  return eighteen.getTime() <= at.getTime();
}

/** Which tax form Eve will ask for. Mirrors the PRD's starting rule set. */
export function suggestedForm(input: { country: string; citizenship: string; entity?: boolean }): Person["taxForm"] {
  const us = (c: string) => ["US", "USA", "United States"].includes(c.trim());
  if (input.entity) return "W-8BEN-E";
  if (us(input.country) || us(input.citizenship)) return "W-9";
  return "W-8BEN";
}

// ── Prizes ────────────────────────────────────────────────────────────────

/** Finds the prize rule Eve would cite for this winner, if one is loaded. */
/**
 * The withholding rule the server will most likely apply to a prize, for an
 * estimate only (a proposed payout carries the real figures). Rules key the
 * payee as a country, "NON<payer>" or "*", and the payment type as
 * cash_prize / item_prize with a ":treaty" variant that needs a signed form
 * claiming the payee's treaty.
 */
export function prizeRule(
  s: Pick<AppSnapshot, "rules" | "org"> & { now?: string },
  person?: Person,
  kind: Award["kind"] = "cash",
) {
  const payer = s.org.country;
  const payee = person?.country ?? "";
  const now = s.now ?? new Date().toISOString();
  const live = s.rules.filter(
    (r) =>
      r.payerCountry === payer &&
      r.effectiveFrom <= now &&
      (!r.effectiveTo || r.effectiveTo >= now),
  );
  const latest = (rs: typeof live) => rs.sort((a, b) => b.version - a.version)[0];
  const typed = (type: string) => live.filter((r) => r.paymentType === type);
  const forPayee = (rs: typeof live) =>
    payee === payer
      ? rs.filter((r) => r.payeeCountry === payer)
      : rs.filter((r) => r.payeeCountry === payee).concat(rs.filter((r) => r.payeeCountry === `NON${payer}` || r.payeeCountry === "*"));
  const base = kind === "item" ? "item_prize" : "cash_prize";
  // A treaty rate only applies once the recipient has a valid form on file that
  // claims this country's treaty; a valid form without a claim gets the default, as on the server.
  const claimsTreaty = person?.taxStatus === "valid" && payee !== payer && person.taxTreatyCountry === payee;
  const treaty = claimsTreaty ? latest(forPayee(typed(`${base}:treaty`)).filter((r) => r.payeeCountry === payee)) : undefined;
  return treaty ?? latest(forPayee(typed(base))) ?? latest(forPayee(typed("cash_prize"))) ?? latest(forPayee(live.filter((r) => r.paymentType.includes("prize"))));
}

/** "US → non-US, item prize (treaty), v1" from a rule's keys. */
export function ruleLabel(r: Pick<AppSnapshot["rules"][number], "payerCountry" | "payeeCountry" | "paymentType" | "version">) {
  const payee = r.payeeCountry === "*" ? "anyone" : r.payeeCountry.startsWith("NON") ? `non-${r.payeeCountry.slice(3)}` : r.payeeCountry;
  const [type, variant] = r.paymentType.split(":");
  return `${r.payerCountry} → ${payee}, ${type.replace(/_/g, " ")}${variant ? ` (${variant})` : ""}, v${r.version}`;
}

/** True for a prize delivered as the item itself (award.fulfill), not as money. */
export function isInKind(p: Pick<Payout, "provider">): boolean {
  return p.provider === "in_kind";
}

/**
 * What the recipient gets: the net for money, the item's value for an in-kind
 * delivery (the server records its net as 0 and the org's tax as withholding).
 */
export function payoutValue(p: Pick<Payout, "provider" | "grossMinor" | "withholdingMinor" | "netMinor">): bigint {
  return isInKind(p) ? big(p.grossMinor) - big(p.withholdingMinor) : big(p.netMinor);
}

/**
 * Splits a payout's fee between the recipient and the organization. The
 * server's net is authoritative: whatever the recipient bears is the gap
 * between gross less withholding and net; the rest of the fee is the org's.
 */
export function payoutFees(p: Pick<Payout, "grossMinor" | "withholdingMinor" | "netMinor" | "feeMinor">) {
  const fee = big(p.feeMinor);
  const gap = big(p.grossMinor) - big(p.withholdingMinor) - big(p.netMinor);
  const recipient = gap < 0n ? 0n : gap > fee ? fee : gap;
  return { recipient, org: fee - recipient };
}

export type PrizeOptions = {
  gross: bigint;
  withholding: bigint;
  cashNet: bigint;
  ship: bigint;
  local: bigint;
  recommended: Award["fulfillment"];
  rule?: AppSnapshot["rules"][number];
  /** True when the figures come from a proposed payout rather than an estimate. */
  fromPayout: boolean;
  /** Currency of gross, withholding and cashNet. */
  currency: string;
};

export function prizeOptions(s: Pick<AppSnapshot, "rules" | "org"> & { now?: string }, award: Award, person?: Person, payout?: Payout): PrizeOptions {
  // A proposed payout names the rule it used; otherwise estimate one.
  const rule = (payout && s.rules.find((r) => r.id === payout.ruleId && r.version === payout.ruleVersion)) ?? prizeRule(s, person, award.kind);
  // A payout is in the books currency (converted on the payment date); before one exists, the award's own currency.
  const gross = payout ? big(payout.grossMinor) : big(award.amountMinor);
  const currency = payout ? payout.currency : award.currency;
  const withholding = payout ? big(payout.withholdingMinor) : rule ? (gross * BigInt(rule.rateBps)) / 10000n : 0n;
  // The engine leads with its choice ("Buy it locally. …", "Cash equivalent: …");
  // later text mentions the other options, so only the opening phrase decides.
  const rec = award.recommendation.trim().toLowerCase();
  const recommended: Award["fulfillment"] =
    award.fulfillment !== "undecided"
      ? award.fulfillment
      : /^(buy it locally|buy locally|local)/.test(rec)
        ? "local"
        : /^ship/.test(rec)
          ? "ship"
          : /^(offer the cash|cash)/.test(rec)
            ? "cash"
            : "undecided";
  return {
    gross,
    withholding,
    cashNet: payout ? big(payout.netMinor) : gross - withholding,
    currency,
    ship: big(award.shippingMinor),
    local: big(award.localMinor),
    recommended,
    rule,
    fromPayout: Boolean(payout),
  };
}

export const FULFILLMENT_LABEL: Record<Award["fulfillment"], string> = {
  undecided: "Undecided",
  ship: "Ship the item",
  local: "Buy it locally",
  cash: "Cash equivalent",
};
