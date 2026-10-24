// Pure view-model derivations over an AppSnapshot. No fetching, no React, so
// they are unit-tested in tests/client-derive.test.ts.
import type {
  Actor,
  AppSnapshot,
  Award,
  Claim,
  Decision,
  Payout,
  Person,
  SponsorPacket,
} from "@/lib/contracts";

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
  mock_wire: "Simulated wire", in_kind: "In-kind delivery", mock: "Simulated", simulated: "Simulated", stripe_test: "Stripe test mode", stripe: "Stripe test mode",
};

/** "mock_wire" -> "Simulated wire". */
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
  invitation: "Invitation", people: "People import", member: "Team", tax_profile: "Tax form", payout_method: "Payout account",
};

/** "Priya Raman · Payout" for an agent run or decision, instead of its database id. */
export function objectLabel(d: { objectType: string; personName?: string; objectId: string }): string {
  const type = OBJECT_LABEL[d.objectType] ?? d.objectType.replace(/[_-]+/g, " ");
  if (d.objectType === "person") return d.personName || type;
  if (d.objectType === "period") return `Period ${d.objectId}`;
  return d.personName ? `${d.personName} · ${type}` : type;
}

/** A flight the organization books for the attendee: never paid out to them. */
export function isOrgBookedFlight(c: Pick<Claim, "category">): boolean {
  return c.category === "org_booked_flight";
}

/** Status wording for a claim: an org-booked flight that settled reads "Booked", not "Paid". */
export function claimStatusLabel(c: Pick<Claim, "category" | "status">): string | undefined {
  return isOrgBookedFlight(c) && c.status === "paid" ? "Booked" : undefined;
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

export function canRelease(actor: Actor, payout: Payout, s: Pick<AppSnapshot, "personas"> & Partial<Pick<AppSnapshot, "decisions">>): Permission {
  if (s.decisions && releaseInFlight({ decisions: s.decisions }, payout)) return no("Release accepted. Eve is sending it now; this updates on its own.");
  if (payout.status === "frozen") return no("Frozen until the bank change is confirmed through the original contact channel.");
  if (payout.status === "held") return no(payout.reason || "Held until the recipient's tax form is valid.");
  if (!["proposed", "approved"].includes(payout.status)) return no(`This payout is ${payout.status}.`);
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role !== "controller")
    return no(`Only a controller releases money.${controllerNote(s)}`);
  if (payout.requestedBy === actor.id || payout.requestedBy === actor.name)
    return no("You requested this payout. A different controller must release it.");
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
  if (person && actor.personId === person.id) return no("You cannot confirm your own prize.");
  if (person && !person.adult) return no("Eve does not deliver prizes to anyone under 18.");
  if (person && person.taxStatus !== "valid") return no(`Held until ${person.name.split(" ")[0]} signs a valid ${person.taxForm}. The item's value is reportable income.`);
  if (s.payouts.some((p) => p.sourceType === "award" && p.sourceId === award.id && !["failed", "returned"].includes(p.status))) return no("A payout already exists for this prize, so its terms are locked.");
  if (award.teamId && s.awards.some((a) => a.teamId === award.teamId && !a.splitConfirmed)) return no("Every team member must confirm the split first.");
  // Which tax rule applies (and whether it is verified) is the server's call; it answers with the reason.
  return ok;
}

export function canReview(actor: Actor, item: { requestedBy: string; personId?: string }): Permission {
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role === "attendee") return no("Organizers review claims. Attendees can only see their own.");
  if (item.requestedBy === actor.id || item.requestedBy === actor.name || (actor.personId && item.personId === actor.personId))
    return no("You cannot approve your own request. Another organizer or the controller must decide.");
  return ok;
}

export function canManage(actor: Actor): Permission {
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role === "attendee") return no("Only organizers and controllers change event finances.");
  return ok;
}

export function canControl(actor: Actor, s: Pick<AppSnapshot, "personas">): Permission {
  if (actor.role === "controller") return ok;
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  return no(`Only a controller can do this.${controllerNote(s)}`);
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export type InboxCategory = "approvals" | "holds" | "exceptions";

export type InboxItem = {
  id: string;
  category: InboxCategory;
  title: string;
  mark: string;
  meta: string;
  detail: string;
  amountMinor: bigint;
  currency: string;
  amountNote: string;
  dueAt: string;
  dueContext: string;
  critical?: string;
  ref:
    | { kind: "payouts"; payouts: Payout[] }
    | { kind: "payout"; payout: Payout }
    | { kind: "claim"; claim: Claim }
    | { kind: "award"; award: Award; person?: Person; payout?: Payout }
    | { kind: "packet"; packet: SponsorPacket }
    | { kind: "person"; person: Person };
};

const CATEGORY_RANK: Record<InboxCategory, number> = { exceptions: 0, approvals: 1, holds: 2 };

export function buildInbox(s: AppSnapshot): InboxItem[] {
  const items: InboxItem[] = [];
  const people = new Map(s.people.map((p) => [p.id, p]));
  const awardPayout = new Map(
    s.payouts.filter((p) => p.sourceType === "award").map((p) => [p.sourceId, p]),
  );
  const heldPeople = new Set<string>();

  const ready = s.payouts.filter((p) => p.status === "proposed" || p.status === "approved");
  if (ready.length) {
    const gross = sumMinor(ready.map((p) => p.grossMinor));
    const withheld = sumMinor(ready.map((p) => p.withholdingMinor));
    const due = ready.map((p) => p.dueAt).sort()[0];
    items.push({
      id: "batch",
      category: "approvals",
      title: ready.length === 1 ? `Payout ready for release: ${ready[0].personName}` : `Payout batch ready for release`,
      mark: "Release",
      meta: `${ready.length} ${ready.length === 1 ? "payout" : "payouts"}${s.personas.some((p) => p.role === "controller") ? ` · controller ${controllerName(s)}` : " · for a controller"}`,
      detail: `${fmtPlain(withheld, "USD")} withheld · fees ${fmtPlain(sumMinor(ready.map((p) => p.feeMinor)), "USD")} · Eve cannot release money.`,
      amountMinor: gross,
      currency: ready[0].currency,
      amountNote: "gross",
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
        title: p.status === "frozen" ? "Payout frozen: bank details changed" : `Payout ${p.status}`,
        mark: p.personName.split(" ")[0],
        meta: `${p.personName} · ${p.sourceType === "award" ? "prize" : "claim"} payout · ${providerLabel(p.provider)}`,
        detail: p.reason,
        amountMinor: big(p.grossMinor),
        currency: p.currency,
        amountNote: "payout",
        dueAt: p.dueAt,
        dueContext: "release",
        critical: p.status === "frozen" ? "Frozen" : p.status === "failed" ? "Failed" : "Returned",
        ref: { kind: "payout", payout: p },
      });
    } else if (p.status === "held") {
      heldPeople.add(p.personId);
      items.push({
        id: `payout:${p.id}`,
        category: "holds",
        title: `Payout on hold: ${p.personName}`,
        mark: p.personName.split(" ")[0],
        meta: `${p.sourceType === "award" ? "Prize" : "Claim"} payout · ${people.get(p.personId)?.taxForm ?? "tax form"} ${people.get(p.personId)?.taxStatus ?? ""}`.trim(),
        detail: p.reason,
        amountMinor: big(p.grossMinor),
        currency: p.currency,
        amountNote: "held",
        dueAt: p.dueAt,
        dueContext: "payout",
        ref: { kind: "payout", payout: p },
      });
    }
  }

  for (const c of s.claims) {
    if (c.status !== "escalated" && c.status !== "needs_info") continue;
    const failed = c.checks.filter((k) => !k.passed).map((k) => k.label);
    items.push({
      id: `claim:${c.id}`,
      category: c.status === "escalated" ? "approvals" : "holds",
      title:
        c.status === "escalated"
          ? `${c.type === "travel" ? "Travel claim" : "Expense"} needs a decision`
          : `Waiting on ${c.personName.split(" ")[0]} for more information`,
      mark: c.personName.split(" ")[0],
      meta: [c.personName, c.origin ? `Flight from ${c.origin}` : c.merchant, c.cabin].filter(Boolean).join(" · "),
      detail: c.reason || (failed.length ? `Flag: ${failed.join(", ")}` : "Escalated for review"),
      amountMinor: big(c.usdMinor),
      currency: "USD",
      amountNote: c.currency !== "USD" ? `${fmtPlain(big(c.amountMinor), c.currency)}` : c.type,
      dueAt: c.dueAt,
      dueContext: "review",
      ref: { kind: "claim", claim: c },
    });
  }

  for (const a of s.awards) {
    const person = people.get(a.personId);
    const payout = awardPayout.get(a.id);
    if (a.status === "paid" || a.status === "proposed" || payout) continue;
    const where = person ? person.country : "";
    if (a.status === "needs_form") {
      items.push({
        id: `award:${a.id}`,
        category: "holds",
        title: `Prize held: ${person?.taxForm ?? "tax form"} not signed`,
        mark: a.personName.split(" ")[0],
        meta: `${a.personName}${where ? `, ${where}` : ""} · ${a.track}`,
        detail: a.recommendation || "Eve is chasing the winner for their tax form.",
        amountMinor: big(a.amountMinor),
        currency: a.currency,
        amountNote: a.kind === "item" ? "item FMV" : "prize",
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
        title: undecided
          ? `Prize to a winner${where ? ` in ${where}` : ""}: ${a.title}`
          : splitPending
            ? `Team split awaiting confirmation: ${a.title}`
            : `Prize ready for a payout proposal: ${a.title}`,
        mark: a.personName.split(" ")[0],
        meta: `${a.personName}${where ? `, ${where}` : ""} · ${a.track}`,
        detail: a.recommendation,
        amountMinor: big(a.amountMinor),
        currency: a.currency,
        amountNote: a.kind === "item" ? "item FMV" : "prize",
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
      title:
        k.status === "exception"
          ? `Sponsor paid ${fmtPlain(big(k.paidMinor), "USD")} on a ${fmtPlain(big(k.requestedMinor), "USD")} request`
          : `Sponsor questioned packet ${k.id}`,
      mark: "Sponsor",
      meta: `Packet ${k.id} · ${k.personName} · ${s.org.sponsorName}`,
      detail: k.reason,
      amountMinor: big(k.paidMinor),
      currency: "USD",
      amountNote: `of ${fmtPlain(big(k.requestedMinor), "USD")}`,
      dueAt: k.dueAt,
      dueContext: "reconcile",
      ref: { kind: "packet", packet: k },
    });
  }

  for (const p of s.people) {
    if (heldPeople.has(p.id)) continue;
    if ((p.taxStatus === "expired" || p.taxStatus === "review") && big(p.outstandingMinor) > 0n) {
      items.push({
        id: `person:${p.id}`,
        category: "holds",
        title: `${p.taxForm} ${p.taxStatus === "expired" ? "expired" : "needs review"}; payment on hold`,
        mark: p.name.split(" ")[0],
        meta: `${p.name}, ${p.country} · ${p.role}`,
        detail: `Eve has chased ${p.chaseCount} ${p.chaseCount === 1 ? "time" : "times"}.`,
        amountMinor: big(p.outstandingMinor),
        currency: "USD",
        amountNote: "outstanding",
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
        personName: last.personName,
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
 * cash_prize / item_prize with a ":treaty" variant that needs a signed form.
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
  // A treaty rate only applies once the recipient has a valid form on file.
  const treaty = person?.taxStatus === "valid" && payee !== payer ? latest(forPayee(typed(`${base}:treaty`)).filter((r) => r.payeeCountry === payee)) : undefined;
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
};

export function prizeOptions(s: Pick<AppSnapshot, "rules" | "org"> & { now?: string }, award: Award, person?: Person, payout?: Payout): PrizeOptions {
  // A proposed payout names the rule it used; otherwise estimate one.
  const rule = (payout && s.rules.find((r) => r.id === payout.ruleId && r.version === payout.ruleVersion)) ?? prizeRule(s, person, award.kind);
  const gross = big(award.amountMinor);
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
