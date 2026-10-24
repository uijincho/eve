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

export function canRelease(actor: Actor, payout: Payout, s: Pick<AppSnapshot, "personas">): Permission {
  if (payout.status === "frozen") return no("Frozen until the bank change is confirmed through the original contact channel.");
  if (payout.status === "held") return no(payout.reason || "Held until the recipient's tax form is valid.");
  if (!["proposed", "approved"].includes(payout.status)) return no(`This payout is ${payout.status}.`);
  if (actor.role === "auditor") return no("Auditors have read-only access.");
  if (actor.role !== "controller")
    return no(`Only a controller releases money. ${controllerName(s)} is the controller.`);
  if (payout.requestedBy === actor.id || payout.requestedBy === actor.name)
    return no("You requested this payout. A different controller must release it.");
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
  return no(`Only a controller can do this. ${controllerName(s)} is the controller.`);
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
      meta: `${ready.length} ${ready.length === 1 ? "payout" : "payouts"} · controller ${controllerName(s)}`,
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
        meta: `${p.personName} · ${p.sourceType === "award" ? "prize" : "claim"} payout · ${p.provider}`,
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
      meta: [c.personName, c.origin ? `${c.origin} → SFO` : c.merchant, c.cabin].filter(Boolean).join(" · "),
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
  const rule = prizeRule(s, person, award.kind);
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
